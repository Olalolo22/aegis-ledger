import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  attachAdminSessionCookie,
  mintOrgAdminSessionToken,
  verifyAndConsumeWalletChallenge,
  type OrgAdminMembershipRole,
} from "@/lib/auth";
import { authVerifyRequestSchema } from "@/lib/validation";

/**
 * POST /api/auth/verify
 *
 * Verifies a Sign-In With Solana (SIWS) Ed25519 signature over a single-use
 * Postgres challenge nonce, resolves the wallet's organization membership
 * from `org_admins` (auto-provisioning an isolated organization on first login
 * for new founders/judges), and sets an HttpOnly, SameSite=Strict session cookie.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = authVerifyRequestSchema.safeParse(body);
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

  const { wallet_pubkey, nonce, signature } = parsed.data;

  // 1. Atomically consume single-use challenge and verify Ed25519 signature
  const check = await verifyAndConsumeWalletChallenge({
    nonce,
    purpose: "session_login",
    walletPubkey: wallet_pubkey,
    signature,
  });

  if (!check.ok) {
    return NextResponse.json(
      { error: check.error, code: "SIGNATURE_VERIFICATION_FAILED" },
      { status: 401 }
    );
  }

  try {
    const supabase = createServiceClient();

    // 2. Resolve active organization membership from `org_admins`
    let orgId: string;
    let role: OrgAdminMembershipRole;
    let orgName: string;
    let treasuryPubkey: string;

    const { data: membership, error: memErr } = await supabase
      .from("org_admins")
      .select("org_id, role, status")
      .eq("wallet_pubkey", wallet_pubkey)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memErr) {
      throw new Error(memErr.message);
    }

    if (membership) {
      orgId = membership.org_id;
      role = membership.role as OrgAdminMembershipRole;

      const { data: orgRow } = await supabase
        .from("organizations")
        .select("name, treasury_pubkey")
        .eq("id", orgId)
        .single();

      orgName = orgRow?.name || "Aegis Treasury";
      treasuryPubkey = orgRow?.treasury_pubkey || wallet_pubkey;
    } else {
      // Check if wallet is already `treasury_pubkey` of an existing pre-migration org
      const { data: existingOrg } = await supabase
        .from("organizations")
        .select("id, name, treasury_pubkey")
        .eq("treasury_pubkey", wallet_pubkey)
        .limit(1)
        .maybeSingle();

      if (existingOrg) {
        orgId = existingOrg.id;
        orgName = existingOrg.name;
        treasuryPubkey = existingOrg.treasury_pubkey;
        role = "owner";

        await supabase.from("org_admins").upsert(
          {
            org_id: orgId,
            wallet_pubkey,
            role: "owner",
            status: "active",
          },
          { onConflict: "org_id,wallet_pubkey" }
        );
      } else {
        // First-time wallet onboarding: provision an isolated organization owned by this wallet
        const shortAddr = `${wallet_pubkey.slice(0, 4)}...${wallet_pubkey.slice(-4)}`;
        const { data: newOrg, error: createOrgErr } = await supabase
          .from("organizations")
          .insert({
            name: `Aegis Treasury (${shortAddr})`,
            treasury_pubkey: wallet_pubkey,
          })
          .select("id, name, treasury_pubkey")
          .single();

        if (createOrgErr || !newOrg) {
          throw new Error(
            createOrgErr?.message || "Failed to provision organization"
          );
        }

        const { error: createAdminErr } = await supabase
          .from("org_admins")
          .insert({
            org_id: newOrg.id,
            wallet_pubkey,
            role: "owner",
            status: "active",
          });

        if (createAdminErr) {
          throw new Error(createAdminErr.message);
        }

        orgId = newOrg.id;
        orgName = newOrg.name;
        treasuryPubkey = newOrg.treasury_pubkey;
        role = "owner";
      }
    }

    // 3. Mint domain-separated HS256 session JWT & set HttpOnly SameSite=Strict cookie
    const token = await mintOrgAdminSessionToken({
      walletPubkey: wallet_pubkey,
      orgId,
      role,
    });

    await supabase.from("audit_log").insert({
      event_type: "admin_session_authenticated",
      org_id: orgId,
      metadata: {
        wallet_pubkey,
        role,
        auth_method: "siws_ed25519",
      },
    });

    const response = NextResponse.json(
      {
        authenticated: true,
        org_id: orgId,
        org_name: orgName,
        treasury_pubkey: treasuryPubkey,
        wallet_pubkey,
        role,
      },
      { status: 200 }
    );
    attachAdminSessionCookie(response, token);
    return response;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to verify wallet session", detail },
      { status: 503 }
    );
  }
}
