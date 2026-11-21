import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { acquireMutex, releaseMutex } from "@/lib/redis";
import {
  ER_RPC,
  MAGICBLOCK_CLUSTER,
  NATIVE_SOL_MINT,
  TEE_VALIDATOR,
  queryMagicBlockSplBalance,
} from "@/lib/magicblock";
import { createServiceClient } from "@/lib/supabase/server";
import { requireOrgAdminSession } from "@/lib/auth";
import { swapQuoteRequestSchema, TOKEN_MINTS } from "@/lib/validation";

/**
 * POST /api/treasury/swap-quote
 *
 * Authenticated, non-custodial coordinator for SOL -> USDC treasury runway
 * top-ups scoped strictly to `session.orgId`.
 */
export async function POST(request: NextRequest) {
  const auth = await requireOrgAdminSession(request);
  if (!auth.ok) return auth.response;

  const org_id = auth.session.orgId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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

  const { amount_lamports, slippage_bps, initiated_by } = parsed.data;

  if (initiated_by !== auth.session.walletPubkey) {
    return NextResponse.json(
      {
        error: "initiated_by wallet must match authenticated admin session wallet.",
        code: "INITIATOR_WALLET_MISMATCH",
      },
      { status: 403 }
    );
  }

  try {
    new PublicKey(initiated_by);
  } catch {
    return NextResponse.json(
      { error: "initiated_by must be a valid Solana public key" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const mutex = await acquireMutex(`treasury-swap:${org_id}`, 60);
  if (!mutex.acquired) {
    return NextResponse.json(
      {
        error: "A treasury top-up is already in progress. Please retry shortly.",
        code: "MUTEX_CONTENTION",
      },
      { status: 409 }
    );
  }

  try {
    const usdcMint = TOKEN_MINTS.USDC;
    const swapAmount = BigInt(amount_lamports);

    // Fetch live Jupiter quote & MagicBlock USDC delegation state in parallel
    let quote: {
      estimatedOutputAmount: string;
      minOutputAmount: string;
      priceImpactPct: number;
      routePlan: string;
    };
    let balanceInfo;

    try {
      const [quoteRes, bal] = await Promise.all([
        fetch(
          `https://quote-api.jup.ag/v6/quote?` +
            `inputMint=${NATIVE_SOL_MINT.toBase58()}` +
            `&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` +
            `&amount=${amount_lamports}` +
            `&slippageBps=${slippage_bps}`,
          { signal: AbortSignal.timeout(10_000) }
        ),
        queryMagicBlockSplBalance(initiated_by, usdcMint, MAGICBLOCK_CLUSTER),
      ]);

      if (!quoteRes.ok) {
        throw new Error(`Jupiter quote API returned ${quoteRes.status}`);
      }

      const quoteData = await quoteRes.json();
      quote = {
        estimatedOutputAmount: quoteData.outAmount || "0",
        minOutputAmount: quoteData.otherAmountThreshold || quoteData.outAmount || "0",
        priceImpactPct: parseFloat(quoteData.priceImpactPct || "0"),
        routePlan: JSON.stringify(quoteData.routePlan || []),
      };
      balanceInfo = bal;
    } catch (upstreamErr) {
      const detail = upstreamErr instanceof Error ? upstreamErr.message : String(upstreamErr);
      console.error("[Aegis Treasury Swap] Upstream quote/enclave unavailable:", detail);
      return NextResponse.json(
        {
          error: "Swap quote or MagicBlock enclave service is unavailable.",
          code: "UPSTREAM_UNAVAILABLE",
          detail,
        },
        { status: 503 }
      );
    }

    const { data: swapRecord, error: insertError } = await supabase
      .from("treasury_swaps")
      .insert({
        org_id,
        status: "pending" as const,
        input_token: "SOL",
        output_token: "USDC",
        input_amount_lamports: Number(swapAmount),
        estimated_output_amount: Number(quote.estimatedOutputAmount),
        slippage_bps,
        initiated_by,
        tx_signature: null,
        error_message: null,
        completed_at: null,
      })
      .select("id")
      .single();

    if (insertError || !swapRecord) {
      return NextResponse.json(
        { error: "Failed to create swap record" },
        { status: 500 }
      );
    }

    await supabase.from("audit_log").insert({
      event_type: "swap_initiated",
      org_id,
      metadata: {
        swap_id: swapRecord.id,
        execution_rail: "magicblock_per",
        input_amount: amount_lamports,
        estimated_output: quote.estimatedOutputAmount,
      },
    });

    const mutexExpiresAt = new Date(Date.now() + 60_000).toISOString();

    return NextResponse.json(
      {
        swap_id: swapRecord.id,
        status: "pending_signature",
        execution_rail: "magicblock_per",
        swap_params: {
          input_mint: NATIVE_SOL_MINT.toBase58(),
          output_mint: usdcMint,
          swap_amount_lamports: amount_lamports,
          slippage_bps,
          quote,
          delegation_status: balanceInfo.delegation?.status || "undelegated",
          program_id: TEE_VALIDATOR.toBase58(),
          relay_url: ER_RPC,
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
