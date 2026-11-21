import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { generateKeyRequestSchema } from "@/lib/validation";
import {
  buildViewingKeyScopeAad,
  deriveOrgAuditKey,
  encryptViewingKey,
  hashAuditorIdentity,
  generateAuditorSalt,
} from "@/lib/crypto";

/**
 * POST /api/audit/generate-key
 *
 * Generates a time- and token-scoped auditor viewing key by wrapping the
 * organization's HKDF-derived audit key (`orgAuditKey`) with AES-256-GCM
 * authenticated against canonical scope AAD (`org_id | valid_from | valid_until | allowed_tokens`).
 *
 * Cryptographic flow:
 * 1. org_audit_key = HKDF-SHA256(AEGIS_MASTER_SECRET, salt=org_id, info="aegis-org-audit-vk-v1")
 * 2. key_id = crypto.randomUUID() (unique HKDF wrapping salt)
 * 3. scope_aad = "aegis:vk-scope:v1|org_id|valid_from|valid_until|sorted(allowed_tokens)"
 * 4. ciphertext = AES-256-GCM(plaintext=org_audit_key, key=HKDF(master, key_id), aad=scope_aad)
 * 5. identity_salt = crypto.randomBytes(32); identity_hash = SHA-256(salt || auditor_identity)
 * 6. Store only ciphertext + scope metadata in Supabase. Raw key material is NEVER returned.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = generateKeyRequestSchema.safeParse(body);
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

  const { org_id, auditor_identity, valid_from, valid_until, allowed_tokens } =
    parsed.data;

  const supabase = createServiceClient();
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", org_id)
    .single();

  if (orgError || !org) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404 }
    );
  }

  try {
    // Derive the organization's real 32-byte audit decryption key
    const orgAuditKey = deriveOrgAuditKey(org_id);

    // Unique key_id acts as HKDF salt for this scoped wrapping
    const keyId = randomUUID();

    // Bind temporal & token scope cryptographically via GCM AAD
    const scopeAad = buildViewingKeyScopeAad({
      orgId: org_id,
      validFrom: valid_from,
      validUntil: valid_until,
      allowedTokens: allowed_tokens,
    });

    // Wrap orgAuditKey with AES-256-GCM + scope AAD
    const encryptedBlob = encryptViewingKey(orgAuditKey, keyId, scopeAad);

    // One-way hash auditor identity with per-key random salt
    const identitySalt = generateAuditorSalt();
    const identityHash = hashAuditorIdentity(auditor_identity, identitySalt);

    const { data: viewingKey, error: insertError } = await supabase
      .from("viewing_keys")
      .insert({
        org_id,
        key_id: keyId,
        encrypted_viewing_key: encryptedBlob.toString("base64"),
        valid_from,
        valid_until,
        allowed_tokens,
        auditor_identity_hash: identityHash,
        auditor_identity_salt: identitySalt,
        revoked: false,
      })
      .select("id, key_id, valid_from, valid_until, allowed_tokens, created_at")
      .single();

    if (insertError || !viewingKey) {
      console.error("Failed to store viewing key:", insertError);
      return NextResponse.json(
        { error: "Failed to store viewing key" },
        { status: 500 }
      );
    }

    await supabase.from("audit_log").insert({
      event_type: "viewing_key_created",
      org_id,
      metadata: {
        viewing_key_id: viewingKey.id,
        key_id: keyId,
        valid_from,
        valid_until,
        allowed_tokens,
        auditor_identity_hash: identityHash,
      },
    });

    return NextResponse.json(
      {
        viewing_key: {
          id: viewingKey.id,
          key_id: viewingKey.key_id,
          valid_from: viewingKey.valid_from,
          valid_until: viewingKey.valid_until,
          allowed_tokens: viewingKey.allowed_tokens,
          created_at: viewingKey.created_at,
        },
        message:
          "Scoped viewing key created. Issue a single-use magic link via POST /api/audit/magic-link to grant auditor access.",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Generate key error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate viewing key",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
