import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireOrgAdminSession } from "@/lib/auth";
import { getOfframpProvider, DisbursementRecipient } from "@/lib/offramp";
import {
  FxQuoteUnavailableError,
  FxSanityCheckError,
  computeFiatPayoutFromQuote,
  fetchLiveFxQuote,
} from "@/lib/fx";

/**
 * POST /api/payroll/dispatch-offramp
 *
 * Authenticated org admin endpoint dispatching NGN Bank / KES M-Pesa payouts
 * strictly for an L1-anchored batch belonging to `session.orgId`.
 *
 * FX Accounting Invariant:
 * - Fetches live mid-market FX from `open.er-api.com` strictly as a server-side
 *   sanity-check benchmark (fails loud with HTTP 503 if unavailable).
 * - Each settlement receipt stamps the payout partner's ACTUAL applied execution
 *   rate alongside the mid-market reference rate and `fxSpreadBps`.
 */
export async function POST(request: NextRequest) {
  const auth = await requireOrgAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { batch_root, recipients } = body;

    if (!batch_root || !/^[0-9a-fA-F]{64}$/.test(String(batch_root))) {
      return NextResponse.json(
        { error: "Missing or invalid 64-char hex batch_root" },
        { status: 400 }
      );
    }

    // Verify batch_root belongs to a confirmed batch owned by session.orgId
    const supabase = createServiceClient();
    const { data: anchoredRun, error: runErr } = await supabase
      .from("payroll_runs")
      .select("id, org_id, merkle_root, anchor_verified")
      .eq("org_id", auth.session.orgId)
      .eq("merkle_root", String(batch_root).toLowerCase())
      .eq("status", "completed")
      .limit(1)
      .maybeSingle();

    if (runErr || !anchoredRun) {
      return NextResponse.json(
        {
          error:
            "batch_root does not match a confirmed, L1-anchored payroll run for this organization.",
          code: "UNKNOWN_BATCH_ROOT",
        },
        { status: 403 }
      );
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json(
        { error: "Missing or empty recipients list" },
        { status: 400 }
      );
    }

    const offrampRows = recipients.filter(
      (r: any) => r.rail === "ngn_bank" || r.rail === "kes_mpesa"
    );

    if (offrampRows.length === 0) {
      return NextResponse.json(
        { message: "No off-ramp recipients in batch", count: 0, receipts: [] },
        { status: 200 }
      );
    }

    // Fetch live mid-market reference benchmark strictly server-side (sanity-check guardrail)
    let referenceBenchmark;
    try {
      referenceBenchmark = await fetchLiveFxQuote({ bypassCache: true });
    } catch (fxErr) {
      const detail = fxErr instanceof Error ? fxErr.message : String(fxErr);
      console.error("[Aegis Offramp API] Mid-market FX sanity benchmark failed:", detail);
      return NextResponse.json(
        {
          error:
            "Live FX reference sanity-check feed unavailable. Off-ramp disbursement aborted safely.",
          code:
            fxErr instanceof FxQuoteUnavailableError
              ? "FX_UPSTREAM_UNAVAILABLE"
              : "FX_ERROR",
          detail,
        },
        { status: 503 }
      );
    }

    const validRecipients: DisbursementRecipient[] = [];
    for (const r of offrampRows) {
      const amountUsd = Number(r.amountUsd);
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
        return NextResponse.json(
          { error: `Invalid amountUsd for recipient ${r.wallet || r.recipientId}` },
          { status: 400 }
        );
      }

      const currency: "NGN" | "KES" = r.rail === "kes_mpesa" ? "KES" : "NGN";
      const refEstimate = computeFiatPayoutFromQuote(
        amountUsd,
        currency,
        referenceBenchmark
      );

      validRecipients.push({
        recipientId: r.recipientId || r.wallet,
        wallet: r.wallet,
        amountUsd: refEstimate.amountUsd,
        amountLocal: refEstimate.amountLocal,
        currency: refEstimate.currency,
        rail: r.rail,
        destinationAccount: r.destinationAccount || "Bank Account",
        noteCommitment: r.noteCommitment || "0".repeat(64),
        referenceMidMarketRate: refEstimate.exchangeRate,
        referenceFxProvider: refEstimate.fxProvider,
        fxQuotedAt: refEstimate.fxQuotedAt,
        fxQuoteId: refEstimate.quoteId,
      });
    }

    const provider = getOfframpProvider();
    let receipts;
    try {
      receipts = await provider.disburseBatch(validRecipients, batch_root);
    } catch (disburseErr) {
      if (disburseErr instanceof FxSanityCheckError) {
        return NextResponse.json(
          {
            error: "Partner applied FX rate failed mid-market sanity guardrail.",
            code: "FX_SANITY_CHECK_FAILED",
            detail: disburseErr.message,
          },
          { status: 422 }
        );
      }
      throw disburseErr;
    }

    return NextResponse.json({
      success: true,
      provider: provider.name,
      isSandbox: provider.isSandbox,
      batch_root,
      fx_reference_benchmark: {
        quote_id: referenceBenchmark.quoteId,
        provider: referenceBenchmark.provider,
        role: "sanity_check_only",
        quoted_at: referenceBenchmark.quotedAt,
        source_updated_at: referenceBenchmark.sourceUpdatedAt,
        rates: referenceBenchmark.rates,
      },
      count: receipts.length,
      receipts,
    });
  } catch (error) {
    console.error("[Aegis Offramp API] Error dispatching disbursements:", error);
    return NextResponse.json(
      {
        error: "Internal server error during off-ramp dispatch",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
