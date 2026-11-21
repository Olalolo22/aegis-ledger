import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { getPublicKeyFingerprint, buildKeyVaultAad } from "@/lib/e2ee";
import {
  registerOrgKeyVaultSchema,
  rotateOrgKeyVaultSchema,
} from "@/lib/validation";

/**
 * /api/org/key-vault
 *
 * Passphrase-Encrypted Multi-Admin Key Vault & Rotation Coordinator.
 *
 * Security invariants:
 * - Aegis servers NEVER receive passphrases or plaintext admin private keys.
 * - `encrypted_vault` stores ONLY PBKDF2-SHA256 (600,000 iter) + AES-256-GCM
 *   ciphertext encrypted client-side.
 * - Supports 2+ active organization admins (Primary Finance Admin + Backup
 *   Controller) so every payroll batch DEK is wrapped to multiple custodians,
 *   preventing single-admin key loss or employee-departure lockout.
 * - `PATCH` supports offboarding rotation: revokes a departing admin's key and
 *   persists client-side re-wrapped DEKs for the replacement admin across
 *   historical runs without exposing plaintext manifests to Aegis servers.
 */

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");
  if (!orgId || !z.string().uuid().safeParse(orgId).success) {
    return NextResponse.json(
      { error: "Valid org_id query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const supabase = createServiceClient();
    const { data: vaults, error } = await supabase
      .from("org_key_vaults")
      .select(
        "id, org_id, admin_label, role, public_key_spki, fingerprint, encrypted_vault, status, created_at, rotated_at, revoked_at"
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    const activeVaults = (vaults || []).filter((v) => v.status === "active");

    return NextResponse.json({
      org_id: orgId,
      active_admin_count: activeVaults.length,
      has_backup_admin: activeVaults.length >= 2,
      vaults: vaults || [],
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to load organization key vaults", detail },
      { status: 503 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = registerOrgKeyVaultSchema.safeParse(body);
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
    admin_label,
    role,
    public_key_spki,
    fingerprint,
    encrypted_vault,
  } = parsed.data;

  // Verify fingerprint cryptographically matches SPKI public key
  let computedFp: string;
  try {
    computedFp = getPublicKeyFingerprint(public_key_spki);
  } catch {
    return NextResponse.json(
      { error: "public_key_spki must be valid Base64 SPKI bytes" },
      { status: 400 }
    );
  }

  if (computedFp !== fingerprint.toLowerCase()) {
    return NextResponse.json(
      { error: "fingerprint does not match SHA-256 of public_key_spki" },
      { status: 400 }
    );
  }

  // If encrypted_vault is supplied, verify its metadata & AAD match
  if (encrypted_vault) {
    const expectedAad = buildKeyVaultAad({
      orgId: org_id,
      role,
      fingerprint: computedFp,
    });
    if (
      encrypted_vault.orgId !== org_id ||
      encrypted_vault.role !== role ||
      encrypted_vault.fingerprint !== computedFp ||
      encrypted_vault.publicKeySpkiBase64 !== public_key_spki ||
      encrypted_vault.aad !== expectedAad
    ) {
      return NextResponse.json(
        { error: "encrypted_vault metadata or AAD does not match registered key" },
        { status: 400 }
      );
    }
  }

  try {
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

    const { data: vault, error: insertError } = await supabase
      .from("org_key_vaults")
      .insert({
        org_id,
        admin_label,
        role,
        public_key_spki,
        fingerprint: computedFp,
        encrypted_vault: encrypted_vault ?? null,
        status: "active",
      })
      .select(
        "id, org_id, admin_label, role, public_key_spki, fingerprint, status, created_at"
      )
      .single();

    if (insertError || !vault) {
      throw new Error(insertError?.message || "Failed to persist org key vault");
    }

    await supabase.from("audit_log").insert({
      event_type: "org_admin_key_registered",
      org_id,
      metadata: {
        vault_id: vault.id,
        admin_label,
        role,
        fingerprint: computedFp,
        has_encrypted_vault_backup: Boolean(encrypted_vault),
      },
    });

    return NextResponse.json({ vault }, { status: 201 });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to register organization admin key vault", detail },
      { status: 503 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = rotateOrgKeyVaultSchema.safeParse(body);
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
    revoke_fingerprint,
    new_admin_fingerprint,
    rewrapped_batch_deks,
  } = parsed.data;

  try {
    const supabase = createServiceClient();

    // Prevent revoking the last remaining active admin key (protects against statutory history lockout)
    const { data: activeVaults, error: activeErr } = await supabase
      .from("org_key_vaults")
      .select("id, fingerprint")
      .eq("org_id", org_id)
      .eq("status", "active");

    if (activeErr) throw new Error(activeErr.message);

    const remainingActive = (activeVaults || []).filter(
      (v) => v.fingerprint !== revoke_fingerprint.toLowerCase()
    );
    if (remainingActive.length === 0) {
      return NextResponse.json(
        {
          error:
            "Cannot revoke the last active admin key. Register a replacement or backup controller admin key first.",
          code: "LAST_ADMIN_KEY_PROTECTED",
        },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const { error: revokeErr } = await supabase
      .from("org_key_vaults")
      .update({
        status: new_admin_fingerprint ? "rotated" : "revoked",
        rotated_at: new_admin_fingerprint ? nowIso : null,
        revoked_at: nowIso,
      })
      .eq("org_id", org_id)
      .eq("fingerprint", revoke_fingerprint.toLowerCase());

    if (revokeErr) throw new Error(revokeErr.message);

    // Update historical batch envelopes with client-side re-wrapped DEKs & strip revoked admin's slot
    let updatedRuns = 0;
    const runIdsToUpdate = Object.keys(rewrapped_batch_deks);
    if (runIdsToUpdate.length > 0 && new_admin_fingerprint) {
      const { data: runs, error: runsErr } = await supabase
        .from("payroll_runs")
        .select("id, e2ee_envelope")
        .eq("org_id", org_id)
        .in("id", runIdsToUpdate);

      if (runsErr) throw new Error(runsErr.message);

      for (const run of runs || []) {
        if (!run.e2ee_envelope) continue;
        const nextWrappedMap: Record<string, string> = {
          ...(run.e2ee_envelope.orgWrappedDeks || {
            [run.e2ee_envelope.orgPublicKeyFingerprint]: run.e2ee_envelope.orgWrappedDek,
          }),
        };
        delete nextWrappedMap[revoke_fingerprint.toLowerCase()];
        nextWrappedMap[new_admin_fingerprint.toLowerCase()] =
          rewrapped_batch_deks[run.id];

        const nextPrimaryFp =
          run.e2ee_envelope.orgPublicKeyFingerprint === revoke_fingerprint.toLowerCase()
            ? new_admin_fingerprint.toLowerCase()
            : run.e2ee_envelope.orgPublicKeyFingerprint;
        const nextPrimaryWrapped =
          nextWrappedMap[nextPrimaryFp] || rewrapped_batch_deks[run.id];

        const { error: updErr } = await supabase
          .from("payroll_runs")
          .update({
            e2ee_envelope: {
              ...run.e2ee_envelope,
              orgPublicKeyFingerprint: nextPrimaryFp,
              orgWrappedDek: nextPrimaryWrapped,
              orgWrappedDeks: nextWrappedMap,
            },
          })
          .eq("id", run.id);

        if (!updErr) updatedRuns += 1;
      }
    }

    await supabase.from("audit_log").insert({
      event_type: "org_admin_key_rotated",
      org_id,
      metadata: {
        revoked_fingerprint: revoke_fingerprint.toLowerCase(),
        new_admin_fingerprint: new_admin_fingerprint?.toLowerCase() ?? null,
        rewrapped_batch_count: updatedRuns,
      },
    });

    return NextResponse.json({
      revoked_fingerprint: revoke_fingerprint.toLowerCase(),
      new_admin_fingerprint: new_admin_fingerprint?.toLowerCase() ?? null,
      rewrapped_batch_count: updatedRuns,
      remaining_active_admins: remainingActive.length,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to rotate organization admin key", detail },
      { status: 503 }
    );
  }
}
