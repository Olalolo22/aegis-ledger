import { NextRequest, NextResponse } from "next/server";
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
 * POST /api/payroll
 *
 * NON-CUSTODIAL coordinator for MagicBlock Private Ephemeral Rollup (PER / TEE)
 * batch payroll disbursements.
 *
 * Invariants:
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
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
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

  const { org_id, token_symbol, token_mint, initiated_by, recipients } = parsed.data;

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
        throw new Error(`MagicBlock API reported unhealthy status: ${health.status}`);
      }
      balanceInfo = bal;
    } catch (upstreamErr) {
      const detail = upstreamErr instanceof Error ? upstreamErr.message : String(upstreamErr);
      console.error("[Aegis Payroll] MagicBlock PER upstream unavailable:", detail);
      return NextResponse.json(
        {
          error: "MagicBlock Private SPL service is unavailable. Payroll aborted safely.",
          code: "MAGICBLOCK_UPSTREAM_UNAVAILABLE",
          detail,
        },
        { status: 503 }
      );
    }

    // 2. Compute aggregate batch totals
    const totalAmount = recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n);
    const onChainTotal = recipients
      .filter((r) => (r.settlementRail || "onchain_shielded") === "onchain_shielded")
      .reduce((sum, r) => sum + BigInt(r.amount), 0n);

    const isDelegated =
      balanceInfo.delegation?.status === "delegated" ||
      balanceInfo.location === "ephemeral";
    const currentEphemeralBalance = isDelegated ? BigInt(balanceInfo.balance || "0") : 0n;
    const requiresDeposit = onChainTotal > 0n && currentEphemeralBalance < onChainTotal;

    // 3. Verify organization & persist pending payroll run in Supabase (fail loud on DB error)
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
          recipient_count: recipients.length,
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
        throw new Error(insertError?.message || "Failed to insert payroll_runs record");
      }

      payrollRunId = payrollRun.id;

      await supabase.from("audit_log").insert({
        event_type: "payroll_initiated",
        org_id,
        metadata: {
          payroll_run_id: payrollRunId,
          execution_rail: "magicblock_per",
          recipient_count: recipients.length,
          token_symbol,
          delegation_status: balanceInfo.delegation?.status || "unknown",
          requires_deposit: requiresDeposit,
        },
      });
    } catch (dbErr) {
      const detail = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error("[Aegis Payroll] Database persistence failure:", detail);
      return NextResponse.json(
        {
          error: "Payroll ledger database is unavailable. Batch was not initiated.",
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
          recipients: recipients.map((r) => ({
            wallet: r.wallet,
            amount: r.amount,
            token: r.token || token_symbol,
            settlementRail: r.settlementRail || "onchain_shielded",
            destinationAccount: r.destinationAccount,
          })),
          token_mint,
          token_symbol,
          program_id: TEE_VALIDATOR.toBase58(),
          relay_url: ER_RPC,
          rpc_url: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
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
