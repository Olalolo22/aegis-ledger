import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { CLOAK_PROGRAM_ID, NATIVE_SOL_MINT } from "@cloak.dev/sdk";
import { acquireMutex, releaseMutex } from "@/lib/redis";
import {
  getConnection,
  getProgramId,
  getRelayUrl,
  fetchMerkleProofs,
  fetchAvailableUtxos,
} from "@/lib/cloak";
import { createServiceClient } from "@/lib/supabase/server";
import { payrollRequestSchema, TOKEN_MINTS } from "@/lib/validation";

/**
 * POST /api/payroll
 *
 * NON-CUSTODIAL data coordinator for batch private payroll disbursements.
 *
 * ⚠ The server NEVER holds signing keys. It acts as a coordinator:
 *
 * Flow:
 * 1. Validate & sanitize inputs (Zod schema)
 * 2. Verify org exists in Supabase
 * 3. Acquire Redis mutex on UTXO selection (SET NX, TTL 60s)
 * 4. Fetch public inputs from Cloak indexer:
 *    - Available UTXOs for the org's treasury pubkey
 *    - Current Merkle tree root & inclusion proofs
 * 5. Lock selected UTXOs via Redis to prevent double-spending
 * 6. Create payroll_run record (status: 'pending_signature')
 * 7. Return raw signing parameters as JSON for client-side proving
 * 8. Release mutex in finally{} block
 *
 * The CLIENT then:
 * - Uses these parameters to construct Cloak transactions
 * - Signs with the connected wallet (Phantom, Solflare, etc.)
 * - Broadcasts transactions via RPC
 * - Calls POST /api/payroll/confirm with the resulting signatures
 *
 * Concurrency Safety:
 * - Redis SET NX mutex prevents concurrent UTXO selection for the same org
 * - Mutex released in finally{} block to prevent deadlocks
 * - TTL of 60s prevents permanent lockout on crash
 */
export async function POST(request: NextRequest) {
  // ─── 1. Parse & Validate Input ───────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = payrollRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  const { org_id, token_symbol, token_mint, initiated_by, recipients } =
    parsed.data;

  // Cross-validate token_mint against known mints
  const expectedMint = TOKEN_MINTS[token_symbol];
  if (expectedMint && token_mint !== expectedMint) {
    return NextResponse.json(
      {
        error: `token_mint mismatch: expected ${expectedMint} for ${token_symbol}`,
      },
      { status: 400 }
    );
  }

  // ─── 2. Verify Organization Exists ───────────────────────────
  const supabase = createServiceClient();
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, treasury_pubkey")
    .eq("id", org_id)
    .single();

  if (orgError || !org) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404 }
    );
  }

  // ─── 3. Acquire Redis Mutex ──────────────────────────────────
  // Lock scoped to org_id — prevents concurrent payroll runs
  // for the same organization from racing on UTXO selection.
  const mutex = await acquireMutex(`utxo-selection:${org_id}`, 60);
  if (!mutex.acquired) {
    return NextResponse.json(
      {
        error: "A payroll operation is already in progress for this organization. Please retry shortly.",
        code: "MUTEX_CONTENTION",
      },
      { status: 409 }
    );
  }

  try {
    // ─── 4. Fetch Public Inputs from Cloak ────────────────────
    const mintPubkey =
      token_symbol === "SOL"
        ? NATIVE_SOL_MINT
        : new PublicKey(token_mint);

    const treasuryPubkey = new PublicKey(org.treasury_pubkey);

    // Fetch Merkle tree state and available UTXOs in parallel
    const [merkleData, availableUtxos] = await Promise.all([
      fetchMerkleProofs(mintPubkey),
      fetchAvailableUtxos(treasuryPubkey, mintPubkey),
    ]);

    // ─── 5. Calculate Totals & Validate Sufficient Balance ───
    const totalAmount = recipients.reduce(
      (sum, r) => sum + BigInt(r.amount),
      0n
    );

    const availableBalance = availableUtxos.reduce(
      (sum, u) => sum + BigInt(u.amount),
      0n
    );

    if (availableBalance < totalAmount) {
      return NextResponse.json(
        {
          error: "Insufficient shielded balance",
          required: totalAmount.toString(),
          available: availableBalance.toString(),
        },
        { status: 400 }
      );
    }

    // ─── 6. Lock Selected UTXOs in Redis ─────────────────────
    // Mark each UTXO as "in-use" to prevent double-spend by
    // concurrent requests. These locks auto-expire with the mutex.
    const selectedUtxos = selectUtxosForAmount(availableUtxos, totalAmount);

    for (const utxo of selectedUtxos) {
      const utxoLock = await acquireMutex(
        `utxo:${utxo.commitment}`,
        60 // same TTL as the parent mutex
      );
      if (!utxoLock.acquired) {
        return NextResponse.json(
          {
            error: "UTXO contention — one or more selected UTXOs are locked by another operation",
            code: "UTXO_CONTENTION",
          },
          { status: 409 }
        );
      }
    }

    // ─── 7. Create Payroll Run (pending_signature) ───────────
    const { data: payrollRun, error: insertError } = await supabase
      .from("payroll_runs")
      .insert({
        org_id,
        status: "pending_signature" as const,
        token_mint,
        token_symbol,
        total_amount_lamports: Number(totalAmount), // safe for USDC amounts < 2^53
        recipient_count: recipients.length,
        initiated_by,
        tx_signatures: null,
        error_message: null,
        completed_at: null,
      })
      .select("id")
      .single();

    if (insertError || !payrollRun) {
      console.error("Failed to create payroll run:", insertError);
      return NextResponse.json(
        { error: "Failed to create payroll run" },
        { status: 500 }
      );
    }

    // ─── 8. Audit Log ────────────────────────────────────────
    await supabase.from("audit_log").insert({
      event_type: "payroll_initiated",
      org_id,
      metadata: {
        payroll_run_id: payrollRun.id,
        recipient_count: recipients.length,
        token_symbol,
        status: "pending_signature",
      },
    });

    // ─── 9. Return Signing Parameters ────────────────────────
    // These raw parameters are consumed by the client-side
    // wallet adapter + Cloak SDK to construct, sign, and
    // broadcast the shielded transactions.
    const mutexExpiresAt = new Date(Date.now() + 60_000).toISOString();

    return NextResponse.json(
      {
        payroll_run_id: payrollRun.id,
        status: "pending_signature",
        signing_params: {
          merkle_root: merkleData.root,
          merkle_proofs: merkleData.proofs,
          merkle_leaf_count: merkleData.leafCount,
          selected_utxos: selectedUtxos,
          recipients: recipients.map((r) => ({
            wallet: r.wallet,
            amount: r.amount,
          })),
          token_mint: token_mint,
          token_symbol: token_symbol,
          program_id: getProgramId().toBase58(),
          relay_url: getRelayUrl(),
          rpc_url: process.env.SOLANA_RPC_URL,
        },
        mutex_expires_at: mutexExpiresAt,
      },
      { status: 200 }
    );
  } catch (error) {
    // ─── Unexpected Error ────────────────────────────────────
    console.error("Payroll route unexpected error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message:
          error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  } finally {
    // ─── ALWAYS Release Mutex ───────────────────────────────
    // This runs whether the route succeeded, failed, or threw.
    await releaseMutex(mutex.key, mutex.lockValue);
  }
}

// ─── UTXO Selection Helper ─────────────────────────────────────
// Simple greedy algorithm: select UTXOs largest-first until the
// target amount is met. A production system would use a more
// sophisticated coin selection strategy (e.g., Branch & Bound).

import type { UtxoDescriptor } from "@/lib/cloak";

function selectUtxosForAmount(
  utxos: UtxoDescriptor[],
  targetAmount: bigint
): UtxoDescriptor[] {
  // Sort descending by amount (largest first)
  const sorted = [...utxos].sort(
    (a, b) => Number(BigInt(b.amount) - BigInt(a.amount))
  );

  const selected: UtxoDescriptor[] = [];
  let accumulated = 0n;

  for (const utxo of sorted) {
    if (accumulated >= targetAmount) break;
    selected.push(utxo);
    accumulated += BigInt(utxo.amount);
  }

  return selected;
}
