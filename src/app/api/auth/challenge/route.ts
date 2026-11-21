import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  buildSessionLoginMessage,
  buildVaultActionMessage,
  generateAuthNonce,
  requireOrgAdminSession,
} from "@/lib/auth";
import { authChallengeRequestSchema } from "@/lib/validation";

/**
 * POST /api/auth/challenge
 *
 * Issues a single-use cryptographic challenge nonce persisted in Postgres
 * (`auth_challenges`) for either:
 * - `session_login`: Sign-In With Solana (SIWS) session creation (5-min TTL)
 * - `vault_register` / `vault_rotate`: per-mutation Ed25519 authorization
 *   bound strictly to `(session.orgId, action, target_fingerprint, session.walletPubkey)`
 *   (2-min TTL). Requires an active org admin session.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = authChallengeRequestSchema.safeParse(body);
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

  const { purpose, wallet_pubkey, target_fingerprint } = parsed.data;
  const domain = request.nextUrl.host || "aegis-ledger";
  const nonce = generateAuthNonce();
  const now = new Date();
  const issuedAt = now.toISOString();

  let orgId: string | null = null;
  let expiresAt: string;
  let message: string;
  let normalizedTargetFp: string | null = null;

  if (purpose === "vault_register" || purpose === "vault_rotate") {
    const auth = await requireOrgAdminSession(request);
    if (!auth.ok) return auth.response;

    if (auth.session.walletPubkey !== wallet_pubkey) {
      return NextResponse.json(
        {
          error:
            "Challenge wallet_pubkey must match the authenticated admin session wallet.",
          code: "WALLET_MISMATCH",
        },
        { status: 403 }
      );
    }

    if (!target_fingerprint) {
      return NextResponse.json(
        {
          error: `target_fingerprint is required for ${purpose} authorization.`,
        },
        { status: 400 }
      );
    }

    orgId = auth.session.orgId;
    normalizedTargetFp = target_fingerprint.toLowerCase();
    expiresAt = new Date(now.getTime() + 2 * 60 * 1000).toISOString(); // 2 min TTL
    message = buildVaultActionMessage({
      domain,
      orgId,
      action: purpose,
      targetFingerprint: normalizedTargetFp,
      signerWallet: wallet_pubkey,
      nonce,
      issuedAt,
      expiresAt,
    });
  } else {
    expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // 5 min TTL
    message = buildSessionLoginMessage({
      domain,
      walletPubkey: wallet_pubkey,
      nonce,
      issuedAt,
      expiresAt,
    });
  }

  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("auth_challenges").insert({
      nonce,
      purpose,
      wallet_pubkey,
      org_id: orgId,
      target_fingerprint: normalizedTargetFp,
      message,
      expires_at: expiresAt,
    });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json(
      {
        nonce,
        purpose,
        org_id: orgId,
        target_fingerprint: normalizedTargetFp,
        message,
        issued_at: issuedAt,
        expires_at: expiresAt,
      },
      { status: 201 }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Failed to persist authentication challenge nonce.",
        detail,
      },
      { status: 503 }
    );
  }
}
