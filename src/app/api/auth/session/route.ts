import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireOrgAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/session
 *
 * Returns the active wallet-authenticated organization session if present
 * and still active in `org_admins`, or `{ authenticated: false }`.
 */
export async function GET(request: NextRequest) {
  const auth = await requireOrgAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  const supabase = createServiceClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("name, treasury_pubkey")
    .eq("id", auth.session.orgId)
    .maybeSingle();

  return NextResponse.json(
    {
      authenticated: true,
      org_id: auth.session.orgId,
      org_name: org?.name || "Aegis Treasury",
      treasury_pubkey: org?.treasury_pubkey || auth.session.walletPubkey,
      wallet_pubkey: auth.session.walletPubkey,
      role: auth.session.role,
    },
    { status: 200 }
  );
}
