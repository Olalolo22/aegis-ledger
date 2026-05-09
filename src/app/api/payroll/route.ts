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

  // ─── DEMO MODE FALLBACK ────────────────────────────────────
  // When DEMO_MODE=true, skip Supabase/Redis/Cloak and return
  // mock signing params so the full UI flow works end-to-end.
  // Uses a relaxed schema that doesn't require strict UUID/pubkey
  // formats — allows the flow to work even without a wallet.
  if (process.env.DEMO_MODE === "true") {
    const demoBody = body as Record<string, unknown>;
    const token_symbol = (demoBody?.token_symbol as string) || "USDC";
    const token_mint = (demoBody?.token_mint as string) || TOKEN_MINTS["USDC"];
    const recipients = (demoBody?.recipients as Array<{ wallet: string; amount: string }>) || [];

    if (!recipients.length) {
      return NextResponse.json(
        { error: "Must have at least one recipient" },
        { status: 400 }
      );
    }

    const demoRunId = crypto.randomUUID();
    const mockUtxos = recipients.map((r, i) => ({
      commitment: `demo_commitment_${i}_${Date.now()}`,
      amount: r.amount,
      mint: token_mint,
      leafIndex: 1000 + i,
      nullifier: `demo_nullifier_${i}_${Date.now()}`,
    }));

    return NextResponse.json(
      {
        payroll_run_id: demoRunId,
        status: "pending",
        demo_mode: true,
        signing_params: {
          merkle_root: "demo_merkle_root_" + Date.now(),
          merkle_proofs: mockUtxos.map((u) => ({
            leaf: u.commitment,
            pathElements: Array(20).fill("0x0"),
            pathIndices: Array(20).fill(0),
          })),
          merkle_leaf_count: 2048,
          selected_utxos: mockUtxos,
          recipients: recipients.map((r) => ({
            wallet: r.wallet,
            amount: r.amount,
          })),
          token_mint,
          token_symbol,
          program_id: "CLoaKcdPMsPKBmQVMbUHqXqhV4BXJYJQEfBJFU7xB7VE",
          relay_url: process.env.CLOAK_RELAY_URL || "https://api.cloak.ag",
          rpc_url: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
        },
        mutex_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      { status: 200 }
    );
  }

  // ─── Full validation (production mode only) ──────────────────
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
    // Try the live Cloak relay first; fall back to mock data if
    // the relay is unreachable (404, timeout, etc.).
    const mintPubkey =
      token_symbol === "SOL"
        ? NATIVE_SOL_MINT
        : new PublicKey(token_mint);

    const treasuryPubkey = new PublicKey(org.treasury_pubkey);

    let merkleData: { root: string; proofs: Array<{ leaf: string; pathElements: string[]; pathIndices: number[] }>; leafCount: number };
    let selectedUtxos: Array<{ commitment: string; amount: string; mint: string; leafIndex: number; nullifier: string }>;
    let relayFallback = false;

    try {
      // Fetch Merkle tree state and available UTXOs in parallel
      const [md, availableUtxos] = await Promise.all([
        fetchMerkleProofs(mintPubkey),
        fetchAvailableUtxos(treasuryPubkey, mintPubkey),
      ]);

      merkleData = md;

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
      selectedUtxos = selectUtxosForAmount(availableUtxos, totalAmount);

      for (const utxo of selectedUtxos) {
        const utxoLock = await acquireMutex(
          `utxo:${utxo.commitment}`,
          60
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
    } catch (relayError) {
      // ─── Cloak relay unreachable — fall back to mock data ───
      // This allows the full UI demo (ZK animation, wallet signing)
      // to work even when the Cloak relay API is down or returns 404.
      console.warn(
        "[Aegis Ledger] Cloak relay unavailable, using mock signing params:",
        relayError instanceof Error ? relayError.message : relayError
      );
      relayFallback = true;

      const mockUtxos = recipients.map((r, i) => ({
        commitment: `mock_commitment_${i}_${Date.now()}`,
        amount: r.amount,
        mint: token_mint,
        leafIndex: 1000 + i,
        nullifier: `mock_nullifier_${i}_${Date.now()}`,
      }));

      merkleData = {
        root: "mock_merkle_root_" + Date.now(),
        proofs: mockUtxos.map((u) => ({
          leaf: u.commitment,
          pathElements: Array(20).fill("0x0"),
          pathIndices: Array(20).fill(0),
        })),
        leafCount: 2048,
      };
      selectedUtxos = mockUtxos;
    }

    // ─── 7. Create Payroll Run (pending_signature) ───────────
    // Always create a real record in Supabase so the confirm
    // route can update it after client-side signing.
    const totalAmount = recipients.reduce(
      (sum, r) => sum + BigInt(r.amount),
      0n
    );

    const { data: payrollRun, error: insertError } = await supabase
      .from("payroll_runs")
      .insert({
        org_id,
        status: "pending" as const,
        token_mint,
        token_symbol,
        total_amount_lamports: Number(totalAmount),
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
        relay_fallback: relayFallback,
      },
    });

    // ─── 9. Return Signing Parameters ────────────────────────
    const mutexExpiresAt = new Date(Date.now() + 60_000).toISOString();

    return NextResponse.json(
      {
        payroll_run_id: payrollRun.id,
        status: "pending_signature",
        relay_fallback: relayFallback,
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
          program_id: relayFallback
            ? "CLoaKcdPMsPKBmQVMbUHqXqhV4BXJYJQEfBJFU7xB7VE"
            : getProgramId().toBase58(),
          relay_url: relayFallback
            ? (process.env.CLOAK_RELAY_URL || "https://api.cloak.ag")
            : getRelayUrl(),
          rpc_url: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
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
