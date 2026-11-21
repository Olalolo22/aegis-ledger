import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPublicKeyFingerprint, buildKeyVaultAad } from "@/lib/e2ee";
import {
  requireOrgAdminSession,
  verifyAndConsumeWalletChallenge,
} from "@/lib/auth";
import {
  registerOrgKeyVaultSchema,
  rotateOrgKeyVaultSchema,
} from "@/lib/validation";

/**
 * /api/org/key-vault
 *
 * Authenticated, Per-Mutation Wallet-Signed Key Vault & Rotation Coordinator.
 *
 * Authorization Invariants:
 * 1. `GET`, `POST`, and `PATCH` ALL require a verified `aegis_admin_session`
 *    with live active membership in `org_admins`. `org_id` is derived STRICTLY
 *    from `session.orgId` — NEVER from query string or request body.
 * 2. `POST` (register new admin key) and `PATCH` (revoke/rotate admin key &
 *    rewrite `orgWrappedDeks`) ADDITIONALLY require a fresh Ed25519 signature
 *    from the authenticated, already-registered admin wallet over an atomic
 *    single-use Postgres nonce bound to `(org_id, action, target_fingerprint)`.
 * 3. Initial vault bootstrap on an organization with 0 active vaults requires
 *    `role === "owner"` (the organization's treasury owner wallet).
 */

export async function GET(request: NextRequest) {
  const auth = await requireOrgAdminSession(request);
  if (!auth.ok) return auth.response;

  const orgId = auth.session.orgId;

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
  const auth = await requireOrgAdminSession(request);
  if (!auth.ok) return auth.response;

  const orgId = auth.session.orgId;
  const signerWallet = auth.session.walletPubkey;

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
    admin_label,
    role,
    public_key_spki,
    fingerprint,
    encrypted_vault,
    auth_nonce,
    wallet_signature,
  } = parsed.data;

  // 1. Verify fingerprint cryptographically matches SPKI public key
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

  // 2. Verify per-mutation Ed25519 wallet signature bound to (orgId, vault_register, computedFp)
  const challengeCheck = await verifyAndConsumeWalletChallenge({
    nonce: auth_nonce,
    purpose: "vault_register",
    walletPubkey: signerWallet,
    signature: wallet_signature,
    expectedOrgId: orgId,
    expectedTargetFingerprint: computedFp,
  });

  if (!challengeCheck.ok) {
    return NextResponse.json(
      {
        error: challengeCheck.error,
        code: "VAULT_SIGNATURE_REQUIRED",
      },
      { status: 403 }
    );
  }

  // 3. If encrypted_vault is supplied, verify its metadata & AAD bind strictly to session.orgId
  if (encrypted_vault) {
    const expectedAad = buildKeyVaultAad({
      orgId,
      role,
      fingerprint: computedFp,
    });
    if (
      encrypted_vault.orgId !== orgId ||
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

    // Enforce that bootstrapping the first vault requires an org owner
    const { data: existingVaults, error: existErr } = await supabase
      .from("org_key_vaults")
      .select("id")
      .eq("org_id", orgId)
      .eq("status", "active");

    if (existErr) throw new Error(existErr.message);

    if ((existingVaults || []).length === 0 && auth.session.role !== "owner") {
      return NextResponse.json(
        {
          error:
            "Only an organization owner wallet may bootstrap the initial key vault.",
          code: "OWNER_REQUIRED_FOR_BOOTSTRAP",
        },
        { status: 403 }
      );
    }

    const { data: vault, error: insertError } = await supabase
      .from("org_key_vaults")
      .insert({
        org_id: orgId,
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
      org_id: orgId,
      metadata: {
        vault_id: vault.id,
        admin_label,
        role,
        fingerprint: computedFp,
        authorized_by_wallet: signerWallet,
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
  const auth = await requireOrgAdminSession(request);
  if (!auth.ok) return auth.response;

  const orgId = auth.session.orgId;
  const signerWallet = auth.session.walletPubkey;

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
    revoke_fingerprint,
    new_admin_fingerprint,
    rewrapped_batch_deks,
    auth_nonce,
    wallet_signature,
  } = parsed.data;

  // Require fresh per-mutation Ed25519 signature from already-registered admin wallet
  const challengeCheck = await verifyAndConsumeWalletChallenge({
    nonce: auth_nonce,
    purpose: "vault_rotate",
    walletPubkey: signerWallet,
    signature: wallet_signature,
    expectedOrgId: orgId,
    expectedTargetFingerprint: revoke_fingerprint.toLowerCase(),
  });

  if (!challengeCheck.ok) {
    return NextResponse.json(
      {
        error: challengeCheck.error,
        code: "VAULT_SIGNATURE_REQUIRED",
      },
      { status: 403 }
    );
  }

  try {
    const supabase = createServiceClient();

    // Prevent revoking the last remaining active admin key (protects against statutory history lockout)
    const { data: activeVaults, error: activeErr } = await supabase
      .from("org_key_vaults")
      .select("id, fingerprint")
      .eq("org_id", orgId)
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
      .eq("org_id", orgId)
      .eq("fingerprint", revoke_fingerprint.toLowerCase());

    if (revokeErr) throw new Error(revokeErr.message);

    // Update historical batch envelopes scoped strictly to session.orgId
    let updatedRuns = 0;
    const runIdsToUpdate = Object.keys(rewrapped_batch_deks);
    if (runIdsToUpdate.length > 0 && new_admin_fingerprint) {
      const { data: runs, error: runsErr } = await supabase
        .from("payroll_runs")
        .select("id, e2ee_envelope")
        .eq("org_id", orgId)
        .in("id", runIdsToUpdate);

      if (runsErr) throw new Error(runsErr.message);

      for (const run of runs || []) {
        if (!run.e2ee_envelope) continue;
        const nextWrappedMap: Record<string, string> = {
          ...(run.e2ee_envelope.orgWrappedDeks || {
            [run.e2ee_envelope.orgPublicKeyFingerprint]:
              run.e2ee_envelope.orgWrappedDek,
          }),
        };
        delete nextWrappedMap[revoke_fingerprint.toLowerCase()];
        nextWrappedMap[new_admin_fingerprint.toLowerCase()] =
          rewrapped_batch_deks[run.id];

        const nextPrimaryFp =
          run.e2ee_envelope.orgPublicKeyFingerprint ===
          revoke_fingerprint.toLowerCase()
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
          .eq("id", run.id)
          .eq("org_id", orgId);

        if (!updErr) updatedRuns += 1;
      }
    }

    await supabase.from("audit_log").insert({
      event_type: "org_admin_key_rotated",
      org_id: orgId,
      metadata: {
        revoked_fingerprint: revoke_fingerprint.toLowerCase(),
        new_admin_fingerprint: new_admin_fingerprint?.toLowerCase() ?? null,
        authorized_by_wallet: signerWallet,
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
