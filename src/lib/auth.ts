import {
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify as nodeVerify,
} from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { SignJWT, jwtVerify } from "jose";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Solana Wallet-Native Organization Authentication & Per-Mutation Authorization.
 *
 * Why SIWS (Ed25519) instead of Supabase Auth email/password:
 * - Aegis is a non-custodial Solana treasury app; organizations are rooted in
 *   Solana wallets (treasury / Squads signers), not Web2 email accounts.
 * - Every table in Postgres denies `anon` access via RLS (`service_role` only);
 *   no browser client ever queries Supabase directly.
 * - Every org-scoped API route calls `requireOrgAdminSession(request)` which:
 *     1. Verifies the HttpOnly `aegis_admin_session` JWT (domain-separated HKDF key).
 *     2. Re-checks live membership in `org_admins` (`status = 'active'`).
 *     3. Returns `session.orgId` — callers NEVER control `org_id` via query/body.
 * - High-privilege key-vault mutations (`POST`/`PATCH /api/org/key-vault`)
 *   ADDITIONALLY require a fresh Ed25519 signature from the already-registered
 *   admin wallet over an atomic single-use Postgres nonce bound to
 *   `(org_id, action, target_fingerprint, signer_wallet)`.
 */

export const ADMIN_SESSION_COOKIE = "aegis_admin_session";
const ADMIN_SESSION_ISSUER = "aegis-ledger-admin";
const ADMIN_SESSION_AUDIENCE = "aegis-org-api";
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type OrgAdminMembershipRole = "owner" | "admin" | "backup_controller";
export type AuthChallengePurpose =
  | "session_login"
  | "vault_register"
  | "vault_rotate"
  | "admin_add"
  | "admin_revoke";

export interface OrgAdminSession {
  walletPubkey: string;
  orgId: string;
  role: OrgAdminMembershipRole;
}

interface AdminSessionJwtClaims {
  sub: string;
  org_id: string;
  role: OrgAdminMembershipRole;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

/**
 * Derives a dedicated 32-byte HMAC-SHA256 signing key for org admin session JWTs
 * via HKDF-SHA256, domain-separated from both viewing keys and auditor JWTs.
 */
export function deriveAdminSessionJwtKey(): Uint8Array {
  const hex = process.env.AEGIS_MASTER_SECRET;
  if (!hex || hex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "AEGIS_MASTER_SECRET must be a 64-character hex string (32 bytes)."
    );
  }
  const master = Buffer.from(hex, "hex");
  const derived = hkdfSync(
    "sha256",
    master,
    Buffer.from("aegis-admin-session-salt-v1", "utf-8"),
    Buffer.from("aegis-org-admin-session-jwt-v1", "utf-8"),
    32
  );
  return new Uint8Array(derived);
}

/**
 * Generates a cryptographically secure 24-byte hex challenge nonce.
 */
export function generateAuthNonce(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Builds the canonical Sign-In With Solana (SIWS) login message.
 */
export function buildSessionLoginMessage(params: {
  domain: string;
  walletPubkey: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    "Aegis Ledger — Sign-In With Solana",
    `Domain: ${params.domain}`,
    `Wallet: ${params.walletPubkey}`,
    "Purpose: session_login",
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expires At: ${params.expiresAt}`,
  ].join("\n");
}

/**
 * Builds the canonical per-mutation Ed25519 authorization message bound strictly
 * to `orgId`, `action`, `targetFingerprint`, `signerWallet`, and single-use `nonce`.
 */
export function buildVaultActionMessage(params: {
  domain: string;
  orgId: string;
  action: "vault_register" | "vault_rotate";
  targetFingerprint: string;
  signerWallet: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    "Aegis Ledger — Organization Key Vault Authorization",
    `Domain: ${params.domain}`,
    `Organization: ${params.orgId}`,
    `Action: ${params.action}`,
    `Target Fingerprint: ${params.targetFingerprint.toLowerCase()}`,
    `Signer Wallet: ${params.signerWallet}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expires At: ${params.expiresAt}`,
  ].join("\n");
}

/**
 * Decodes a 64-byte Ed25519 signature encoded in either base58 or base64.
 */
function decodeSignatureBytes(signature: string): Buffer | null {
  const trimmed = signature.trim();
  // Try base58 first (standard Solana wallet adapter encoding)
  try {
    const b58 = bs58.decode(trimmed);
    if (b58.length === 64) {
      return Buffer.from(b58);
    }
  } catch {
    // Fall through to base64
  }
  try {
    const b64 = Buffer.from(trimmed, "base64");
    if (b64.length === 64) {
      return b64;
    }
  } catch {
    // Invalid encoding
  }
  return null;
}

/**
 * Verifies a Solana wallet Ed25519 signature over `message` using Node's native
 * `crypto.verify` (zero external native dependencies).
 */
export function verifySolanaWalletSignature(params: {
  walletPubkey: string;
  message: string;
  signature: string;
}): boolean {
  try {
    const pubkeyBytes = Buffer.from(new PublicKey(params.walletPubkey).toBytes());
    if (pubkeyBytes.length !== 32) return false;

    const sigBytes = decodeSignatureBytes(params.signature);
    if (!sigBytes || sigBytes.length !== 64) return false;

    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, pubkeyBytes]);
    const keyObj = createPublicKey({
      key: spkiDer,
      format: "der",
      type: "spki",
    });

    return nodeVerify(
      null,
      Buffer.from(params.message, "utf-8"),
      keyObj,
      sigBytes
    );
  } catch {
    return false;
  }
}

/**
 * Mints a signed HS256 org admin session JWT bound to `(walletPubkey, orgId, role)`.
 */
export async function mintOrgAdminSessionToken(
  session: OrgAdminSession,
  ttlSeconds: number = ADMIN_SESSION_TTL_SECONDS
): Promise<string> {
  const key = deriveAdminSessionJwtKey();
  return new SignJWT({
    org_id: session.orgId,
    role: session.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.walletPubkey)
    .setIssuer(ADMIN_SESSION_ISSUER)
    .setAudience(ADMIN_SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

/**
 * Verifies an org admin session JWT without touching the DB (unit-testable primitive).
 */
export async function verifyOrgAdminSessionToken(
  token: string
): Promise<OrgAdminSession | null> {
  try {
    const key = deriveAdminSessionJwtKey();
    const { payload } = await jwtVerify(token, key, {
      issuer: ADMIN_SESSION_ISSUER,
      audience: ADMIN_SESSION_AUDIENCE,
    });
    const claims = payload as unknown as AdminSessionJwtClaims;
    if (!claims.sub || !claims.org_id || !claims.role) {
      return null;
    }
    return {
      walletPubkey: claims.sub,
      orgId: claims.org_id,
      role: claims.role,
    };
  } catch {
    return null;
  }
}

/**
 * Sets the `HttpOnly`, `SameSite=Strict` org admin session cookie on a response.
 */
export function attachAdminSessionCookie(
  response: NextResponse,
  token: string
): void {
  response.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
}

/**
 * Clears the org admin session cookie on logout.
 */
export function clearAdminSessionCookie(response: NextResponse): void {
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

function extractAdminSessionToken(request: NextRequest): string | null {
  const cookieToken = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (cookieToken) return cookieToken;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim() || null;
  }
  return null;
}

/**
 * Mandatory authorization gate for EVERY organization-scoped API route.
 *
 * 1. Verifies the signed `aegis_admin_session` JWT (cookie or Bearer header).
 * 2. Performs a LIVE membership lookup in `org_admins` (`status = 'active'`)
 *    so revoking an admin wallet immediately blocks access even before JWT expiry.
 * 3. Returns the authoritative `session.orgId` — routes MUST NOT read `org_id`
 *    from query strings or request bodies.
 */
export async function requireOrgAdminSession(
  request: NextRequest
): Promise<
  | { ok: true; session: OrgAdminSession }
  | { ok: false; response: NextResponse }
> {
  const token = extractAdminSessionToken(request);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Authentication required. Sign in with an authorized organization Solana wallet.",
          code: "AUTH_REQUIRED",
        },
        { status: 401 }
      ),
    };
  }

  let claims: OrgAdminSession | null;
  try {
    claims = await verifyOrgAdminSessionToken(token);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Server authentication configuration error", code: "AUTH_CONFIG_ERROR" },
        { status: 500 }
      ),
    };
  }

  if (!claims) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Invalid or expired organization session. Please sign in again.",
          code: "INVALID_SESSION",
        },
        { status: 401 }
      ),
    };
  }

  // Live membership check against Postgres (revoking an admin kills session immediately)
  const supabase = createServiceClient();
  const { data: adminRow, error: adminErr } = await supabase
    .from("org_admins")
    .select("org_id, wallet_pubkey, role, status")
    .eq("org_id", claims.orgId)
    .eq("wallet_pubkey", claims.walletPubkey)
    .eq("status", "active")
    .maybeSingle();

  if (adminErr) {
    console.error("[Aegis Auth] Live org_admins membership check failed:", adminErr);
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Organization authorization service unavailable.",
          code: "AUTH_BACKEND_UNAVAILABLE",
        },
        { status: 503 }
      ),
    };
  }

  if (!adminRow) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Wallet is not an active administrator for this organization.",
          code: "FORBIDDEN_ORG_ACCESS",
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    session: {
      walletPubkey: adminRow.wallet_pubkey,
      orgId: adminRow.org_id,
      role: adminRow.role as OrgAdminMembershipRole,
    },
  };
}

export interface WalletChallengeRecord {
  nonce: string;
  purpose: AuthChallengePurpose;
  wallet_pubkey: string;
  org_id: string | null;
  target_fingerprint: string | null;
  message: string;
}

export interface WalletChallengeStore {
  findActive: (params: {
    nonce: string;
    purpose: AuthChallengePurpose;
    walletPubkey: string;
    expectedOrgId?: string;
    expectedTargetFingerprint?: string;
    nowIso: string;
  }) => Promise<{ data: WalletChallengeRecord | null; error: unknown }>;
  consumeActive: (params: {
    nonce: string;
    purpose: AuthChallengePurpose;
    walletPubkey: string;
    expectedOrgId?: string;
    expectedTargetFingerprint?: string;
    consumedAtIso: string;
  }) => Promise<{ consumed: boolean; error: unknown }>;
}

/**
 * Core verify-then-consume state machine (dependency-injectable for invariant testing):
 * 1. Read-only lookup of active unconsumed, unexpired challenge.
 * 2. Verify Ed25519 signature BEFORE mutating DB so invalid/garbage signatures
 *    cannot burn a live challenge nonce (availability protection).
 * 3. Atomically consume with conditional `UPDATE ... WHERE consumed_at IS NULL
 *    AND expires_at > now()` so concurrent/replayed submissions with a valid
 *    signature can succeed at most once.
 */
export async function verifyAndConsumeChallengeWithStore(
  store: WalletChallengeStore,
  params: {
    nonce: string;
    purpose: AuthChallengePurpose;
    walletPubkey: string;
    signature: string;
    expectedOrgId?: string;
    expectedTargetFingerprint?: string;
  }
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const nowIso = new Date().toISOString();

  const { data: challenge, error: findErr } = await store.findActive({
    nonce: params.nonce,
    purpose: params.purpose,
    walletPubkey: params.walletPubkey,
    expectedOrgId: params.expectedOrgId,
    expectedTargetFingerprint: params.expectedTargetFingerprint,
    nowIso,
  });

  if (findErr) {
    console.error("[Aegis Auth] Challenge lookup DB error:", findErr);
    return { ok: false, error: "Authentication challenge store unavailable." };
  }

  if (!challenge) {
    return {
      ok: false,
      error:
        "Challenge nonce is missing, expired, already used, or does not match org/action/fingerprint.",
    };
  }

  // Verify Ed25519 signature BEFORE claiming the nonce
  const sigValid = verifySolanaWalletSignature({
    walletPubkey: params.walletPubkey,
    message: challenge.message,
    signature: params.signature,
  });

  if (!sigValid) {
    return {
      ok: false,
      error: "Invalid Ed25519 wallet signature for authorization challenge.",
    };
  }

  // Signature is valid — now atomically consume the single-use nonce
  const consumedAtIso = new Date().toISOString();
  const { consumed, error: consumeErr } = await store.consumeActive({
    nonce: params.nonce,
    purpose: params.purpose,
    walletPubkey: params.walletPubkey,
    expectedOrgId: params.expectedOrgId,
    expectedTargetFingerprint: params.expectedTargetFingerprint,
    consumedAtIso,
  });

  if (consumeErr) {
    console.error("[Aegis Auth] Challenge consumption DB error:", consumeErr);
    return { ok: false, error: "Authentication challenge store unavailable." };
  }

  if (!consumed) {
    return {
      ok: false,
      error:
        "Challenge nonce was already consumed or expired during verification.",
    };
  }

  return { ok: true, message: challenge.message };
}

/**
 * Verifies the Ed25519 wallet signature against an active `auth_challenges` row
 * and ONLY THEN atomically consumes the single-use nonce.
 *
 * - Availability-safe: invalid signatures never burn a live challenge nonce.
 * - Replay-proof: `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()`
 *   guarantees concurrent or repeated valid submissions can succeed at most once.
 */
export async function verifyAndConsumeWalletChallenge(params: {
  nonce: string;
  purpose: AuthChallengePurpose;
  walletPubkey: string;
  signature: string;
  expectedOrgId?: string;
  expectedTargetFingerprint?: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const supabase = createServiceClient();

  const store: WalletChallengeStore = {
    async findActive(q) {
      let query = supabase
        .from("auth_challenges")
        .select("nonce, purpose, wallet_pubkey, org_id, target_fingerprint, message")
        .eq("nonce", q.nonce)
        .eq("purpose", q.purpose)
        .eq("wallet_pubkey", q.walletPubkey)
        .is("consumed_at", null)
        .gt("expires_at", q.nowIso);

      if (q.expectedOrgId) {
        query = query.eq("org_id", q.expectedOrgId);
      }
      if (q.expectedTargetFingerprint) {
        query = query.eq(
          "target_fingerprint",
          q.expectedTargetFingerprint.toLowerCase()
        );
      }

      const { data, error } = await query.maybeSingle();
      return {
        data: (data as WalletChallengeRecord | null) ?? null,
        error,
      };
    },
    async consumeActive(q) {
      let query = supabase
        .from("auth_challenges")
        .update({ consumed_at: q.consumedAtIso })
        .eq("nonce", q.nonce)
        .eq("purpose", q.purpose)
        .eq("wallet_pubkey", q.walletPubkey)
        .is("consumed_at", null)
        .gt("expires_at", q.consumedAtIso);

      if (q.expectedOrgId) {
        query = query.eq("org_id", q.expectedOrgId);
      }
      if (q.expectedTargetFingerprint) {
        query = query.eq(
          "target_fingerprint",
          q.expectedTargetFingerprint.toLowerCase()
        );
      }

      const { data, error } = await query.select("nonce").maybeSingle();
      return { consumed: Boolean(data), error };
    },
  };

  return verifyAndConsumeChallengeWithStore(store, params);
}
