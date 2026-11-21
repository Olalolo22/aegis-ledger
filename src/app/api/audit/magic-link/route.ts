import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { SignJWT } from "jose";
import { createServiceClient } from "@/lib/supabase/server";
import { requireOrgAdminSession } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { magicLinkRequestSchema } from "@/lib/validation";
import { deriveJwtSigningKey, hashAuditorIdentity } from "@/lib/crypto";

/**
 * POST /api/audit/magic-link
 *
 * Authenticated org admin endpoint creating a single-use magic link for a
 * viewing key owned strictly by `session.orgId`.
 */
export async function POST(request: NextRequest) {
  const auth = await requireOrgAdminSession(request);
  if (!auth.ok) return auth.response;

  // ─── Parse & Validate ─────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = magicLinkRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  const { viewing_key_id, auditor_identity } = parsed.data;

  // ─── Fetch Viewing Key (scoped strictly to session.orgId) ─
  const supabase = createServiceClient();
  const { data: vk, error: vkError } = await supabase
    .from("viewing_keys")
    .select(
      "id, org_id, key_id, valid_from, valid_until, allowed_tokens, auditor_identity_hash, auditor_identity_salt, revoked"
    )
    .eq("id", viewing_key_id)
    .eq("org_id", auth.session.orgId)
    .single();

  if (vkError || !vk) {
    return NextResponse.json(
      { error: "Viewing key not found" },
      { status: 404 }
    );
  }

  // ─── Verify Auditor Identity ──────────────────────────────
  // Re-hash the provided identity with the stored salt and compare
  const computedHash = hashAuditorIdentity(
    auditor_identity,
    vk.auditor_identity_salt
  );
  if (computedHash !== vk.auditor_identity_hash) {
    return NextResponse.json(
      { error: "Auditor identity verification failed" },
      { status: 403 }
    );
  }

  // ─── Check Validity ───────────────────────────────────────
  if (vk.revoked) {
    return NextResponse.json(
      { error: "This viewing key has been revoked" },
      { status: 403 }
    );
  }

  const now = new Date();
  const validUntil = new Date(vk.valid_until);
  if (validUntil <= now) {
    return NextResponse.json(
      { error: "This viewing key has expired" },
      { status: 403 }
    );
  }

  // ─── Create Signed JWT ────────────────────────────────────
  let jwtSecret: Uint8Array;
  try {
    jwtSecret = deriveJwtSigningKey();
  } catch {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const jwt = await new SignJWT({
    sub: vk.auditor_identity_hash,
    vk_id: vk.id,
    key_id: vk.key_id,
    org_id: vk.org_id,
    valid_from: vk.valid_from,
    valid_until: vk.valid_until,
    allowed_tokens: vk.allowed_tokens,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(validUntil)
    .setIssuer("aegis-ledger")
    .sign(jwtSecret);

  // ─── Store JWT in Redis (single-use, 15-min TTL) ──────────
  const magicToken = randomUUID();
  const redisKey = `aegis:magic-link:${magicToken}`;
  const MAGIC_LINK_TTL = 900; // 15 minutes

  const redis = getRedis();
  await redis.set(redisKey, jwt, { ex: MAGIC_LINK_TTL });

  // ─── Return Magic Link URL ────────────────────────────────
  // The frontend audit portal will call /api/audit/verify?token=<magicToken>
  const baseUrl = request.nextUrl.origin;
  const magicLinkUrl = `${baseUrl}/audit?token=${magicToken}`;

  // Audit log
  await supabase.from("audit_log").insert({
    event_type: "magic_link_created",
    org_id: vk.org_id,
    metadata: {
      viewing_key_id: vk.id,
      expires_in_seconds: MAGIC_LINK_TTL,
      // No auditor identity in logs
    },
  });

  return NextResponse.json(
    {
      magic_link: magicLinkUrl,
      token: magicToken,
      expires_in_seconds: MAGIC_LINK_TTL,
      viewing_key_valid_until: vk.valid_until,
      message:
        "Share this link with the auditor. It is single-use and expires in 15 minutes.",
    },
    { status: 201 }
  );
}
