import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

/**
 * GET /api/audit/verify?token=<magic_token>
 *
 * Consumes a single-use magic link token and returns the signed JWT.
 *
 * Flow:
 * 1. Extract the opaque token from the query string
 * 2. Look up the JWT in Redis under aegis:magic-link:{token}
 * 3. Delete the Redis entry (single-use: prevents replay)
 * 4. Return the JWT to the browser
 *
 * The frontend stores this JWT in memory (not localStorage) and uses it
 * as a Bearer token for subsequent /api/audit/decrypt calls.
 *
 * Security:
 * - The Redis entry is deleted after first use — the link cannot be reused
 * - The token is opaque (random UUID) — not predictable or brute-forceable
 * - The JWT itself has a built-in expiration matching the viewing key's valid_until
 * - No permanent record of which auditor accessed what (stateless after consumption)
 */
export async function GET(request: NextRequest) {
  // ─── 1. Extract Token ────────────────────────────────────────
  const token = request.nextUrl.searchParams.get("token");

  if (!token || token.length < 32) {
    return NextResponse.json(
      { error: "Missing or invalid magic link token" },
      { status: 400 }
    );
  }

  // ─── 2. Look Up JWT in Redis ─────────────────────────────────
  const redis = getRedis();
  const redisKey = `aegis:magic-link:${token}`;
  const jwt = await redis.get<string>(redisKey);

  if (!jwt) {
    return NextResponse.json(
      {
        error: "Magic link is invalid, expired, or has already been used",
        code: "MAGIC_LINK_CONSUMED",
      },
      { status: 410 } // 410 Gone
    );
  }

  // ─── 3. Delete Redis Entry (Single-Use) ──────────────────────
  await redis.del(redisKey);

  // ─── 4. Return JWT ───────────────────────────────────────────
  return NextResponse.json(
    {
      access_token: jwt,
      token_type: "Bearer",
      message:
        "Store this token in memory only (not localStorage). " +
        "Use it as Authorization: Bearer <token> for /api/audit/decrypt calls.",
    },
    { status: 200 }
  );
}
