import { NextResponse } from "next/server";
import { FxQuoteUnavailableError, fetchLiveFxQuote } from "@/lib/fx";

export const dynamic = "force-dynamic";

/**
 * GET /api/fx
 *
 * Returns live USD -> NGN / KES spot quotes with provider attribution and timestamp.
 * Fails loud with HTTP 503 if the live FX provider is unavailable (zero hardcoded rates).
 */
export async function GET() {
  try {
    const quote = await fetchLiveFxQuote();
    return NextResponse.json(
      {
        success: true,
        cached: quote.cached,
        quoteId: quote.quoteId,
        provider: quote.provider,
        providerUrl: quote.providerUrl,
        quotedAt: quote.quotedAt,
        updatedAt: quote.sourceUpdatedAt,
        timestamp: Date.now(),
        rates: quote.rates,
      },
      { status: 200 }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[Aegis FX] Live quote unavailable:", detail);
    return NextResponse.json(
      {
        success: false,
        error: "Live FX quote feed is unavailable.",
        code: err instanceof FxQuoteUnavailableError ? "FX_UPSTREAM_UNAVAILABLE" : "FX_ERROR",
        detail,
      },
      { status: 503 }
    );
  }
}
