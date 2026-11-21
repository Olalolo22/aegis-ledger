import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { payrollConfirmSchema } from "@/lib/validation";
import {
  verifyBatchCompleteness,
  verifyMerkleInclusionProof,
} from "@/lib/merkle";
import {
  buildManifestAad,
  deriveOrgAuditKey,
  encryptBatchManifest,
} from "@/lib/crypto";

/**
 * POST /api/payroll/confirm
 *
 * Non-custodial confirmation endpoint invoked by the client after real
 * MagicBlock PER / Solana signing and broadcast.
 *
 * Security & Completeness Guarantees:
 * 1. Verifies the payroll run exists and is in 'pending' state.
 * 2. Recomputes the full Binary SHA-256 Merkle Sum Tree from the submitted
 *    manifest and verifies:
 *      - recomputed root === merkle_root
 *      - total sum === payroll_runs.total_amount_lamports
 *      - leaf count === payroll_runs.recipient_count
 *      - every individual per-recipient Merkle inclusion proof verifies
 * 3. Encrypts the batch manifest with AES-256-GCM under a per-run subkey
 *    derived from the org's HKDF audit viewing key (with AAD binding
 *    org_id | payroll_run_id | merkle_root | token_symbol).
 * 4. Persists ONLY the encrypted manifest ciphertext, public Merkle root,
 *    public leaf commitment hashes, and per-leaf Merkle inclusion proofs.
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
    tx_signatures,
    commitment_hashes,
    merkle_root,
    manifest,
  } = parsed.data;

  const supabase = createServiceClient();

  const { data: payrollRun, error: fetchError } = await supabase
    .from("payroll_runs")
    .select("id, org_id, status, recipient_count, total_amount_lamports, token_symbol")
    .eq("id", payroll_run_id)
    .single();

  if (fetchError || !payrollRun) {
    return NextResponse.json(
      {
        error: "Payroll run not found",
        code: "PAYROLL_RUN_NOT_FOUND",
      },
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

  // Validate commitment count & manifest entry count match the initiated batch
  if (
    commitment_hashes.length !== payrollRun.recipient_count ||
    manifest.length !== payrollRun.recipient_count
  ) {
    return NextResponse.json(
      {
        error: `Expected ${payrollRun.recipient_count} commitments/manifest entries, received ${commitment_hashes.length} commitments and ${manifest.length} manifest entries`,
        code: "HASH_COUNT_MISMATCH",
      },
      { status: 400 }
    );
  }

  // Verify commitment_hashes array matches manifest entries in exact order
  for (let i = 0; i < manifest.length; i++) {
    if (manifest[i].index !== i || manifest[i].commitmentHash !== commitment_hashes[i]) {
      return NextResponse.json(
        {
          error: `Manifest entry ${i} index or commitmentHash does not match commitment_hashes[${i}]`,
          code: "MERKLE_VERIFICATION_FAILED",
        },
        { status: 400 }
      );
    }
  }

  // Verify full Binary Merkle Sum Tree completeness against initiated total & count
  const completeness = verifyBatchCompleteness(
    manifest,
    merkle_root,
    BigInt(payrollRun.total_amount_lamports),
    payrollRun.recipient_count
  );

  if (!completeness.valid) {
    return NextResponse.json(
      {
        error: "Batch Merkle Sum Tree completeness verification failed",
        code: "MERKLE_VERIFICATION_FAILED",
        details: completeness.errors,
      },
      { status: 400 }
    );
  }

  // Verify every individual O(log N) inclusion proof
  for (let i = 0; i < manifest.length; i++) {
    const proofValid = verifyMerkleInclusionProof(manifest[i].merkleProof, merkle_root);
    if (!proofValid || manifest[i].merkleProof.leafHash !== manifest[i].commitmentHash) {
      return NextResponse.json(
        {
          error: `Merkle inclusion proof verification failed for leaf index ${i}`,
          code: "MERKLE_PROOF_INVALID",
        },
        { status: 400 }
      );
    }
  }

  // Encrypt the verified manifest under the organization's HKDF audit viewing key
  let encryptedManifest: string;
  try {
    const orgAuditKey = deriveOrgAuditKey(payrollRun.org_id);
    const manifestAad = buildManifestAad({
      orgId: payrollRun.org_id,
      payrollRunId: payroll_run_id,
      merkleRoot: merkle_root,
      tokenSymbol: payrollRun.token_symbol,
    });
    const manifestPayload = JSON.stringify({
      version: 1,
      payrollRunId: payroll_run_id,
      orgId: payrollRun.org_id,
      tokenSymbol: payrollRun.token_symbol,
      merkleRoot: merkle_root,
      totalAmountBaseUnits: completeness.totalSum,
      leafCount: completeness.leafCount,
      entries: manifest,
    });
    encryptedManifest = encryptBatchManifest(
      manifestPayload,
      orgAuditKey,
      payroll_run_id,
      manifestAad
    );
  } catch (cryptoErr) {
    console.error("[Aegis Confirm] Failed to encrypt audit manifest:", cryptoErr);
    return NextResponse.json(
      {
        error: "Server cryptography configuration error while encrypting audit manifest",
        code: "MANIFEST_ENCRYPTION_FAILED",
      },
      { status: 500 }
    );
  }

  // Update Payroll Run → completed
  const { error: updateError } = await supabase
    .from("payroll_runs")
    .update({
      status: "completed" as const,
      tx_signatures,
      merkle_root,
      encrypted_manifest: encryptedManifest,
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

  // Insert per-recipient commitment hashes and O(log N) Merkle inclusion proofs
  const recipientRecords = manifest.map((entry) => ({
    payroll_run_id,
    recipient_index: entry.index,
    commitment_hash: entry.commitmentHash,
    merkle_proof: entry.merkleProof as unknown as Record<string, unknown>,
  }));

  const { error: insertError } = await supabase
    .from("payroll_recipients")
    .insert(recipientRecords);

  if (insertError) {
    console.error("Failed to insert recipient Merkle proof records:", insertError);
  }

  // Audit Log (no plaintext recipient data)
  await supabase.from("audit_log").insert({
    event_type: "payroll_completed",
    org_id: payrollRun.org_id,
    metadata: {
      payroll_run_id,
      execution_rail: "magicblock_per",
      recipient_count: payrollRun.recipient_count,
      tx_count: tx_signatures.length,
      merkle_root,
      manifest_encrypted: true,
      signing_method: "client_wallet",
    },
  });

  return NextResponse.json(
    {
      payroll_run_id,
      status: "completed",
      tx_signatures,
      merkle_root,
      recipient_count: payrollRun.recipient_count,
      completeness_verified: true,
    },
    { status: 200 }
  );
}
