import { randomUUID } from "crypto";

/**
 * Live Server-Side FX Reference Benchmark & Partner Rate Sanity Guardrail.
 *
 * Commercial & Accounting Invariant:
 * - Never hardcode exchange rates inside React hooks or silently fall back to
 *   stale static numbers during payroll disbursement.
 * - `open.er-api.com` is used STRICTLY as a live mid-market reference benchmark
 *   and sanity-check guardrail — NOT as an authoritative bank execution rate.
 * - Payout receipts stamp the payout partner's actual `appliedRate` (e.g.
 *   Kotani Pay applied execution rate) alongside `referenceMidMarketRate` and
 *   `fxSpreadBps` so every receipt reconciles 1:1 against the partner statement.
 */

export const FX_PROVIDER_NAME = "ExchangeRate-API Mid-Market Reference (open.er-api.com)";
export const FX_UPSTREAM_URL = "https://open.er-api.com/v6/latest/USD";
export const DEFAULT_MAX_FX_DEVIATION_BPS = 500; // 5.00% max deviation vs. mid-market sanity check

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

export interface PartnerRateSanityResult {
  appliedRate: number;
  referenceMidMarketRate: number;
  spreadBps: number;
  maxDeviationBps: number;
  withinGuardrail: boolean;
}

export class FxQuoteUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxQuoteUnavailableError";
  }
}

export class FxSanityCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxSanityCheckError";
  }
}

let cachedFeed: {
  rates: LiveFxRates;
  providerUrl: string;
  sourceUpdatedAt: string;
  fetchedAtMs: number;
} | null = null;

const CACHE_TTL_MS = 30_000; // 30s reference cache

/**
 * Fetches live USD -> NGN / KES mid-market reference rates from ExchangeRate-API.
 * Used as the pre-dispatch estimate and partner-rate sanity-check benchmark.
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
      quoteId: `fx_ref_${randomUUID()}`,
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
      `Live FX reference feed unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    throw new FxQuoteUnavailableError(
      `Live FX reference provider returned HTTP ${res.status}`
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
      "Live FX reference provider returned invalid NGN/KES payload."
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
    quoteId: `fx_ref_${randomUUID()}`,
    provider: FX_PROVIDER_NAME,
    providerUrl,
    quotedAt,
    sourceUpdatedAt,
    rates,
    cached: false,
  };
}

/**
 * Validates a payout partner's applied execution rate against the live
 * mid-market reference benchmark. Rejects corrupted or predatory spreads
 * exceeding `maxDeviationBps` (default 500 bps / 5.0%).
 */
export function validatePartnerAppliedRate(params: {
  appliedRate: number;
  referenceMidMarketRate: number;
  currency: "NGN" | "KES";
  maxDeviationBps?: number;
}): PartnerRateSanityResult {
  const maxDeviationBps = params.maxDeviationBps ?? DEFAULT_MAX_FX_DEVIATION_BPS;
  if (!Number.isFinite(params.appliedRate) || params.appliedRate <= 0) {
    throw new FxSanityCheckError(
      `Invalid partner applied ${params.currency} rate: ${params.appliedRate}`
    );
  }
  if (
    !Number.isFinite(params.referenceMidMarketRate) ||
    params.referenceMidMarketRate <= 0
  ) {
    throw new FxSanityCheckError(
      `Invalid mid-market reference ${params.currency} rate: ${params.referenceMidMarketRate}`
    );
  }

  const spreadBps = Math.round(
    ((params.appliedRate - params.referenceMidMarketRate) /
      params.referenceMidMarketRate) *
      10_000
  );
  const withinGuardrail = Math.abs(spreadBps) <= maxDeviationBps;

  if (!withinGuardrail) {
    throw new FxSanityCheckError(
      `Partner applied ${params.currency} rate (${params.appliedRate}) deviates by ${spreadBps} bps from mid-market reference (${params.referenceMidMarketRate}), exceeding ${maxDeviationBps} bps guardrail.`
    );
  }

  return {
    appliedRate: Number(params.appliedRate.toFixed(4)),
    referenceMidMarketRate: Number(params.referenceMidMarketRate.toFixed(4)),
    spreadBps,
    maxDeviationBps,
    withinGuardrail: true,
  };
}

/**
 * Computes a reference local currency estimate from the mid-market benchmark.
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
