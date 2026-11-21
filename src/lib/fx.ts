import { randomUUID } from "crypto";

/**
 * Live Server-Side FX Quote Service.
 *
 * Commercial invariant:
 * - Never hardcode exchange rates inside React hooks or silently fall back to
 *   stale static numbers during payroll disbursement.
 * - Every off-ramp payout is quoted server-side at dispatch time, stamped with
 *   `quoteId`, `provider`, `quotedAt`, and `sourceUpdatedAt`, and fails loud
 *   with HTTP 503 if the live FX feed is unavailable.
 */

export const FX_PROVIDER_NAME = "ExchangeRate-API (open.er-api.com)";
export const FX_UPSTREAM_URL = "https://open.er-api.com/v6/latest/USD";

interface UpstreamFxResponse {
  result: string;
  provider?: string;
  time_last_update_utc?: string;
  rates?: Record<string, number>;
}

export interface LiveFxRates {
  NGN: number;
  KES: number;
  NGN_OFFICIAL: number;
}

export interface LiveFxQuote {
  quoteId: string;
  provider: string;
  providerUrl: string;
  quotedAt: string;
  sourceUpdatedAt: string;
  rates: LiveFxRates;
  cached: boolean;
}

export interface FiatPayoutQuote {
  quoteId: string;
  currency: "NGN" | "KES";
  amountUsd: number;
  exchangeRate: number;
  amountLocal: number;
  fxProvider: string;
  fxQuotedAt: string;
  fxSourceUpdatedAt: string;
}

export class FxQuoteUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxQuoteUnavailableError";
  }
}

let cachedFeed: {
  rates: LiveFxRates;
  providerUrl: string;
  sourceUpdatedAt: string;
  fetchedAtMs: number;
} | null = null;

const CACHE_TTL_MS = 30_000; // 30s live quote cache

/**
 * Fetches live USD -> NGN / KES rates from ExchangeRate-API.
 * Throws `FxQuoteUnavailableError` on timeout, non-200 response, or malformed payload.
 */
export async function fetchLiveFxQuote(options?: {
  bypassCache?: boolean;
}): Promise<LiveFxQuote> {
  const nowMs = Date.now();
  const quotedAt = new Date(nowMs).toISOString();

  if (
    !options?.bypassCache &&
    cachedFeed &&
    nowMs - cachedFeed.fetchedAtMs < CACHE_TTL_MS
  ) {
    return {
      quoteId: `fx_${randomUUID()}`,
      provider: FX_PROVIDER_NAME,
      providerUrl: cachedFeed.providerUrl,
      quotedAt,
      sourceUpdatedAt: cachedFeed.sourceUpdatedAt,
      rates: cachedFeed.rates,
      cached: true,
    };
  }

  let res: Response;
  try {
    res = await fetch(FX_UPSTREAM_URL, {
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
  } catch (err) {
    throw new FxQuoteUnavailableError(
      `Live FX feed unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    throw new FxQuoteUnavailableError(
      `Live FX provider returned HTTP ${res.status}`
    );
  }

  const data = (await res.json()) as UpstreamFxResponse;
  const ngnRaw = Number(data.rates?.NGN);
  const kesRaw = Number(data.rates?.KES);

  if (
    data.result !== "success" ||
    !Number.isFinite(ngnRaw) ||
    ngnRaw <= 0 ||
    !Number.isFinite(kesRaw) ||
    kesRaw <= 0
  ) {
    throw new FxQuoteUnavailableError(
      "Live FX provider returned invalid NGN/KES quote payload."
    );
  }

  const rates: LiveFxRates = {
    NGN: Number(ngnRaw.toFixed(2)),
    KES: Number(kesRaw.toFixed(2)),
    NGN_OFFICIAL: Number(ngnRaw.toFixed(2)),
  };

  const providerUrl = data.provider || "https://www.exchangerate-api.com";
  const sourceUpdatedAt = data.time_last_update_utc || quotedAt;

  cachedFeed = {
    rates,
    providerUrl,
    sourceUpdatedAt,
    fetchedAtMs: nowMs,
  };

  return {
    quoteId: `fx_${randomUUID()}`,
    provider: FX_PROVIDER_NAME,
    providerUrl,
    quotedAt,
    sourceUpdatedAt,
    rates,
    cached: false,
  };
}

/**
 * Computes a stamped server-side local fiat payout from a live FX quote.
 */
export function computeFiatPayoutFromQuote(
  amountUsd: number,
  currency: "NGN" | "KES",
  quote: LiveFxQuote
): FiatPayoutQuote {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error(`Invalid USD payout amount: ${amountUsd}`);
  }
  const rate = currency === "KES" ? quote.rates.KES : quote.rates.NGN;
  const amountLocal = Math.round(amountUsd * rate * 100) / 100;

  return {
    quoteId: quote.quoteId,
    currency,
    amountUsd,
    exchangeRate: rate,
    amountLocal,
    fxProvider: quote.provider,
    fxQuotedAt: quote.quotedAt,
    fxSourceUpdatedAt: quote.sourceUpdatedAt,
  };
}
