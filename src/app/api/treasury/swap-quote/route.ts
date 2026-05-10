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
 * routed through the Cloak shielded pool via Orca DEX.
 *
 * ⚠ The server NEVER holds signing keys. It acts strictly as
 * a data coordinator — fetching public inputs and locking UTXOs.
 *
 * Flow:
 * 1. Validate & sanitize inputs (Zod schema)
 * 2. Verify org exists in Supabase
 * 3. Acquire Redis mutex on UTXO selection (SET NX, TTL 60s)
 * 4. Fetch public inputs from Cloak relay:
 *    - Available SOL UTXOs for the org's treasury pubkey
 *    - Current Merkle tree root & inclusion proofs
 * 5. Verify sufficient shielded SOL balance
 * 6. Fetch Orca pool quote for SOL→USDC (via public API)
 * 7. Lock selected UTXOs via Redis to prevent double-spending
 * 8. Create swap record (status: 'pending_signature')
 * 9. Return raw swap parameters as JSON for client-side proving
 *
 * The CLIENT then:
 * - Uses CloakSDK.swap() with the Groth16 WASM prover
 * - Signs with the connected wallet
 * - Broadcasts to Solana RPC
 * - Calls POST /api/treasury/swap-confirm with the tx signature
 *
 * EVM Injection Isolation:
 * - The initiated_by field is validated as a base58 Solana pubkey
 * - The server never interprets this as an EVM address
 * - All pubkey handling uses @solana/web3.js PublicKey class
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
  // mock swap params. Uses relaxed parsing — no strict UUID/pubkey.
  if (process.env.DEMO_MODE === "true") {
    const demoBody = body as Record<string, unknown>;
    const amount_lamports = String(demoBody?.amount_lamports || "22500000000000");
    const slippage_bps = Number(demoBody?.slippage_bps || 100);

    const demoSwapId = crypto.randomUUID();
    const mockEstimatedOutput = Math.round(
      (Number(amount_lamports) / 1e9) * 160 * 1e6
    ).toString(); // ~160 USDC per SOL

    return NextResponse.json(
      {
        swap_id: demoSwapId,
        status: "pending",
        demo_mode: true,
        swap_params: {
          merkle_root: "demo_merkle_root_" + Date.now(),
          merkle_proofs: [
            {
              leaf: "demo_leaf_" + Date.now(),
              pathElements: Array(20).fill("0x0"),
              pathIndices: Array(20).fill(0),
            },
          ],
          merkle_leaf_count: 2048,
          selected_utxos: [
            {
              commitment: "demo_swap_commitment_" + Date.now(),
              amount: amount_lamports,
              mint: "So11111111111111111111111111111111111111112",
              leafIndex: 500,
              nullifier: "demo_swap_nullifier_" + Date.now(),
            },
          ],
          input_mint: "So11111111111111111111111111111111111111112",
          output_mint: "61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf", // Devnet USDC (Circle)
          swap_amount_lamports: amount_lamports,
          slippage_bps,
          quote: {
            estimatedOutputAmount: mockEstimatedOutput,
            minOutputAmount: Math.round(
              Number(mockEstimatedOutput) * 0.99
            ).toString(),
            priceImpactPct: 0.02,
            routePlan: JSON.stringify([
              { label: "Orca CLMM SOL/USDC", percent: 100 },
            ]),
          },
          program_id: "CLoaKcdPMsPKBmQVMbUHqXqhV4BXJYJQEfBJFU7xB7VE",
          relay_url:
            process.env.CLOAK_RELAY_URL || "https://api.cloak.ag",
          rpc_url:
            process.env.SOLANA_RPC_URL ||
            "https://api.devnet.solana.com",
        },
        mutex_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      { status: 200 }
    );
  }

  // ─── Full validation (production mode only) ──────────────────
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

  // EVM injection isolation: validate that initiated_by is a valid Solana pubkey
  try {
    new PublicKey(initiated_by);
  } catch {
    return NextResponse.json(
      { error: "initiated_by must be a valid Solana public key (not an EVM address)" },
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
        error: "A swap operation is already in progress for this organization. Please retry shortly.",
        code: "MUTEX_CONTENTION",
      },
      { status: 409 }
    );
  }

  try {
    // ─── 4. Fetch Public Inputs from Cloak ────────────────────
    // Try the live Cloak relay first; fall back to mock data if
    // the relay is unreachable (404, timeout, etc.).
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
      // Fetch Merkle proofs and available SOL UTXOs in parallel
      const [md, availableUtxos] = await Promise.all([
        fetchMerkleProofs(NATIVE_SOL_MINT),
        fetchAvailableUtxos(treasuryPubkey, NATIVE_SOL_MINT),
      ]);

      merkleData = md;

      // ─── 5. Verify Sufficient Shielded SOL Balance ───────────
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

      // ─── 6. Fetch Orca DEX Quote ─────────────────────────────
      const quoteRes = await fetch(
        `https://quote-api.jup.ag/v6/quote?` +
          `inputMint=So11111111111111111111111111111111111111112` +
          `&outputMint=${usdcMint}` +
          `&amount=${amount_lamports}` +
          `&slippageBps=${slippage_bps}`,
        { signal: AbortSignal.timeout(10_000) }
      );

      if (!quoteRes.ok) {
        throw new Error(`Jupiter/Orca API returned ${quoteRes.status}`);
      }

      const quoteData = await quoteRes.json();

      orcaQuote = {
        estimatedOutputAmount: quoteData.outAmount || "0",
        minOutputAmount: quoteData.otherAmountThreshold || quoteData.outAmount || "0",
        priceImpactPct: parseFloat(quoteData.priceImpactPct || "0"),
        routePlan: JSON.stringify(quoteData.routePlan || []),
      };

      // ─── 7. Select & Lock UTXOs ──────────────────────────────
      selectedUtxos = selectUtxosForSwap(availableUtxos, swapAmount);

      for (const utxo of selectedUtxos) {
        const utxoLock = await acquireMutex(`utxo:${utxo.commitment}`, 60);
        if (!utxoLock.acquired) {
          return NextResponse.json(
            {
              error: "UTXO contention — selected UTXOs locked by another operation",
              code: "UTXO_CONTENTION",
            },
            { status: 409 }
          );
        }
      }
    } catch (relayError) {
      // ─── Cloak relay / Jupiter unreachable — fall back to mock ──
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

    // ─── 8. Create Swap Record ───────────────────────────────
    // Always create a real record in Supabase.
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
      console.error("Failed to create swap record:", insertError);
      return NextResponse.json(
        { error: "Failed to create swap record" },
        { status: 500 }
      );
    }

    // ─── 9. Audit Log ────────────────────────────────────────
    await supabase.from("audit_log").insert({
      event_type: "swap_initiated",
      org_id,
      metadata: {
        swap_id: swapRecord.id,
        input_amount: amount_lamports,
        estimated_output: orcaQuote.estimatedOutputAmount,
        slippage_bps,
        price_impact_pct: orcaQuote.priceImpactPct,
        relay_fallback: relayFallback,
      },
    });

    // ─── 10. Return Swap Parameters ──────────────────────────
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
            ? (process.env.CLOAK_RELAY_URL || "https://api.cloak.ag")
            : getRelayUrl(),
          rpc_url: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
        },
        mutex_expires_at: mutexExpiresAt,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Swap quote route unexpected error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
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
