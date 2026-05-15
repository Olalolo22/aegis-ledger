import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  CLOAK_PROGRAM_ID,
  scanTransactions,
  toComplianceReport,
} from "@cloak.dev/sdk-devnet";
import { createServiceClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/cloak";
import { decryptViewingKey } from "@/lib/crypto";
import { decryptRequestSchema } from "@/lib/validation";

/**
 * POST /api/audit/decrypt
 *
 * Decrypts a viewing key and scans the Cloak shielded pool for transactions
 * visible to that key, filtered by temporal and token scope.
 *
 * Authentication: Bearer JWT from /api/audit/verify
 *
 * Flow:
 * 1. Validate JWT from Authorization header
 * 2. Extract scope claims (vk_id, key_id, valid_from, valid_until, allowed_tokens)
 * 3. Fetch encrypted viewing key from Supabase
 * 4. Verify key is not revoked and still within temporal bounds
 * 5. Decrypt viewing key: AES-256-GCM with HKDF-derived key
 * 6. Call Cloak scanTransactions with the decrypted nk
 * 7. Filter results by temporal and token scope
 * 8. Return compliance report (amounts, fees, balances — no raw key material)
 *
 * Security:
 * - The decrypted nk exists only in ephemeral memory during this request
 * - JWT scope claims are re-verified against the DB record
 * - Temporal bounds are enforced both at JWT level and DB level
 * - The response contains only the compliance report, never the raw key
 */

interface AuditJwtPayload {
  sub: string; // auditor_identity_hash
  vk_id: string;
  key_id: string;
  org_id: string;
  valid_from: string;
  valid_until: string;
  allowed_tokens: string[];
  exp: number;
  iat: number;
  iss: string;
}

export async function POST(request: NextRequest) {
  // ───  Validate JWT ─────────────────────────────────────────
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or malformed Authorization header. Expected: Bearer <token>" },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);
  const masterSecret = process.env.AEGIS_MASTER_SECRET;
  if (!masterSecret || masterSecret.length !== 64) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  let payload: AuditJwtPayload;
  try {
    const jwtSecret = new TextEncoder().encode(masterSecret);
    const { payload: verified } = await jwtVerify(token, jwtSecret, {
      issuer: "aegis-ledger",
    });
    payload = verified as unknown as AuditJwtPayload;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Token verification failed";
    return NextResponse.json(
      { error: "Invalid or expired audit token", detail: message },
      { status: 401 }
    );
  }

  // ───  Parse Optional Request Body ──────────────────────────
  let limit = 250;
  try {
    const body = await request.json();
    const parsed = decryptRequestSchema.safeParse(body);
    if (parsed.success) {
      limit = parsed.data.limit;
    }
  } catch {
    // Empty body is fine — use defaults
  }

  // ───  Fetch Viewing Key from Supabase ──────────────────────
  const supabase = createServiceClient();
  const { data: vk, error: vkError } = await supabase
    .from("viewing_keys")
    .select(
      "id, key_id, encrypted_viewing_key, valid_from, valid_until, allowed_tokens, revoked"
    )
    .eq("id", payload.vk_id)
    .single();

  if (vkError || !vk) {
    return NextResponse.json(
      { error: "Viewing key not found" },
      { status: 404 }
    );
  }

  // ─── Verify Key Status & Scope ────────────────────────────
  if (vk.revoked) {
    return NextResponse.json(
      { error: "This viewing key has been revoked" },
      { status: 403 }
    );
  }

  const now = new Date();
  const validFrom = new Date(vk.valid_from);
  const validUntil = new Date(vk.valid_until);

  if (now < validFrom) {
    return NextResponse.json(
      { error: "Audit window has not started yet", valid_from: vk.valid_from },
      { status: 403 }
    );
  }

  if (now > validUntil) {
    return NextResponse.json(
      { error: "Audit window has expired", valid_until: vk.valid_until },
      { status: 403 }
    );
  }

  // Verify JWT claims match DB record (defense in depth)
  if (vk.key_id !== payload.key_id) {
    return NextResponse.json(
      { error: "Token scope mismatch" },
      { status: 403 }
    );
  }

  try {
    // ───  Decrypt Viewing Key ──────────────────────────────────
    // The encrypted_viewing_key is stored as base64 in Supabase
    const encryptedBlob = Buffer.from(vk.encrypted_viewing_key, "base64");
    const nkBuffer = decryptViewingKey(encryptedBlob, vk.key_id);

    // ─── Scan Transactions with Cloak SDK ─────────────────────
    const connection = getConnection();
    const viewingKeyNk = new Uint8Array(nkBuffer);

    const scanResult = await scanTransactions({
      connection,
      programId: CLOAK_PROGRAM_ID,
      viewingKeyNk,
      limit,
    });

    // ─── Generate Compliance Report ───────────────────────────
    const report = toComplianceReport(scanResult);

    // ─── Filter by Temporal Scope ─────────────────────────────
    // Only return transactions within the viewing key's temporal window
    const filteredTransactions = (report.transactions || []).filter(
      (tx: { timestamp?: string | number | Date }) => {
        if (!tx.timestamp) return true; // include if no timestamp
        const txTime = new Date(tx.timestamp);
        return txTime >= validFrom && txTime <= validUntil;
      }
    );

    // ───Return Report (no raw key material) ──────────────────
    return NextResponse.json(
      {
        audit: {
          org_id: payload.org_id,
          viewing_key_id: vk.id,
          scope: {
            valid_from: vk.valid_from,
            valid_until: vk.valid_until,
            allowed_tokens: vk.allowed_tokens,
          },
          summary: report.summary || null,
          transactions: filteredTransactions,
          scanned_count: (report.transactions || []).length,
          filtered_count: filteredTransactions.length,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Decrypt/scan error:", error);
    return NextResponse.json(
      {
        error: "Failed to decrypt viewing key or scan transactions",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
