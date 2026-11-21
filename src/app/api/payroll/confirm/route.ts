import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { createServiceClient } from "@/lib/supabase/server";
import { payrollConfirmSchema } from "@/lib/validation";
import { verifyMerkleInclusionProof } from "@/lib/merkle";
import { buildEnvelopeAad } from "@/lib/e2ee";
import { L1_DEVNET_RPC, getErConnection } from "@/lib/magicblock";
import {
  verifyAnchorTransactionOnChain,
  verifyMagicBlockTransferOnChain,
} from "@/lib/onchainVerify";

/**
 * POST /api/payroll/confirm
 *
 * Zero-knowledge settlement verification & sealing endpoint.
 *
 * Before marking a batch `completed`, this endpoint proves SETTLEMENT (not just intent):
 * 1. Pulls `anchor_tx_signature` directly from Solana L1 RPC and verifies:
 *      - tx succeeded (`meta.err === null`)
 *      - signer matches `payroll_runs.initiated_by`
 *      - L1 Memo parses to `aegis:merkle:v1:<merkle_root>:<recipient_count>`
 * 2. Verifies EVERY leaf's O(log N) Binary Merkle Sum Tree inclusion proof
 *    against the L1-anchored root, and verifies total sum === `total_amount_lamports`.
 * 3. Fetches EVERY on-chain MagicBlock Private SPL transfer signature in
 *    `onchain_settlements` from MagicBlock ER RPC, decodes the `SPLxh1LVZz...`
 *    (discriminant 0x10) wire instruction, and proves that the ACTUAL on-chain
 *    `(sender, recipient, mint, amountBaseUnits)` hashes to the committed Merkle leaf.
 * 4. Verifies `e2ee_envelope.aad` binds the exact org, run, L1-anchored root,
 *    and token symbol. Aegis NEVER sees the plaintext manifest or private key.
 */
export async function POST(request: NextRequest) {
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
    tx_signatures,
    commitment_hashes,
    merkle_root,
    leaf_proofs,
    onchain_settlements,
    e2ee_envelope,
  } = parsed.data;

  const supabase = createServiceClient();

  const { data: payrollRun, error: fetchError } = await supabase
    .from("payroll_runs")
    .select(
      "id, org_id, status, recipient_count, total_amount_lamports, token_symbol, initiated_by"
    )
    .eq("id", payroll_run_id)
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

  if (
    commitment_hashes.length !== payrollRun.recipient_count ||
    leaf_proofs.length !== payrollRun.recipient_count
  ) {
    return NextResponse.json(
      {
        error: `Expected ${payrollRun.recipient_count} commitments and leaf proofs, received ${commitment_hashes.length} / ${leaf_proofs.length}`,
        code: "HASH_COUNT_MISMATCH",
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

  // 2. Verify every leaf's O(log N) Merkle Sum Tree inclusion proof & total conservation
  let summedBaseUnits = 0n;
  for (let i = 0; i < leaf_proofs.length; i++) {
    const proof = leaf_proofs[i];
    if (
      proof.leafIndex !== i ||
      proof.leafHash !== commitment_hashes[i] ||
      proof.leafCount !== payrollRun.recipient_count ||
      proof.totalSum !== String(payrollRun.total_amount_lamports) ||
      !verifyMerkleInclusionProof(proof, anchoredRoot)
    ) {
      return NextResponse.json(
        {
          error: `Leaf ${i} failed Binary Merkle Sum Tree inclusion verification against L1-anchored root`,
          code: "MERKLE_PROOF_INVALID",
        },
        { status: 400 }
      );
    }
    summedBaseUnits += BigInt(proof.amountBaseUnits);
  }

  if (summedBaseUnits !== BigInt(payrollRun.total_amount_lamports)) {
    return NextResponse.json(
      {
        error: `Sum of leaf proofs (${summedBaseUnits.toString()}) does not match initiated total (${payrollRun.total_amount_lamports})`,
        code: "MERKLE_SUM_MISMATCH",
      },
      { status: 400 }
    );
  }

  // 3. Fetch & decode EVERY on-chain MagicBlock Private SPL transfer against its Merkle leaf
  const erConnection = getErConnection();
  const seenLeafIndexes = new Set<number>();

  for (const settlement of onchain_settlements) {
    if (
      settlement.leafIndex < 0 ||
      settlement.leafIndex >= leaf_proofs.length ||
      seenLeafIndexes.has(settlement.leafIndex)
    ) {
      return NextResponse.json(
        {
          error: `Invalid or duplicate on-chain settlement leafIndex: ${settlement.leafIndex}`,
          code: "SETTLEMENT_VERIFICATION_FAILED",
        },
        { status: 400 }
      );
    }
    seenLeafIndexes.add(settlement.leafIndex);

    const proof = leaf_proofs[settlement.leafIndex];
    const transferCheck = await verifyMagicBlockTransferOnChain(erConnection, {
      signature: settlement.signature,
      leafIndex: settlement.leafIndex,
      expectedSender: payrollRun.initiated_by,
      expectedCommitmentHash: commitment_hashes[settlement.leafIndex],
      saltHex: settlement.saltHex,
      runNonce: payroll_run_id,
      merkleProof: proof,
      anchoredMerkleRoot: anchoredRoot,
    });

    if (!transferCheck.verified) {
      return NextResponse.json(
        {
          error: `On-chain MagicBlock transfer verification failed for leaf ${settlement.leafIndex}`,
          code: "SETTLEMENT_VERIFICATION_FAILED",
          detail: transferCheck.error,
          signature: settlement.signature,
        },
        { status: 400 }
      );
    }
  }

  // 4. Verify E2EE envelope AAD binds exact org, run, L1-anchored root, and token symbol
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

  // Ensure anchor_tx_signature is present in tx_signatures list
  const allSignatures = tx_signatures.includes(anchor_tx_signature)
    ? tx_signatures
    : [...tx_signatures, anchor_tx_signature];

  // 5. Seal run as completed — storing ONLY client-encrypted e2ee_envelope (undecryptable by server)
  const { error: updateError } = await supabase
    .from("payroll_runs")
    .update({
      status: "completed" as const,
      tx_signatures: allSignatures,
      anchor_tx_signature,
      anchor_slot: anchorCheck.slot ?? null,
      merkle_root: anchoredRoot,
      e2ee_envelope,
      settlement_verified: true,
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

  const recipientRecords = leaf_proofs.map((proof) => ({
    payroll_run_id,
    recipient_index: proof.leafIndex,
    commitment_hash: proof.leafHash,
    merkle_proof: proof as unknown as Record<string, unknown>,
  }));

  const { error: insertError } = await supabase
    .from("payroll_recipients")
    .insert(recipientRecords);

  if (insertError) {
    console.error("Failed to insert recipient Merkle proof records:", insertError);
  }

  await supabase.from("audit_log").insert({
    event_type: "payroll_completed",
    org_id: payrollRun.org_id,
    metadata: {
      payroll_run_id,
      execution_rail: "magicblock_per",
      recipient_count: payrollRun.recipient_count,
      onchain_transfers_verified: onchain_settlements.length,
      anchor_tx_signature,
      anchor_slot: anchorCheck.slot,
      merkle_root: anchoredRoot,
      e2ee_scheme: e2ee_envelope.scheme,
      org_public_key_fingerprint: e2ee_envelope.orgPublicKeyFingerprint,
      settlement_verified: true,
    },
  });

  return NextResponse.json(
    {
      payroll_run_id,
      status: "completed",
      anchor_tx_signature,
      anchor_slot: anchorCheck.slot,
      tx_signatures: allSignatures,
      merkle_root: anchoredRoot,
      recipient_count: payrollRun.recipient_count,
      onchain_transfers_verified: onchain_settlements.length,
      settlement_verified: true,
    },
    { status: 200 }
  );
}
