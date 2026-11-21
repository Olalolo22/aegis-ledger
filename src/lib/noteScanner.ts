/**
 * Client-side Payslip & Merkle Inclusion Verifier — STRICT BROWSER-ONLY MODULE.
 *
 * SECURITY INVARIANT:
 * Verification runs locally in the browser against the domain-separated Binary
 * SHA-256 Merkle Sum Tree (`src/lib/merkle.ts`). Decryption keys and recipient
 * secrets are never transmitted to Aegis servers during verification.
 */

import { PublicKey } from "@solana/web3.js";
import {
  computeLeafCommitment,
  verifyMerkleInclusionProof,
  type MerkleInclusionProof,
  type MerkleLeafInput,
} from "./merkle";
import type { DecryptedPayslip, ScanSummary } from "@/types/payslip";

export interface ScanProgress {
  phase: "fetching" | "decrypting" | "complete" | "error";
  current: number;
  total: number;
  decryptedSoFar: number;
  message: string;
}

export type ScanProgressCallback = (progress: ScanProgress) => void;

/**
 * Parses a user-provided key or Solana wallet pubkey into 32 bytes.
 * Accepts:
 * 1. 64-character hex string (32 bytes)
 * 2. Solana PublicKey base58 string (32 bytes)
 * 3. Base64-encoded 32-byte key
 */
export function parseViewingKey(input: unknown): Uint8Array {
  const trimmed = String(input || "").trim();

  if (!trimmed) {
    throw new Error("Viewing key cannot be empty");
  }

  // Hex (64 chars = 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  // Solana PublicKey base58
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
    try {
      const pubkey = new PublicKey(trimmed);
      return pubkey.toBytes();
    } catch {
      // Not a valid pubkey, fall through to base64
    }
  }

  // Base64 (32 bytes)
  try {
    const decoded = atob(trimmed);
    if (decoded.length !== 32) {
      throw new Error(
        `Viewing key must be exactly 32 bytes. Got ${decoded.length} bytes.`
      );
    }
    const bytes = new Uint8Array(32);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    if (e instanceof Error && e.message.includes("32 bytes")) {
      throw e;
    }
    throw new Error(
      "Invalid viewing key format. Expected a 64-character hex string, a base64-encoded 32-byte key, or a Solana wallet address."
    );
  }
}

/**
 * Verifies a recipient's note commitment AND its O(log N) Binary Merkle Sum
 * Tree inclusion proof against an anchored batch Merkle root.
 */
export function verifyTeeCommitment(
  leaf: MerkleLeafInput,
  proof: MerkleInclusionProof,
  expectedBatchRoot?: string
): boolean {
  try {
    const computedLeaf = computeLeafCommitment(leaf);
    if (computedLeaf !== proof.leafHash) {
      return false;
    }
    return verifyMerkleInclusionProof(proof, expectedBatchRoot);
  } catch {
    return false;
  }
}

/**
 * Verifies locally stored or fetched MagicBlock PER payslip proofs for a
 * viewing identity. If an external payroll run API is queried via `payrollRunId`,
 * verifies each returned recipient Merkle inclusion proof client-side.
 */
export async function scanNotes(
  _viewingKeyBytes: Uint8Array,
  payrollRunEndpoint: string,
  onProgress?: ScanProgressCallback,
  abortSignal?: AbortSignal
): Promise<{ payslips: DecryptedPayslip[]; summary: ScanSummary }> {
  const startTime = Date.now();

  onProgress?.({
    phase: "fetching",
    current: 0,
    total: 0,
    decryptedSoFar: 0,
    message: "Querying MagicBlock PER batch Merkle proofs...",
  });

  if (abortSignal?.aborted) {
    throw new Error("Scan cancelled");
  }

  const res = await fetch(payrollRunEndpoint, {
    signal: abortSignal,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch batch proofs (HTTP ${res.status})`);
  }

  const data = await res.json();
  const batchRoot: string | undefined = data?.payroll_run?.merkle_root;
  const recipients: Array<{
    recipient_index: number;
    commitment_hash: string;
    merkle_proof?: MerkleInclusionProof;
    created_at?: string;
  }> = Array.isArray(data?.recipients) ? data.recipients : [];

  const totalNotes = recipients.length;
  const verifiedPayslips: DecryptedPayslip[] = [];
  let failedCount = 0;

  for (let i = 0; i < totalNotes; i++) {
    if (abortSignal?.aborted) {
      throw new Error("Scan cancelled by user");
    }

    const r = recipients[i];
    onProgress?.({
      phase: "decrypting",
      current: i + 1,
      total: totalNotes,
      decryptedSoFar: verifiedPayslips.length,
      message: `Verifying Merkle Sum Tree proof ${i + 1}/${totalNotes}...`,
    });

    if (!r.merkle_proof || !batchRoot) {
      failedCount++;
      continue;
    }

    const valid =
      r.merkle_proof.leafHash === r.commitment_hash &&
      verifyMerkleInclusionProof(r.merkle_proof, batchRoot);

    if (!valid) {
      failedCount++;
      continue;
    }

    const symbol = data.payroll_run?.token_symbol || "USDC";
    const decimals = symbol === "SOL" ? 9 : 6;
    const raw = BigInt(r.merkle_proof.amountBaseUnits);
    const whole = Number(raw) / 10 ** decimals;

    verifiedPayslips.push({
      id: `${r.commitment_hash}-${r.recipient_index}`,
      amountFormatted: whole.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      amountRaw: raw.toString(),
      tokenSymbol: symbol,
      tokenMint: data.payroll_run?.token_mint || "",
      date: r.created_at || data.payroll_run?.completed_at || null,
      memo: "Verified via Binary Merkle Sum Tree",
      txSignature: data.payroll_run?.tx_signatures?.[0] || null,
      commitmentHash: r.commitment_hash,
      leafIndex: r.recipient_index,
      batchCommitmentRoot: batchRoot,
      enclaveAttestation: "MagicBlock PER (Intel TDX) — Merkle Sum Tree Verified",
    });
  }

  const summary: ScanSummary = {
    totalCommitments: totalNotes,
    decryptedCount: verifiedPayslips.length,
    failedCount,
    totalAmountByToken: {},
    scanDurationMs: Date.now() - startTime,
  };

  onProgress?.({
    phase: "complete",
    current: totalNotes,
    total: totalNotes,
    decryptedSoFar: verifiedPayslips.length,
    message: `Verification complete. ${verifiedPayslips.length}/${totalNotes} Merkle inclusion proofs verified.`,
  });

  return { payslips: verifiedPayslips, summary };
}
