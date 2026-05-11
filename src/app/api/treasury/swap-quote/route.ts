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
import { swapQuoteRequestSchema, TOKEN_MINTS } from "@/lib/validation";

/**
 * POST /api/treasury/swap-quote
 *
 * NON-CUSTODIAL data coordinator for private SOL→USDC swaps
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

  const parsed = swapQuoteRequestSchema.safeParse(body);
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

  const { org_id, amount_lamports, slippage_bps, initiated_by } = parsed.data;

  try {
    new PublicKey(initiated_by);
  } catch {
    return NextResponse.json(
      { error: "initiated_by must be a valid Solana public key" },
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
  const mutex = await acquireMutex(`swap-utxo:${org_id}`, 60);
  if (!mutex.acquired) {
    return NextResponse.json(
      {
        error: "A swap operation is already in progress. Please retry shortly.",
        code: "MUTEX_CONTENTION",
      },
      { status: 409 }
    );
  }

  try {
    // ─── 4. Fetch Public Inputs from Cloak ────────────────────
    const treasuryPubkey = new PublicKey(org.treasury_pubkey);
    const usdcMint = TOKEN_MINTS.USDC;
    const swapAmount = BigInt(amount_lamports);

    let merkleData: { root: string; proofs: Array<{ leaf: string; pathElements: string[]; pathIndices: number[] }>; leafCount: number };
    let selectedUtxos: Array<{ commitment: string; amount: string; mint: string; leafIndex: number; nullifier: string }>;
    let orcaQuote: {
      estimatedOutputAmount: string;
      minOutputAmount: string;
      priceImpactPct: number;
      routePlan: string;
    };
    let relayFallback = false;

    try {
      // ─── Attempt Real Cloak Relay First ─────────────────────
      const [md, availableUtxos] = await Promise.all([
        fetchMerkleProofs(NATIVE_SOL_MINT),
        fetchAvailableUtxos(treasuryPubkey, NATIVE_SOL_MINT),
      ]);

      merkleData = md;

      const availableBalance = availableUtxos.reduce(
        (sum, u) => sum + BigInt(u.amount),
        0n
      );

      if (availableBalance < swapAmount) {
        return NextResponse.json(
          {
            error: "Insufficient shielded SOL balance",
            required: swapAmount.toString(),
            available: availableBalance.toString(),
          },
          { status: 400 }
        );
      }

      // Fetch Orca DEX Quote (via Jupiter)
      const quoteRes = await fetch(
        `https://quote-api.jup.ag/v6/quote?` +
          `inputMint=So11111111111111111111111111111111111111112` +
          `&outputMint=${usdcMint}` +
          `&amount=${amount_lamports}` +
          `&slippageBps=${slippage_bps}`,
        { signal: AbortSignal.timeout(10_000) }
      );

      if (!quoteRes.ok) throw new Error("Jupiter API unreachable");

      const quoteData = await quoteRes.json();
      orcaQuote = {
        estimatedOutputAmount: quoteData.outAmount || "0",
        minOutputAmount: quoteData.otherAmountThreshold || quoteData.outAmount || "0",
        priceImpactPct: parseFloat(quoteData.priceImpactPct || "0"),
        routePlan: JSON.stringify(quoteData.routePlan || []),
      };

      selectedUtxos = selectUtxosForSwap(availableUtxos, swapAmount);

      for (const utxo of selectedUtxos) {
        const utxoLock = await acquireMutex(`utxo:${utxo.commitment}`, 60);
        if (!utxoLock.acquired) {
          return NextResponse.json(
            { error: "UTXO locked by another operation", code: "UTXO_CONTENTION" },
            { status: 409 }
          );
        }
      }
    } catch (relayError) {
      // ─── Fallback to Mock Data on Relay Failure ─────────────
      console.warn(
        "[Aegis Ledger] Relay/DEX unavailable, using mock swap params:",
        relayError instanceof Error ? relayError.message : relayError
      );
      relayFallback = true;

      const mockEstimatedOutput = Math.round(
        (Number(amount_lamports) / 1e9) * 160 * 1e6
      ).toString();

      merkleData = {
        root: "mock_merkle_root_" + Date.now(),
        proofs: [{
          leaf: "mock_leaf_" + Date.now(),
          pathElements: Array(20).fill("0x0"),
          pathIndices: Array(20).fill(0),
        }],
        leafCount: 2048,
      };

      selectedUtxos = [{
        commitment: "mock_swap_commitment_" + Date.now(),
        amount: amount_lamports,
        mint: "So11111111111111111111111111111111111111112",
        leafIndex: 500,
        nullifier: "mock_swap_nullifier_" + Date.now(),
      }];

      orcaQuote = {
        estimatedOutputAmount: mockEstimatedOutput,
        minOutputAmount: Math.round(Number(mockEstimatedOutput) * 0.99).toString(),
        priceImpactPct: 0.02,
        routePlan: JSON.stringify([{ label: "Orca CLMM SOL/USDC", percent: 100 }]),
      };
    }

    // ─── 5. Create Swap Record ───────────────────────────────
    const { data: swapRecord, error: insertError } = await supabase
      .from("treasury_swaps")
      .insert({
        org_id,
        status: "pending" as const,
        input_token: "SOL",
        output_token: "USDC",
        input_amount_lamports: Number(swapAmount),
        estimated_output_amount: Number(orcaQuote.estimatedOutputAmount),
        slippage_bps,
        initiated_by,
        tx_signature: null,
        error_message: null,
        completed_at: null,
      })
      .select("id")
      .single();

    if (insertError || !swapRecord) {
      return NextResponse.json({ error: "Failed to create swap record" }, { status: 500 });
    }

    // ─── 6. Audit Log ────────────────────────────────────────
    await supabase.from("audit_log").insert({
      event_type: "swap_initiated",
      org_id,
      metadata: {
        swap_id: swapRecord.id,
        input_amount: amount_lamports,
        estimated_output: orcaQuote.estimatedOutputAmount,
        relay_fallback: relayFallback,
      },
    });

    // ─── 7. Return Swap Parameters ──────────────────────────
    const mutexExpiresAt = new Date(Date.now() + 60_000).toISOString();

    return NextResponse.json(
      {
        swap_id: swapRecord.id,
        status: "pending_signature",
        relay_fallback: relayFallback,
        swap_params: {
          merkle_root: merkleData.root,
          merkle_proofs: merkleData.proofs,
          merkle_leaf_count: merkleData.leafCount,
          selected_utxos: selectedUtxos,
          input_mint: "So11111111111111111111111111111111111111112",
          output_mint: usdcMint,
          swap_amount_lamports: amount_lamports,
          slippage_bps,
          quote: orcaQuote,
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
    console.error("Swap quote route unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseMutex(mutex.key, mutex.lockValue);
  }
}

// ─── UTXO Selection Helper ─────────────────────────────────────
import type { UtxoDescriptor } from "@/lib/cloak";

function selectUtxosForSwap(
  utxos: UtxoDescriptor[],
  targetAmount: bigint
): UtxoDescriptor[] {
  const sorted = [...utxos].sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));
  const selected: UtxoDescriptor[] = [];
  let accumulated = 0n;
  for (const utxo of sorted) {
    if (accumulated >= targetAmount) break;
    selected.push(utxo);
    accumulated += BigInt(utxo.amount);
  }
  return selected;
}
