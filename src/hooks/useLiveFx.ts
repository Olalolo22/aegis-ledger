"use client";

import { useState, useEffect } from "react";

export interface LiveFxState {
  rates: {
    NGN: number;
    KES: number;
    NGN_OFFICIAL?: number;
  };
  isLive: boolean;
  lastUpdated: string | null;
  loading: boolean;
}

const DEFAULT_RATES = {
  NGN: 1650,
  KES: 130,
  NGN_OFFICIAL: 1330,
};

export function useLiveFx(): LiveFxState {
  const [state, setState] = useState<LiveFxState>({
    rates: DEFAULT_RATES,
    isLive: false,
    lastUpdated: null,
    loading: true,
  });

  useEffect(() => {
    let isMounted = true;

    async function fetchRates() {
      try {
        const res = await fetch("/api/fx");
        if (!res.ok) throw new Error("Failed to fetch rates");
        const data = await res.json();
        if (isMounted && data?.rates) {
          setState({
            rates: {
              NGN: Number(data.rates.NGN) || DEFAULT_RATES.NGN,
              KES: Number(data.rates.KES) || DEFAULT_RATES.KES,
              NGN_OFFICIAL: Number(data.rates.NGN_OFFICIAL) || DEFAULT_RATES.NGN_OFFICIAL,
            },
            isLive: true,
            lastUpdated: data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : "Live",
            loading: false,
          });
        }
      } catch (err) {
        if (isMounted) {
          setState(prev => ({
            ...prev,
            loading: false,
          }));
        }
      }
    }

    fetchRates();
    const interval = setInterval(fetchRates, 60000); // Poll every 60s

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return state;
}
