import { NextResponse } from "next/server";

interface ExchangeRateResponse {
  result: string;
  time_last_update_utc: string;
  rates: Record<string, number>;
}

// In-memory cache for fast response and avoiding rate limits
let cachedData: {
  rates: { NGN: number; KES: number; NGN_OFFICIAL: number };
  updatedAt: string;
  timestamp: number;
} | null = null;

const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

export async function GET() {
  const now = Date.now();

  if (cachedData && now - cachedData.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({
      success: true,
      cached: true,
      ...cachedData,
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: controller.signal,
      next: { revalidate: 60 },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Upstream FX provider error: ${res.status}`);
    }

    const data: ExchangeRateResponse = await res.json();
    const officialNgn = Number(data.rates?.NGN) || 1331;
    const officialKes = Number(data.rates?.KES) || 129.6;

    // African Crypto Off-Ramp Spot Rates:
    // In Nigeria, peer-to-peer / crypto off-ramps (Providus, Kuda, Paycrest) trade at parallel market spot (~1.24x official).
    // In Kenya, crypto-to-M-Pesa executes within ~1% of interbank spot.
    const ngnSpot = Math.round(officialNgn * 1.24); // e.g. ~1,650 NGN
    const kesSpot = Number(officialKes.toFixed(2)); // e.g. ~129.6 KES

    cachedData = {
      rates: {
        NGN: ngnSpot,
        KES: kesSpot,
        NGN_OFFICIAL: Math.round(officialNgn),
      },
      updatedAt: data.time_last_update_utc || new Date().toISOString(),
      timestamp: now,
    };

    return NextResponse.json({
      success: true,
      cached: false,
      ...cachedData,
    });
  } catch (err: any) {
    console.warn("[Aegis FX] Live feed fallback triggered:", err?.message);

    // Reliable fallback if external network times out
    return NextResponse.json({
      success: true,
      cached: false,
      rates: {
        NGN: 1650,
        KES: 130,
        NGN_OFFICIAL: 1330,
      },
      updatedAt: new Date().toISOString(),
      timestamp: now,
      note: "Fallback active (Devnet mode)",
    });
  }
}
