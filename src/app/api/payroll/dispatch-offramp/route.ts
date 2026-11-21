import { NextRequest, NextResponse } from "next/server";
import { getOfframpProvider, DisbursementRecipient } from "@/lib/offramp";
import {
  FxQuoteUnavailableError,
  computeFiatPayoutFromQuote,
  fetchLiveFxQuote,
} from "@/lib/fx";

/**
 * POST /api/payroll/dispatch-offramp
 *
 * Dispatches NGN Bank / KES M-Pesa payouts using a live server-side FX quote
 * fetched at dispatch time. Never trusts client-computed local fiat amounts
 * or hardcoded React exchange rates.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { batch_root, recipients } = body;

    if (!batch_root || !/^[0-9a-fA-F]{64}$/.test(String(batch_root))) {
      return NextResponse.json(
        { error: "Missing or invalid 64-char hex batch_root" },
        { status: 400 }
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

    // Fetch live FX quote strictly server-side at dispatch time (bypass cache for locked execution quote)
    let liveQuote;
    try {
      liveQuote = await fetchLiveFxQuote({ bypassCache: true });
    } catch (fxErr) {
      const detail = fxErr instanceof Error ? fxErr.message : String(fxErr);
      console.error("[Aegis Offramp API] Live FX quote failed:", detail);
      return NextResponse.json(
        {
          error: "Live FX quote feed unavailable. Off-ramp disbursement aborted safely.",
          code: fxErr instanceof FxQuoteUnavailableError ? "FX_UPSTREAM_UNAVAILABLE" : "FX_ERROR",
          detail,
        },
        { status: 503 }
      );
    }

    // Compute local currency amounts strictly server-side from the locked live quote
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
      const stamped = computeFiatPayoutFromQuote(amountUsd, currency, liveQuote);

      validRecipients.push({
        recipientId: r.recipientId || r.wallet,
        wallet: r.wallet,
        amountUsd: stamped.amountUsd,
        amountLocal: stamped.amountLocal,
        currency: stamped.currency,
        rail: r.rail,
        destinationAccount: r.destinationAccount || "Bank Account",
        noteCommitment: r.noteCommitment || "0".repeat(64),
        exchangeRate: stamped.exchangeRate,
        fxProvider: stamped.fxProvider,
        fxQuotedAt: stamped.fxQuotedAt,
        fxQuoteId: stamped.quoteId,
      });
    }

    const provider = getOfframpProvider();
    const receipts = await provider.disburseBatch(validRecipients, batch_root);

    return NextResponse.json({
      success: true,
      provider: provider.name,
      isSandbox: provider.isSandbox,
      batch_root,
      fx_quote: {
        quote_id: liveQuote.quoteId,
        provider: liveQuote.provider,
        quoted_at: liveQuote.quotedAt,
        source_updated_at: liveQuote.sourceUpdatedAt,
        rates: liveQuote.rates,
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
