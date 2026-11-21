import { NextResponse } from "next/server";
import { clearAdminSessionCookie } from "@/lib/auth";

/**
 * POST /api/auth/logout
 *
 * Clears the HttpOnly `aegis_admin_session` cookie.
 */
export async function POST() {
  const response = NextResponse.json({ authenticated: false }, { status: 200 });
  clearAdminSessionCookie(response);
  return response;
}
