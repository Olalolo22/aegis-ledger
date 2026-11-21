import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { createServiceClient } from "@/lib/supabase/server";
import { requireOrgAdminSession } from "@/lib/auth";
import { payrollConfirmSchema } from "@/lib/validation";
import { buildEnvelopeAad } from "@/lib/e2ee";
import { L1_DEVNET_RPC } from "@/lib/magicblock";
import { verifyAnchorTransactionOnChain } from "@/lib/onchainVerify";

/**
 * POST /api/payroll/confirm
 *
 * Authenticated, Blind, Zero-Knowledge Batch Sealing & Solana L1 Root Anchor Verifier.
 *
 * Security Invariants:
 * - Requires verified `aegis_admin_session` (`requireOrgAdminSession`) and scopes
 *   the pending `payroll_runs` record strictly to `session.orgId`.
 * - `payrollConfirmSchema` is `.strict()` and REJECTS `leaf_proofs`,
 *   `amountBaseUnits`, `saltHex`, `onchain_settlements`, and per-employee
 *   MagicBlock ER transfer signatures.
 * - Returns truthful blind-server flags (`anchor_verified: true`, `aad_verified: true`,
 *   `auditor_verifiable: true`, `server_verified_completeness: false`,
 *   `server_verified_settlement_bytes: false`).
 */
export async function POST(request: NextRequest) {
  const auth = await requireOrgAdminSession(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = payrollConfirmSchema.safeParse(body);
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
    payroll_run_id,
    anchor_tx_signature,
    deposit_tx_signatures,
    commitment_hashes,
    merkle_root,
    e2ee_envelope,
  } = parsed.data;

  const supabase = createServiceClient();

  const { data: payrollRun, error: fetchError } = await supabase
    .from("payroll_runs")
    .select(
      "id, org_id, status, recipient_count, total_amount_lamports, token_symbol, initiated_by"
    )
    .eq("id", payroll_run_id)
    .eq("org_id", auth.session.orgId)
    .single();

  if (fetchError || !payrollRun) {
    return NextResponse.json(
      { error: "Payroll run not found", code: "PAYROLL_RUN_NOT_FOUND" },
      { status: 404 }
    );
  }

  if (payrollRun.status !== "pending") {
    return NextResponse.json(
      {
        error: `Payroll run is in '${payrollRun.status}' state — expected 'pending'`,
        code: "INVALID_STATE",
      },
      { status: 409 }
    );
  }

  if (commitment_hashes.length !== payrollRun.recipient_count) {
    return NextResponse.json(
      {
        error: `Expected ${payrollRun.recipient_count} commitment hashes, received ${commitment_hashes.length}`,
        code: "HASH_COUNT_MISMATCH",
      },
      { status: 400 }
    );
  }

  const normalizedCommitments = commitment_hashes.map((h) => h.toLowerCase());
  if (new Set(normalizedCommitments).size !== normalizedCommitments.length) {
    return NextResponse.json(
      {
        error: "Duplicate leaf commitment hashes detected in batch",
        code: "DUPLICATE_COMMITMENT_HASH",
      },
      { status: 400 }
    );
  }

  // 1. Independently fetch & verify the Solana L1 root anchor transaction
  const l1RpcUrl = process.env.SOLANA_RPC_URL || L1_DEVNET_RPC;
  const l1Connection = new Connection(l1RpcUrl, "confirmed");
  const anchorCheck = await verifyAnchorTransactionOnChain(
    l1Connection,
    anchor_tx_signature,
    payrollRun.initiated_by,
    merkle_root,
    payrollRun.recipient_count
  );

  if (!anchorCheck.verified || !anchorCheck.onChainRoot) {
    return NextResponse.json(
      {
        error: "On-chain Solana L1 Merkle root anchor verification failed",
        code: "ANCHOR_VERIFICATION_FAILED",
        detail: anchorCheck.error,
      },
      { status: 400 }
    );
  }

  const anchoredRoot = anchorCheck.onChainRoot;

  // 2. Verify E2EE envelope AAD binds exact org, run, L1-anchored root, and token symbol
  const expectedAad = buildEnvelopeAad({
    orgId: payrollRun.org_id,
    payrollRunId: payroll_run_id,
    merkleRoot: anchoredRoot,
    tokenSymbol: payrollRun.token_symbol,
  });

  if (e2ee_envelope.aad !== expectedAad) {
    return NextResponse.json(
      {
        error: "E2EE envelope AAD does not match L1-anchored batch metadata",
        code: "E2EE_AAD_MISMATCH",
      },
      { status: 400 }
    );
  }

  // 3. Persist ONLY public aggregate tx signatures (L1 anchor + optional treasury deposits)
  // Per-employee MagicBlock ER transfer signatures stay exclusively inside `e2ee_envelope`.
  const publicBatchSignatures = Array.from(
    new Set([...deposit_tx_signatures, anchor_tx_signature])
  );

  const { error: updateError } = await supabase
    .from("payroll_runs")
    .update({
      status: "completed" as const,
      tx_signatures: publicBatchSignatures,
      anchor_tx_signature,
      anchor_slot: anchorCheck.slot ?? null,
      merkle_root: anchoredRoot,
      e2ee_envelope,
      anchor_verified: true,
      // Blind server CANNOT verify individual settlement bytes or Merkle completeness;
      // only the auditor's browser proves completeness & settled ER bytes against L1.
      settlement_verified: false,
      completed_at: new Date().toISOString(),
    })
    .eq("id", payroll_run_id);

  if (updateError) {
    console.error("Failed to update payroll run:", updateError);
    return NextResponse.json(
      { error: "Failed to update payroll run" },
      { status: 500 }
    );
  }

  // Store ONLY blinded 64-hex leaf commitments — ZERO amounts, salts, or Merkle sibling sums
  const recipientRecords = normalizedCommitments.map((commitmentHash, idx) => ({
    payroll_run_id,
    recipient_index: idx,
    commitment_hash: commitmentHash,
    merkle_proof: null,
  }));

  const { error: insertError } = await supabase
    .from("payroll_recipients")
    .insert(recipientRecords);

  if (insertError) {
    console.error(
      "Failed to insert blinded recipient commitment records:",
      insertError
    );
  }

  const wrappedAdminCount = e2ee_envelope.orgWrappedDeks
    ? Object.keys(e2ee_envelope.orgWrappedDeks).length
    : 1;

  await supabase.from("audit_log").insert({
    event_type: "payroll_completed",
    org_id: payrollRun.org_id,
    metadata: {
      payroll_run_id,
      execution_rail: "magicblock_per",
      blind_server_mode: true,
      recipient_count: payrollRun.recipient_count,
      anchor_tx_signature,
      anchor_slot: anchorCheck.slot,
      merkle_root: anchoredRoot,
      e2ee_scheme: e2ee_envelope.scheme,
      org_public_key_fingerprint: e2ee_envelope.orgPublicKeyFingerprint,
      wrapped_admin_count: wrappedAdminCount,
      anchor_verified: true,
      aad_verified: true,
      auditor_verifiable: true,
      verification_boundary: "anchor_only_blind_server",
    },
  });

  return NextResponse.json(
    {
      payroll_run_id,
      status: "completed",
      blind_server_mode: true,
      anchor_tx_signature,
      anchor_slot: anchorCheck.slot,
      tx_signatures: publicBatchSignatures,
      merkle_root: anchoredRoot,
      recipient_count: payrollRun.recipient_count,
      wrapped_admin_count: wrappedAdminCount,
      anchor_verified: true,
      aad_verified: true,
      auditor_verifiable: true,
      server_verified_completeness: false,
      server_verified_settlement_bytes: false,
      verification_boundary: "anchor_only_blind_server",
    },
    { status: 200 }
  );
}
