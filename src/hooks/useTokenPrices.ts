"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Live token price hook.
 *
 * Fetches SOL, USDC, and USDT prices from CoinGecko's free API
 * every 30 seconds. Falls back to stale cached prices if the API
 * is unreachable. On first load, uses hardcoded fallback prices
 * so the UI is never empty.
 *
 * Usage:
 *   const { prices, getRate, isLive } = useTokenPrices();
 *   const solToUsdc = getRate("SOL", "USDC"); // e.g. 178.42
 */

// CoinGecko IDs
const COINGECKO_IDS = {
  SOL: "solana",
  USDC: "usd-coin",
  USDT: "tether",
} as const;

type TokenSymbol = keyof typeof COINGECKO_IDS;

interface TokenPrices {
  SOL: number;
  USDC: number;
  USDT: number;
}

// Hardcoded fallback — used only when CoinGecko is unreachable
// and we have no cached value. Updated manually as a safety net.
const FALLBACK_PRICES: TokenPrices = {
  SOL: 170.0,
  USDC: 1.0,
  USDT: 1.0,
};

const POLL_INTERVAL_MS = 30_000; // 30 seconds

export function useTokenPrices() {
  const [prices, setPrices] = useState<TokenPrices>(FALLBACK_PRICES);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPrices = useCallback(async () => {
    try {
      const ids = Object.values(COINGECKO_IDS).join(",");
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
        { signal: AbortSignal.timeout(8000) }
      );

      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);

      const data = await res.json();

      const newPrices: TokenPrices = {
        SOL: data[COINGECKO_IDS.SOL]?.usd ?? prices.SOL,
        USDC: data[COINGECKO_IDS.USDC]?.usd ?? prices.USDC,
        USDT: data[COINGECKO_IDS.USDT]?.usd ?? prices.USDT,
      };

      setPrices(newPrices);
      setIsLive(true);
      setLastUpdated(new Date());
    } catch (err) {
      console.warn("[Aegis Ledger] Price fetch failed, using cached/fallback:", err);
      setIsLive(false);
      // Keep the last known prices — don't reset to fallback
    }
  }, [prices.SOL, prices.USDC, prices.USDT]);

  useEffect(() => {
    // Fetch immediately on mount
    fetchPrices();

    // Then poll
    intervalRef.current = setInterval(fetchPrices, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Get the exchange rate between two tokens.
   * e.g. getRate("SOL", "USDC") returns how many USDC you get per 1 SOL.
   */
  const getRate = useCallback(
    (from: TokenSymbol, to: TokenSymbol): number => {
      if (from === to) return 1;
      // Both prices are in USD, so: rate = fromUSD / toUSD
      const fromUsd = prices[from];
      const toUsd = prices[to];
      if (toUsd === 0) return 0;
      return fromUsd / toUsd;
    },
    [prices]
  );

  return { prices, getRate, isLive, lastUpdated };
}
