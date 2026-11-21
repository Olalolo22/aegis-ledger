"use client";

import { useState, useEffect } from "react";

export interface LiveFxState {
  rates: {
    NGN: number;
    KES: number;
    NGN_OFFICIAL?: number;
  };
  isLive: boolean;
  provider: string | null;
  lastUpdated: string | null;
  loading: boolean;
}

const PREVIEW_PLACEHOLDER_RATES = {
  NGN: 0,
  KES: 0,
  NGN_OFFICIAL: 0,
};

/**
 * UI display preview hook for live spot FX rates.
 * Note: Actual payout conversion rates are NEVER read from this React hook —
 * `/api/payroll/dispatch-offramp` quotes live FX server-side at disbursement time.
 */
export function useLiveFx(): LiveFxState {
  const [state, setState] = useState<LiveFxState>({
    rates: PREVIEW_PLACEHOLDER_RATES,
    isLive: false,
    provider: null,
    lastUpdated: null,
    loading: true,
  });

  useEffect(() => {
    let isMounted = true;

    async function fetchRates() {
      try {
        const res = await fetch("/api/fx");
        if (!res.ok) throw new Error(`FX feed returned ${res.status}`);
        const data = await res.json();
        if (isMounted && data?.rates?.NGN && data?.rates?.KES) {
          setState({
            rates: {
              NGN: Number(data.rates.NGN),
              KES: Number(data.rates.KES),
              NGN_OFFICIAL: Number(data.rates.NGN_OFFICIAL || data.rates.NGN),
            },
            isLive: true,
            provider: data.provider || "ExchangeRate-API",
            lastUpdated: data.updatedAt
              ? new Date(data.updatedAt).toLocaleTimeString()
              : "Live",
            loading: false,
          });
        }
      } catch {
        if (isMounted) {
          setState((prev) => ({
            ...prev,
            isLive: false,
            loading: false,
          }));
        }
      }
    }

    fetchRates();
    const interval = setInterval(fetchRates, 60000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return state;
}
