import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { jwtVerify } from "jose";
import { createServiceClient } from "@/lib/supabase/server";
import {
  buildViewingKeyScopeAad,
  decryptViewingKey,
  deriveJwtSigningKey,
} from "@/lib/crypto";
import { buildEnvelopeAad, getPublicKeyFingerprint } from "@/lib/e2ee";
import { L1_DEVNET_RPC } from "@/lib/magicblock";
import { verifyAnchorTransactionOnChain } from "@/lib/onchainVerify";
import { decryptRequestSchema } from "@/lib/validation";

/**
 * POST /api/audit/decrypt
 *
 * Zero-knowledge audit envelope delivery & independent Solana L1 root anchor verifier.
 *
 * Security invariants:
 * 1. Aegis servers CANNOT decrypt customer payroll manifests. This route returns
 *    client-encrypted `e2ee_envelope` blobs + the auditor's `auditor_wrapped_dek`
 *    so decryption and Binary Merkle Sum Tree completeness checks execute locally
 *    inside the auditor's browser using the auditor's private key.
 * 2. Before returning any batch, this route INDEPENDENTLY pulls each batch's
 *    `anchor_tx_signature` directly from Solana L1 RPC, parses `aegis:merkle:v1:<root>:<count>`,
 *    and verifies `onChainRoot === payroll_runs.merkle_root`, `onChainLeafCount === recipient_count`,
 *    `signer === initiated_by`, and `e2ee_envelope.aad` matches the L1-anchored root.
 *    Even a compromised Postgres database cannot forge an on-chain verified audit batch.
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
      "id, org_id, key_id, encrypted_viewing_key, auditor_public_key, wrapped_batch_keys, valid_from, valid_until, allowed_tokens, revoked"
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
    // Verify GCM scope AAD integrity (fails if DB temporal or token scope was altered)
    const encryptedBlob = Buffer.from(vk.encrypted_viewing_key, "base64");
    const scopeAad = buildViewingKeyScopeAad({
      orgId: vk.org_id,
      validFrom: vk.valid_from,
      validUntil: vk.valid_until,
      allowedTokens: vk.allowed_tokens,
    });
    decryptViewingKey(encryptedBlob, vk.key_id, scopeAad);

    // Fetch completed runs strictly inside authorized temporal & token scope
    const { data: runs, error: runsError } = await supabase
      .from("payroll_runs")
      .select(
        "id, total_amount_lamports, recipient_count, token_symbol, token_mint, tx_signatures, anchor_tx_signature, anchor_slot, merkle_root, e2ee_envelope, settlement_verified, initiated_by, created_at, completed_at"
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

    const l1RpcUrl = process.env.SOLANA_RPC_URL || L1_DEVNET_RPC;
    const l1Connection = new Connection(l1RpcUrl, "confirmed");
    const wrappedKeys = vk.wrapped_batch_keys || {};

    const auditedBatches = await Promise.all(
      (runs || []).map(async (run) => {
        const settledAtIso = run.completed_at || run.created_at;
        const auditorWrappedDek = wrappedKeys[run.id] ?? null;

        if (!run.anchor_tx_signature || !run.merkle_root) {
          return {
            payroll_run_id: run.id,
            token_symbol: run.token_symbol,
            merkle_root: run.merkle_root || "",
            leaf_count: run.recipient_count,
            total_amount_base_units: String(run.total_amount_lamports),
            tx_signatures: run.tx_signatures || [],
            settled_at: settledAtIso,
            settlement_verified: Boolean(run.settlement_verified),
            chain_anchor: {
              verified: false,
              signature: run.anchor_tx_signature || null,
              error: "Missing Solana L1 anchor_tx_signature or merkle_root; cannot verify against chain.",
            },
            e2ee_envelope: run.e2ee_envelope || null,
            auditor_wrapped_dek: auditorWrappedDek,
            aad_matches_chain_root: false,
          };
        }

        // Pull root independently from Solana L1 RPC & compare against DB merkle_root
        const anchorCheck = await verifyAnchorTransactionOnChain(
          l1Connection,
          run.anchor_tx_signature,
          run.initiated_by,
          run.merkle_root,
          run.recipient_count
        );

        const expectedAad = anchorCheck.onChainRoot
          ? buildEnvelopeAad({
              orgId: vk.org_id,
              payrollRunId: run.id,
              merkleRoot: anchorCheck.onChainRoot,
              tokenSymbol: run.token_symbol,
            })
          : null;

        const aadMatchesChainRoot = Boolean(
          anchorCheck.verified &&
            run.e2ee_envelope &&
            expectedAad &&
            run.e2ee_envelope.aad === expectedAad
        );

        return {
          payroll_run_id: run.id,
          token_symbol: run.token_symbol,
          merkle_root: run.merkle_root,
          leaf_count: run.recipient_count,
          total_amount_base_units: String(run.total_amount_lamports),
          tx_signatures: run.tx_signatures || [],
          settled_at: settledAtIso,
          settlement_verified: Boolean(run.settlement_verified),
          chain_anchor: {
            verified: anchorCheck.verified,
            signature: run.anchor_tx_signature,
            slot: anchorCheck.slot ?? run.anchor_slot ?? null,
            block_time: anchorCheck.blockTime ?? null,
            on_chain_root: anchorCheck.onChainRoot ?? null,
            on_chain_leaf_count: anchorCheck.onChainLeafCount ?? null,
            signer_verified: anchorCheck.signerVerified ?? false,
            error: anchorCheck.error ?? null,
          },
          e2ee_envelope: run.e2ee_envelope || null,
          auditor_wrapped_dek: auditorWrappedDek,
          aad_matches_chain_root: aadMatchesChainRoot,
        };
      })
    );

    const verifiedAnchorCount = auditedBatches.filter(
      (b) => b.chain_anchor.verified && b.aad_matches_chain_root
    ).length;

    return NextResponse.json(
      {
        audit: {
          org_id: vk.org_id,
          viewing_key_id: vk.id,
          decryption_mode: "client_side_e2ee",
          auditor_public_key_fingerprint: vk.auditor_public_key
            ? getPublicKeyFingerprint(vk.auditor_public_key)
            : null,
          scope: {
            valid_from: vk.valid_from,
            valid_until: vk.valid_until,
            allowed_tokens: vk.allowed_tokens,
          },
          integrity: {
            all_chain_anchors_verified:
              auditedBatches.length > 0 && verifiedAnchorCount === auditedBatches.length,
            verified_chain_anchor_count: verifiedAnchorCount,
            total_batch_count: auditedBatches.length,
          },
          batches: auditedBatches,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Aegis Audit] Envelope fetch / L1 anchor verification error:", error);
    return NextResponse.json(
      {
        error: "Failed to verify viewing key scope or Solana L1 Merkle anchors",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
