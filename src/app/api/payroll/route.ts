import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { CLOAK_PROGRAM_ID, NATIVE_SOL_MINT } from "@cloak.dev/sdk-devnet";
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

    let merkleData: { root: string; proofs: Array<{ leaf: string; pathElements: string[]; pathIndices: number[] }>; leafCount: number };
    let selectedUtxos: Array<{ commitment: string; amount: string; mint: string; leafIndex: number; nullifier: string }>;
    let relayFallback = false;

    try {
      // ─── Attempt Real Cloak Relay First ─────────────────────
      const [md, availableUtxos] = await Promise.all([
        fetchMerkleProofs(mintPubkey),
        fetchAvailableUtxos(treasuryPubkey, mintPubkey),
      ]);

      merkleData = md;

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
      // ─── Fallback to Mock Data on Relay Failure ─────────────
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

    // ─── 5. Create Payroll Run (pending_signature) ───────────
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

    // ─── 6. Audit Log ────────────────────────────────────────
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

    // ─── 7. Return Signing Parameters ────────────────────────
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
            ? process.env.CLOAK_RELAY_URL
            : getRelayUrl(),
          rpc_url: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
        },
        mutex_expires_at: mutexExpiresAt,
      },
      { status: 200 }
    );
  } catch (error) {
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
    await releaseMutex(mutex.key, mutex.lockValue);
  }
}

// ─── UTXO Selection Helper ─────────────────────────────────────
import type { UtxoDescriptor } from "@/lib/cloak";

function selectUtxosForAmount(
  utxos: UtxoDescriptor[],
  targetAmount: bigint
): UtxoDescriptor[] {
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
