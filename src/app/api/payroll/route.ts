import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { acquireMutex, releaseMutex } from "@/lib/redis";
import {
  MAGICBLOCK_API_URL,
  MAGICBLOCK_CLUSTER,
  ER_RPC,
  TEE_VALIDATOR,
  checkMagicBlockHealth,
  queryMagicBlockSplBalance,
  type MagicBlockBalanceResponse,
} from "@/lib/magicblock";
import { createServiceClient } from "@/lib/supabase/server";
import { ALLOWED_TOKEN_MINTS, payrollRequestSchema } from "@/lib/validation";

/**
 * GET /api/payroll?org_id=<uuid>&valid_from=<iso>&valid_until=<iso>&tokens=USDC,SOL
 *
 * Returns completed payroll run metadata + `orgWrappedDek` / `orgWrappedDeks`
 * (RSA-OAEP-256 ciphertexts — never plaintext) for an organization within a
 * date/token window so any active org admin's browser can unwrap and re-wrap
 * ONLY in-scope batch DEKs to an auditor's public key (or a newly rotated admin).
 */
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");
  const validFrom = request.nextUrl.searchParams.get("valid_from");
  const validUntil = request.nextUrl.searchParams.get("valid_until");
  const tokensParam = request.nextUrl.searchParams.get("tokens");

  if (!orgId || !z.string().uuid().safeParse(orgId).success) {
    return NextResponse.json(
      { error: "Valid org_id query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const supabase = createServiceClient();
    let query = supabase
      .from("payroll_runs")
      .select(
        "id, token_symbol, merkle_root, anchor_tx_signature, anchor_slot, e2ee_envelope, anchor_verified, created_at, completed_at"
      )
      .eq("org_id", orgId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(250);

    if (validFrom) query = query.gte("created_at", validFrom);
    if (validUntil) query = query.lte("created_at", validUntil);
    if (tokensParam) {
      const tokens = tokensParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (tokens.length > 0) {
        query = query.in("token_symbol", tokens);
      }
    }

    const { data: runs, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      org_id: orgId,
      runs: (runs || []).map((r) => ({
        id: r.id,
        token_symbol: r.token_symbol,
        merkle_root: r.merkle_root,
        anchor_tx_signature: r.anchor_tx_signature,
        anchor_slot: r.anchor_slot,
        anchor_verified: Boolean(r.anchor_verified),
        auditor_verifiable: Boolean(
          r.anchor_tx_signature && r.merkle_root && r.e2ee_envelope
        ),
        org_wrapped_dek: r.e2ee_envelope?.orgWrappedDek ?? null,
        org_wrapped_deks: r.e2ee_envelope?.orgWrappedDeks ?? null,
        org_public_key_fingerprint:
          r.e2ee_envelope?.orgPublicKeyFingerprint ?? null,
        created_at: r.created_at,
        completed_at: r.completed_at,
      })),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to query organization payroll envelopes", detail },
      { status: 503 }
    );
  }
}

/**
 * POST /api/payroll
 *
 * BLIND, NON-CUSTODIAL coordinator for MagicBlock Private Ephemeral Rollup
 * (PER / TEE) batch payroll disbursements.
 *
 * Zero-Knowledge Server Invariants:
 * - Accepts ONLY aggregate batch metadata (`recipient_count`,
 *   `total_amount_base_units`, `onchain_total_base_units`). Individual employee
 *   wallets, individual salaries, and destination accounts NEVER touch this route.
 * - Never touches private keys or signs transactions.
 * - Never returns HTTP 200 with fabricated/mock fallback parameters when
 *   upstream MagicBlock PER or database persistence is unavailable.
 * - Acquires a per-organization Redis mutex to prevent concurrent batch races.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = payrollRequestSchema.safeParse(body);
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
    token_symbol,
    token_mint,
    initiated_by,
    recipient_count,
    total_amount_base_units,
    onchain_total_base_units,
  } = parsed.data;

  // Cross-validate token_mint against known devnet/mainnet mints
  const allowedMints = ALLOWED_TOKEN_MINTS[token_symbol];
  if (allowedMints && !allowedMints.includes(token_mint)) {
    return NextResponse.json(
      {
        error: `token_mint mismatch: expected one of [${allowedMints.join(", ")}] for ${token_symbol}`,
      },
      { status: 400 }
    );
  }

  const totalAmount = BigInt(total_amount_base_units);
  const onChainTotal = BigInt(onchain_total_base_units);
  if (onChainTotal > totalAmount) {
    return NextResponse.json(
      {
        error: "onchain_total_base_units cannot exceed total_amount_base_units",
      },
      { status: 400 }
    );
  }

  // Acquire per-org distributed mutex before coordinating batch state
  const mutex = await acquireMutex(`payroll-batch:${org_id}`, 60);
  if (!mutex.acquired) {
    return NextResponse.json(
      {
        error:
          "A payroll operation is already in progress for this organization. Please retry shortly.",
        code: "MUTEX_CONTENTION",
      },
      { status: 409 }
    );
  }

  try {
    // 1. Verify MagicBlock Private SPL API is live and inspect payer delegation state
    let balanceInfo: MagicBlockBalanceResponse;
    try {
      const [health, bal] = await Promise.all([
        checkMagicBlockHealth(),
        queryMagicBlockSplBalance(initiated_by, token_mint, MAGICBLOCK_CLUSTER),
      ]);
      if (health.status !== "ok") {
        throw new Error(
          `MagicBlock API reported unhealthy status: ${health.status}`
        );
      }
      balanceInfo = bal;
    } catch (upstreamErr) {
      const detail =
        upstreamErr instanceof Error
          ? upstreamErr.message
          : String(upstreamErr);
      console.error(
        "[Aegis Payroll] MagicBlock PER upstream unavailable:",
        detail
      );
      return NextResponse.json(
        {
          error:
            "MagicBlock Private SPL service is unavailable. Payroll aborted safely.",
          code: "MAGICBLOCK_UPSTREAM_UNAVAILABLE",
          detail,
        },
        { status: 503 }
      );
    }

    const isDelegated =
      balanceInfo.delegation?.status === "delegated" ||
      balanceInfo.location === "ephemeral";
    const currentEphemeralBalance = isDelegated
      ? BigInt(balanceInfo.balance || "0")
      : 0n;
    const requiresDeposit =
      onChainTotal > 0n && currentEphemeralBalance < onChainTotal;

    // 2. Verify organization & persist pending aggregate run in Supabase (fail loud on DB error)
    let payrollRunId: string;
    try {
      const supabase = createServiceClient();

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("id, treasury_pubkey")
        .eq("id", org_id)
        .single();

      if (orgError || !org) {
        return NextResponse.json(
          {
            error: "Organization not found",
            code: "ORGANIZATION_NOT_FOUND",
          },
          { status: 404 }
        );
      }

      const { data: payrollRun, error: insertError } = await supabase
        .from("payroll_runs")
        .insert({
          org_id,
          status: "pending" as const,
          execution_rail: "magicblock_per",
          token_mint,
          token_symbol,
          total_amount_lamports: Number(totalAmount),
          recipient_count,
          initiated_by,
          tx_signatures: null,
          merkle_root: null,
          encrypted_manifest: null,
          error_message: null,
          completed_at: null,
        })
        .select("id")
        .single();

      if (insertError || !payrollRun?.id) {
        throw new Error(
          insertError?.message || "Failed to insert payroll_runs record"
        );
      }

      payrollRunId = payrollRun.id;

      await supabase.from("audit_log").insert({
        event_type: "payroll_initiated",
        org_id,
        metadata: {
          payroll_run_id: payrollRunId,
          execution_rail: "magicblock_per",
          recipient_count,
          token_symbol,
          blind_server_mode: true,
          delegation_status: balanceInfo.delegation?.status || "unknown",
          requires_deposit: requiresDeposit,
        },
      });
    } catch (dbErr) {
      const detail = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error("[Aegis Payroll] Database persistence failure:", detail);
      return NextResponse.json(
        {
          error:
            "Payroll ledger database is unavailable. Batch was not initiated.",
          code: "DATABASE_UNAVAILABLE",
          detail,
        },
        { status: 503 }
      );
    }

    const mutexExpiresAt = new Date(Date.now() + 60_000).toISOString();

    return NextResponse.json(
      {
        payroll_run_id: payrollRunId,
        status: "pending_signature",
        execution_rail: "magicblock_per",
        blind_server_mode: true,
        magicblock: {
          api_url: MAGICBLOCK_API_URL,
          er_rpc: ER_RPC,
          validator: TEE_VALIDATOR.toBase58(),
          cluster: MAGICBLOCK_CLUSTER,
          ata: balanceInfo.ata,
          location: balanceInfo.location,
          balance: balanceInfo.balance,
          delegation_status: balanceInfo.delegation?.status || "undelegated",
          requires_deposit: requiresDeposit,
          onchain_total_base_units: onChainTotal.toString(),
        },
        signing_params: {
          token_mint,
          token_symbol,
          program_id: TEE_VALIDATOR.toBase58(),
          relay_url: ER_RPC,
          rpc_url:
            process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
        },
        mutex_expires_at: mutexExpiresAt,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Aegis Payroll] Unexpected error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  } finally {
    await releaseMutex(mutex.key, mutex.lockValue);
  }
}
