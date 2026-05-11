import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  generateUtxoKeypair,
  getNkFromUtxoPrivateKey,
} from "@cloak.dev/sdk-devnet";
import { createServiceClient } from "@/lib/supabase/server";
import { generateKeyRequestSchema } from "@/lib/validation";
import {
  encryptViewingKey,
  hashAuditorIdentity,
  generateAuditorSalt,
} from "@/lib/crypto";

/**
 * POST /api/audit/generate-key
 *
 * Generates a time-scoped viewing key for an auditor, encrypts it with
 * AES-256-GCM using HKDF-derived key, and stores the ciphertext in Supabase.
 *
 * Cryptographic flow:
 * 1. Cloak SDK: generateUtxoKeypair() → private key → getNkFromUtxoPrivateKey() → nk (32-byte viewing key)
 * 2. key_id = crypto.randomUUID() (unique HKDF derivation context)
 * 3. derived_key = HKDF-SHA256(AEGIS_MASTER_SECRET, salt=key_id, info="aegis-viewing-key")
 * 4. ciphertext = AES-256-GCM(nk, derived_key) → iv(12) || authTag(16) || encrypted(N)
 * 5. identity_salt = crypto.randomBytes(32) (per-auditor unique salt)
 * 6. identity_hash = SHA-256(identity_salt || auditor_identity)
 * 7. Store: key_id, ciphertext, valid_from, valid_until, allowed_tokens, identity_hash, identity_salt
 *
 * Security invariants:
 * - The raw viewing key (nk) exists ONLY in ephemeral memory; never persisted.
 * - AEGIS_MASTER_SECRET never leaves env vars.
 * - Auditor identity is one-way hashed with a per-key unique salt.
 * - Temporal and token scope are enforced at the DB level via CHECK constraints.
 */
export async function POST(request: NextRequest) {
  // ─── 1. Parse & Validate ─────────────────────────────────────
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

  // ─── 2. Verify Organization Exists ───────────────────────────
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
    // ─── 3. Generate Cloak Viewing Key ───────────────────────────
    // The Cloak SDK derives viewing material from a UTXO keypair.
    // nk (nullifier key) is the 32-byte viewing key used for scanTransactions.
    const utxoKeypair = await generateUtxoKeypair();
    const nk: Uint8Array = getNkFromUtxoPrivateKey(utxoKeypair.privateKey);

    // ─── 4. Generate unique key_id (HKDF salt) ──────────────────
    const keyId = randomUUID();

    // ─── 5. Encrypt viewing key with AES-256-GCM ────────────────
    // deriveKey(keyId) → HKDF(AEGIS_MASTER_SECRET, salt=keyId)
    // encryptViewingKey(nk, keyId) → iv(12) || authTag(16) || ciphertext
    const nkBuffer = Buffer.from(nk);
    const encryptedBlob = encryptViewingKey(nkBuffer, keyId);

    // ─── 6. Hash auditor identity with per-key salt ─────────────
    const identitySalt = generateAuditorSalt(); // 32 bytes hex
    const identityHash = hashAuditorIdentity(auditor_identity, identitySalt);

    // ─── 7. Store in viewing_keys table ─────────────────────────
    const { data: viewingKey, error: insertError } = await supabase
      .from("viewing_keys")
      .insert({
        org_id,
        key_id: keyId,
        // Supabase accepts base64 for bytea columns
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

    // ─── 8. Audit Log ──────────────────────────────────────────
    await supabase.from("audit_log").insert({
      event_type: "viewing_key_created",
      org_id,
      metadata: {
        viewing_key_id: viewingKey.id,
        key_id: keyId,
        valid_from,
        valid_until,
        allowed_tokens,
        // Note: no auditor_identity in the log — only the hash reference
        auditor_identity_hash: identityHash,
      },
    });

    // ─── 9. Return (no raw key material in response EXCEPT for demo org) ───────────
    const isDemoOrg = org_id === "b91a045c-27eb-44c1-8409-f62506b328a6";
    
    return NextResponse.json(
      {
        viewing_key: {
          id: viewingKey.id,
          key_id: viewingKey.key_id,
          valid_from: viewingKey.valid_from,
          valid_until: viewingKey.valid_until,
          allowed_tokens: viewingKey.allowed_tokens,
          created_at: viewingKey.created_at,
          // Always return for demo org to support the copy-paste narrative
          raw_nk_hex: isDemoOrg ? Buffer.from(nk).toString("hex") : null,
        },
        message: "Viewing key generated.",
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
