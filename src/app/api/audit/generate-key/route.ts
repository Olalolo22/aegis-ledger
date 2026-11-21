import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { generateKeyRequestSchema } from "@/lib/validation";
import {
  buildViewingKeyScopeAad,
  encryptViewingKey,
  hashAuditorIdentity,
  generateAuditorSalt,
} from "@/lib/crypto";
import { getPublicKeyFingerprint } from "@/lib/e2ee";

/**
 * POST /api/audit/generate-key
 *
 * Registers an auditor's RSA-OAEP-256 public key and the organization's
 * client-side re-wrapped per-batch DEKs (`wrapped_batch_keys`) strictly for
 * payroll runs inside `[valid_from, valid_until]` and `allowed_tokens`.
 *
 * Zero-Knowledge Key Isolation (Option B):
 * - Aegis servers NEVER receive raw batch DEKs, org private keys, or auditor
 *   private keys — and CANNOT decrypt customer payroll manifests at rest.
 * - Scope isolation is enforced CRYPTOGRAPHICALLY: out-of-scope runs are never
 *   wrapped to `auditor_public_key`.
 * - `encrypted_viewing_key` stores an AES-256-GCM scope-integrity attestation
 *   bound with GCM AAD (`org_id | valid_from | valid_until | allowed_tokens`)
 *   so DB-level tampering with scope bounds is detected on `/api/audit/decrypt`.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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

  const {
    org_id,
    auditor_identity,
    auditor_public_key,
    wrapped_batch_keys,
    valid_from,
    valid_until,
    allowed_tokens,
  } = parsed.data;

  let auditorKeyFingerprint: string;
  try {
    auditorKeyFingerprint = getPublicKeyFingerprint(auditor_public_key);
  } catch {
    return NextResponse.json(
      { error: "auditor_public_key must be valid Base64 SPKI bytes" },
      { status: 400 }
    );
  }

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

  // Validate that every wrapped batch DEK corresponds to a completed in-scope run of this org
  const wrappedRunIds = Object.keys(wrapped_batch_keys);
  if (wrappedRunIds.length > 0) {
    const { data: scopedRuns, error: runsErr } = await supabase
      .from("payroll_runs")
      .select("id, token_symbol, created_at, status")
      .eq("org_id", org_id)
      .in("id", wrappedRunIds);

    if (runsErr) {
      return NextResponse.json(
        { error: "Failed to validate wrapped batch run IDs" },
        { status: 500 }
      );
    }

    const validFromMs = new Date(valid_from).getTime();
    const validUntilMs = new Date(valid_until).getTime();
    const runMap = new Map((scopedRuns || []).map((r) => [r.id, r]));

    for (const runId of wrappedRunIds) {
      const run = runMap.get(runId);
      if (!run || run.status !== "completed") {
        return NextResponse.json(
          { error: `Wrapped batch key references unknown or incomplete run: ${runId}` },
          { status: 400 }
        );
      }
      const createdMs = new Date(run.created_at).getTime();
      if (
        createdMs < validFromMs ||
        createdMs > validUntilMs ||
        !allowed_tokens.includes(run.token_symbol as "USDC" | "USDT" | "SOL")
      ) {
        return NextResponse.json(
          {
            error: `Wrapped batch key for run ${runId} falls outside declared temporal or token scope.`,
            code: "WRAPPED_KEY_OUT_OF_SCOPE",
          },
          { status: 400 }
        );
      }
    }
  }

  try {
    const keyId = randomUUID();

    // Seal scope integrity with GCM AAD (contains only public fingerprint, zero secret DEK material)
    const scopeAad = buildViewingKeyScopeAad({
      orgId: org_id,
      validFrom: valid_from,
      validUntil: valid_until,
      allowedTokens: allowed_tokens,
    });
    const scopeAttestationBytes = Buffer.from(
      `aegis:e2ee-scope-attestation:v2|${org_id}|${auditorKeyFingerprint}`,
      "utf-8"
    );
    const encryptedScopeAttestation = encryptViewingKey(
      scopeAttestationBytes,
      keyId,
      scopeAad
    );

    const identitySalt = generateAuditorSalt();
    const identityHash = hashAuditorIdentity(auditor_identity, identitySalt);

    const { data: viewingKey, error: insertError } = await supabase
      .from("viewing_keys")
      .insert({
        org_id,
        key_id: keyId,
        encrypted_viewing_key: encryptedScopeAttestation.toString("base64"),
        auditor_public_key,
        wrapped_batch_keys,
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
        auditor_public_key_fingerprint: auditorKeyFingerprint,
        wrapped_batch_count: wrappedRunIds.length,
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
          auditor_public_key_fingerprint: auditorKeyFingerprint,
          wrapped_batch_count: wrappedRunIds.length,
          valid_from: viewingKey.valid_from,
          valid_until: viewingKey.valid_until,
          allowed_tokens: viewingKey.allowed_tokens,
          created_at: viewingKey.created_at,
        },
        message:
          "Zero-knowledge scoped audit key registered. Issue a single-use magic link via POST /api/audit/magic-link.",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Generate key error:", error);
    return NextResponse.json(
      {
        error: "Failed to register auditor viewing key",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
