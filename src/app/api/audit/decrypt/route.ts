import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { createServiceClient } from "@/lib/supabase/server";
import {
  buildManifestAad,
  buildViewingKeyScopeAad,
  decryptBatchManifest,
  decryptViewingKey,
  deriveJwtSigningKey,
} from "@/lib/crypto";
import { decryptRequestSchema } from "@/lib/validation";
import {
  verifyBatchCompleteness,
  verifyMerkleInclusionProof,
  type MerkleInclusionProof,
} from "@/lib/merkle";

/**
 * POST /api/audit/decrypt
 *
 * Cryptographically verifies a time- and token-scoped auditor viewing key,
 * unwraps the organization's HKDF audit key using scope-bound GCM AAD,
 * decrypts each in-scope batch manifest, and verifies FULL Binary Merkle Sum
 * Tree completeness against every batch's anchored `merkle_root`.
 *
 * Authentication: Bearer JWT from GET /api/audit/verify
 *
 * Guarantees:
 * - Altering DB temporal bounds or allowed_tokens fails GCM AAD authentication.
 * - Omitting or modifying even one recipient in a batch manifest fails Merkle
 *   Sum Tree completeness verification (root, leaf count, and total sum).
 * - Only runs within [valid_from, valid_until] AND matching allowed_tokens are
 *   decrypted and returned.
 */

interface AuditJwtPayload {
  sub: string;
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

interface StoredBatchManifest {
  version: number;
  payrollRunId: string;
  orgId: string;
  tokenSymbol: string;
  merkleRoot: string;
  totalAmountBaseUnits: string;
  leafCount: number;
  entries: Array<{
    index: number;
    recipient: string;
    amountBaseUnits: string;
    tokenSymbol: "USDC" | "USDT" | "SOL";
    tokenMint: string;
    settlementRail: "onchain_shielded" | "ngn_bank" | "kes_mpesa";
    saltHex: string;
    runNonce: string;
    commitmentHash: string;
    merkleProof: MerkleInclusionProof;
  }>;
}

const TOKEN_DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  USDT: 6,
};

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or malformed Authorization header. Expected: Bearer <token>" },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);
  let jwtSecret: Uint8Array;
  try {
    jwtSecret = deriveJwtSigningKey();
  } catch {
    return NextResponse.json(
      { error: "Server configuration error: AEGIS_MASTER_SECRET not properly configured" },
      { status: 500 }
    );
  }

  let payload: AuditJwtPayload;
  try {
    const { payload: verified } = await jwtVerify(token, jwtSecret, {
      issuer: "aegis-ledger",
    });
    payload = verified as unknown as AuditJwtPayload;
  } catch (jwtErr) {
    const message = jwtErr instanceof Error ? jwtErr.message : "JWT verification failed";
    return NextResponse.json(
      { error: "Invalid or expired audit token", detail: message },
      { status: 401 }
    );
  }

  let limit = 250;
  try {
    const body = await request.json();
    const parsed = decryptRequestSchema.safeParse(body);
    if (parsed.success) {
      limit = parsed.data.limit;
    }
  } catch {
    // Empty body is valid — default limit applies
  }

  const supabase = createServiceClient();
  const { data: vk, error: vkError } = await supabase
    .from("viewing_keys")
    .select(
      "id, org_id, key_id, encrypted_viewing_key, valid_from, valid_until, allowed_tokens, revoked"
    )
    .eq("id", payload.vk_id)
    .single();

  if (vkError || !vk) {
    return NextResponse.json(
      { error: "Viewing key not found" },
      { status: 404 }
    );
  }

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

  if (vk.key_id !== payload.key_id || vk.org_id !== payload.org_id) {
    return NextResponse.json(
      { error: "Token scope mismatch" },
      { status: 403 }
    );
  }

  try {
    // Unwrap the organization's real audit decryption key using scope-bound AAD.
    // If any DB scope field (org_id, valid_from, valid_until, allowed_tokens) was
    // modified after key issuance, AES-256-GCM authentication fails here.
    const encryptedBlob = Buffer.from(vk.encrypted_viewing_key, "base64");
    const scopeAad = buildViewingKeyScopeAad({
      orgId: vk.org_id,
      validFrom: vk.valid_from,
      validUntil: vk.valid_until,
      allowedTokens: vk.allowed_tokens,
    });
    const orgAuditKey = decryptViewingKey(encryptedBlob, vk.key_id, scopeAad);

    // Query ONLY completed runs strictly within the authorized temporal & token scope
    const { data: runs, error: runsError } = await supabase
      .from("payroll_runs")
      .select(
        "id, total_amount_lamports, recipient_count, token_symbol, token_mint, tx_signatures, merkle_root, encrypted_manifest, created_at, completed_at"
      )
      .eq("org_id", vk.org_id)
      .eq("status", "completed")
      .in("token_symbol", vk.allowed_tokens)
      .gte("created_at", vk.valid_from)
      .lte("created_at", vk.valid_until)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (runsError) {
      throw new Error(`Failed to query payroll runs: ${runsError.message}`);
    }

    const verifiedBatches: Array<{
      payroll_run_id: string;
      token_symbol: string;
      merkle_root: string;
      completeness_verified: boolean;
      verification_errors: string[];
      leaf_count: number;
      total_amount_base_units: string;
      tx_signatures: string[];
      settled_at: string;
      entries: Array<{
        index: number;
        recipient: string;
        amount_base_units: string;
        token_symbol: string;
        settlement_rail: string;
        commitment_hash: string;
        inclusion_proof_verified: boolean;
        merkle_proof: MerkleInclusionProof;
      }>;
    }> = [];

    const decryptedTransactions: Array<{
      txType: "withdrawal";
      amount: number;
      fee: number;
      netAmount: number;
      runningBalance: number;
      timestamp: number;
      recipient: string;
      symbol: string;
      decimals: number;
      commitment: string;
      merkleRoot: string;
      completenessVerified: boolean;
      settlementRail: string;
      signature?: string;
    }> = [];

    let cumulativeOutflow = 0;

    for (const run of runs || []) {
      const settledAtIso = run.completed_at || run.created_at;
      const settledMs = new Date(settledAtIso).getTime();

      if (!run.encrypted_manifest || !run.merkle_root) {
        // Legacy or unsealed run without encrypted manifest — surface honestly as unverified
        verifiedBatches.push({
          payroll_run_id: run.id,
          token_symbol: run.token_symbol,
          merkle_root: run.merkle_root || "",
          completeness_verified: false,
          verification_errors: [
            "Missing encrypted audit manifest or Merkle Sum Tree root; batch completeness cannot be proven.",
          ],
          leaf_count: run.recipient_count,
          total_amount_base_units: String(run.total_amount_lamports),
          tx_signatures: run.tx_signatures || [],
          settled_at: settledAtIso,
          entries: [],
        });
        continue;
      }

      // Decrypt batch manifest using the unwrapped orgAuditKey + manifest AAD
      const manifestAad = buildManifestAad({
        orgId: vk.org_id,
        payrollRunId: run.id,
        merkleRoot: run.merkle_root,
        tokenSymbol: run.token_symbol,
      });

      const plaintextJson = decryptBatchManifest(
        run.encrypted_manifest,
        orgAuditKey,
        run.id,
        manifestAad
      );
      const manifest = JSON.parse(plaintextJson) as StoredBatchManifest;

      // Verify full Binary Merkle Sum Tree completeness (root + leaf count + total sum)
      const completeness = verifyBatchCompleteness(
        manifest.entries,
        run.merkle_root,
        BigInt(run.total_amount_lamports),
        run.recipient_count
      );

      const verifiedEntries = manifest.entries.map((entry) => {
        const proofOk =
          verifyMerkleInclusionProof(entry.merkleProof, run.merkle_root!) &&
          entry.merkleProof.leafHash === entry.commitmentHash;

        const amountNum = Number(entry.amountBaseUnits);
        cumulativeOutflow += amountNum;

        decryptedTransactions.push({
          txType: "withdrawal",
          amount: amountNum,
          fee: 0,
          netAmount: -amountNum,
          runningBalance: -cumulativeOutflow,
          timestamp: settledMs,
          recipient: entry.recipient,
          symbol: entry.tokenSymbol,
          decimals: TOKEN_DECIMALS[entry.tokenSymbol] ?? 6,
          commitment: entry.commitmentHash,
          merkleRoot: run.merkle_root!,
          completenessVerified: completeness.valid && proofOk,
          settlementRail: entry.settlementRail,
          signature: run.tx_signatures?.[0],
        });

        return {
          index: entry.index,
          recipient: entry.recipient,
          amount_base_units: entry.amountBaseUnits,
          token_symbol: entry.tokenSymbol,
          settlement_rail: entry.settlementRail,
          commitment_hash: entry.commitmentHash,
          inclusion_proof_verified: proofOk,
          merkle_proof: entry.merkleProof,
        };
      });

      verifiedBatches.push({
        payroll_run_id: run.id,
        token_symbol: run.token_symbol,
        merkle_root: run.merkle_root,
        completeness_verified:
          completeness.valid && verifiedEntries.every((e) => e.inclusion_proof_verified),
        verification_errors: completeness.errors,
        leaf_count: completeness.leafCount,
        total_amount_base_units: completeness.totalSum,
        tx_signatures: run.tx_signatures || [],
        settled_at: settledAtIso,
        entries: verifiedEntries,
      });
    }

    const allBatchesVerified =
      verifiedBatches.length > 0 &&
      verifiedBatches.every((b) => b.completeness_verified);

    return NextResponse.json(
      {
        audit: {
          org_id: vk.org_id,
          viewing_key_id: vk.id,
          scope: {
            valid_from: vk.valid_from,
            valid_until: vk.valid_until,
            allowed_tokens: vk.allowed_tokens,
          },
          integrity: {
            all_batches_verified: allBatchesVerified,
            verified_batch_count: verifiedBatches.filter((b) => b.completeness_verified).length,
            total_batch_count: verifiedBatches.length,
          },
          summary: {
            totalWithdrawals: decryptedTransactions.reduce((s, t) => s + Math.abs(t.netAmount), 0),
            totalFees: 0,
            transactionCount: decryptedTransactions.length,
          },
          batches: verifiedBatches,
          transactions: decryptedTransactions,
          scanned_count: (runs || []).length,
          filtered_count: decryptedTransactions.length,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Aegis Audit] Decrypt/verify error:", error);
    return NextResponse.json(
      {
        error: "Failed to decrypt viewing key or verify audit manifests",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
