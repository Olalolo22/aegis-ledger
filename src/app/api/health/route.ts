import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/health
 *
 * Health check endpoint that verifies connectivity to:
 * - Supabase (PostgreSQL)
 * - Upstash Redis
 *
 * Returns 200 if all services are reachable, 503 if any are down.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; latency_ms: number; error?: string }> = {};

  //Supabase Check 
  const supaStart = Date.now();
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("organizations")
      .select("id")
      .limit(1);

    checks.supabase = {
      ok: !error,
      latency_ms: Date.now() - supaStart,
      ...(error && { error: error.message }),
    };
  } catch (e) {
    checks.supabase = {
      ok: false,
      latency_ms: Date.now() - supaStart,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }

  //  Redis Check 
  const redisStart = Date.now();
  try {
    const redis = getRedis();
    await redis.ping();
    checks.redis = {
      ok: true,
      latency_ms: Date.now() - redisStart,
    };
  } catch (e) {
    checks.redis = {
      ok: false,
      latency_ms: Date.now() - redisStart,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }

  //  Aggregate Status 
  const allHealthy = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      services: checks,
    },
    { status: allHealthy ? 200 : 503 }
  );
}
