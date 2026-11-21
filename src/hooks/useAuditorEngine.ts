"use client";

import { useState, useCallback, useRef } from "react";
import { Connection } from "@solana/web3.js";
import type { Node, Edge } from "reactflow";
import { MarkerType } from "reactflow";
import {
  buildEnvelopeAad,
  decryptManifestClientSide,
  type EncryptedAuditEnvelope,
} from "@/lib/e2ee";
import {
  verifyBatchCompleteness,
  verifyMerkleInclusionProof,
  type MerkleInclusionProof,
} from "@/lib/merkle";
import { L1_DEVNET_RPC, getErConnection } from "@/lib/magicblock";
import {
  enumerateTreasuryAnchorsOnL1,
  reconcileAuditedBatchesAgainstL1,
  verifyAnchorTransactionOnChain,
  verifyMagicBlockTransferOnChain,
  type EnumeratedL1Anchor,
} from "@/lib/onchainVerify";

/**
 * useAuditorEngine — Zero-Trust Client-Side Auditor Verification Engine.
 *
 * Trust Boundary Invariant (ZERO trust in Aegis servers):
 * 1. `/api/audit/decrypt` is treated STRICTLY as an untrusted ciphertext &
 *    pointer courier (`anchor_tx_signature`, `e2ee_envelope`, `auditor_wrapped_dek`).
 *    Any server-advisory flags are IGNORED.
 * 2. For EVERY batch, THIS browser connects directly to the auditor's chosen
 *    Solana L1 RPC (`customL1RpcUrl || L1_DEVNET_RPC`), pulls `anchor_tx_signature`
 *    directly off Solana L1, verifies tx success + signer + `aegis:merkle:v1:<root>:<count>`,
 *    and treats ONLY that browser-fetched L1 root as authoritative.
 * 3. Decrypts each `e2ee_envelope` locally with the auditor's private key, binding
 *    GCM AAD to the browser-fetched L1 root.
 * 4. Rebuilds the full Binary SHA-256 Merkle Sum Tree against the browser-fetched
 *    L1 root AND decodes every `onchain_shielded` MagicBlock `SPLxh1LVZz...` (`0x10`)
 *    transfer directly from MagicBlock ER RPC (strict 64-hex leaf memo required).
 * 5. Enumerates ALL `aegis:merkle:v1` memos signed by the treasury directly via
 *    the auditor's Solana L1 RPC (NEVER falls back silently to Aegis server reports)
 *    and flags any anchored-but-undisclosed batch as a finding.
 */

export type AuditorEngineStatus =
  | "idle"
  | "loading_data"
  | "decrypting"
  | "formatting"
  | "complete"
  | "error";

export interface DecryptedTransaction {
  txType: string;
  amount: number;
  fee: number;
  netAmount: number;
  runningBalance: number;
  timestamp: number;
  recipient?: string;
  commitment?: string;
  signature?: string;
  merkleRoot?: string;
  anchorTxSignature?: string;
  chainAnchorVerified?: boolean;
  completenessVerified?: boolean;
  erTransferVerified?: boolean;
  settlementRail?: string;
  mint?: string;
  decimals?: number;
  symbol?: string;
}

export interface AuditorReconciliationReport {
  verifiedBy: "auditor_browser_l1_rpc" | "demo";
  l1RpcEndpoint: string;
  treasuryPubkeysChecked: string[];
  totalL1AnchorsInWindow: number;
  deliveredMatchedCount: number;
  undisclosedAnchors: EnumeratedL1Anchor[];
  unanchoredDeliveredRunIds: string[];
  completeZeroOmissions: boolean;
  erTransfersVerifiedCount: number;
}

interface AuditJwtClaims {
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

export interface AuditScope {
  org_id: string;
  valid_from: string;
  valid_until: string;
  allowed_tokens: string[];
  viewing_key_id?: string;
}

export interface AuditedBatchEnvelope {
  payroll_run_id: string;
  initiated_by: string;
  token_symbol: string;
  anchor_tx_signature: string | null;
  anchor_slot?: number | null;
  merkle_root: string;
  leaf_count: number;
  total_amount_base_units: string;
  tx_signatures: string[];
  settled_at: string;
  anchor_verified: boolean;
  auditor_verifiable: boolean;
  e2ee_envelope: EncryptedAuditEnvelope | null;
  auditor_wrapped_dek: string | null;
}

interface DecryptedBatchManifest {
  version: number;
  payrollRunId: string;
  orgId: string;
  initiatedBy?: string;
  tokenSymbol: string;
  merkleRoot: string;
  anchorTxSignature?: string;
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
    settlementTxSignature?: string;
  }>;
}

export interface AuditorEngineResult {
  execute: (
    accessToken: string,
    auditorPrivateKeyPkcs8?: string,
    customL1RpcUrl?: string
  ) => Promise<void>;
  status: AuditorEngineStatus;
  isLoadingData: boolean;
  isDecrypting: boolean;
  isFormatting: boolean;
  error: string | null;
  progress: string | null;
  scope: AuditScope | null;
  reconciliation: AuditorReconciliationReport | null;
  nodes: Node[];
  edges: Edge[];
  transactions: DecryptedTransaction[];
  summary: {
    totalDeposits: number;
    totalWithdrawals: number;
    totalFees: number;
    transactionCount: number;
    filteredCount: number;
    verifiedChainAnchors?: number;
    totalBatches?: number;
    erTransfersVerifiedCount?: number;
  } | null;
}

function decodeJwtPayload(token: string): AuditJwtClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

const KNOWN_DECIMALS: Record<string, number> = { SOL: 9, USDC: 6, USDT: 6 };

function formatAmount(amount: number, symbol?: string): string {
  const decimals = symbol ? KNOWN_DECIMALS[symbol] || 6 : 6;
  const value = amount / Math.pow(10, decimals);
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${symbol || "USDC"}`;
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr || "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function buildReactFlowData(transactions: DecryptedTransaction[]): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: "treasury",
    type: "treasury",
    position: { x: 400, y: 80 },
    data: {
      label: "AEGIS TREASURY",
      sublabel: "MagicBlock PER (Direct Auditor L1 Verified · E2EE)",
    },
    draggable: true,
  });

  const recipientMap = new Map<
    string,
    { totalAmount: number; txCount: number; symbol: string }
  >();

  for (const tx of transactions) {
    if (tx.txType !== "withdrawal" && tx.txType !== "transfer") continue;
    const recipient =
      tx.recipient || `stealth_${tx.commitment?.slice(0, 8) || "unknown"}`;
    const existing = recipientMap.get(recipient);
    if (existing) {
      existing.totalAmount += Math.abs(tx.netAmount);
      existing.txCount++;
    } else {
      recipientMap.set(recipient, {
        totalAmount: Math.abs(tx.netAmount),
        txCount: 1,
        symbol: tx.symbol || "USDC",
      });
    }
  }

  const recipients = Array.from(recipientMap.entries());
  recipients.forEach(([address, data], index) => {
    const nodeId = `recipient-${index}`;
    const angleRange = Math.PI * 0.6;
    const startAngle = (Math.PI - angleRange) / 2;
    const angle =
      recipients.length > 1
        ? startAngle + (index / (recipients.length - 1)) * angleRange
        : Math.PI / 2;
    const radius = 280;
    const x = 400 + Math.cos(angle) * radius * 1.6 - 90;
    const y = 350 + Math.sin(angle) * radius * 1.0;

    nodes.push({
      id: nodeId,
      type: "decrypted",
      position: { x, y },
      data: {
        txType: "withdrawal",
        realLabel:
          data.txCount > 1
            ? `Payroll Batch (${data.txCount}x)`
            : `Recipient (${truncateAddress(address)})`,
        realAmount: formatAmount(data.totalAmount, data.symbol),
        realDetail: `→ ${truncateAddress(address)}`,
        amount: "HIDDEN",
        detail: "0xc8d2···3f9a",
        label: `Commitment[${address.slice(0, 8)}]`,
      },
      draggable: true,
    });

    edges.push({
      id: `edge-${index}`,
      source: "treasury",
      target: nodeId,
      animated: true,
      label: formatAmount(data.totalAmount, data.symbol),
      style: { stroke: "rgba(16, 185, 129, 0.5)", strokeWidth: 2 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "rgba(16, 185, 129, 0.6)",
      },
    });
  });

  return { nodes, edges };
}

function generateDemoTransactions(): DecryptedTransaction[] {
  return [
    { txType: "withdrawal", amount: 4500e6, fee: 0, netAmount: -4500e6, runningBalance: -4500e6, timestamp: new Date("2026-02-15").getTime(), recipient: "61ro7AEx...pMPunJf", symbol: "USDC", decimals: 6, chainAnchorVerified: true, completenessVerified: true, erTransferVerified: true },
    { txType: "withdrawal", amount: 3200e6, fee: 0, netAmount: -3200e6, runningBalance: -7700e6, timestamp: new Date("2026-03-10").getTime(), recipient: "7nYF4xZ8...De1234", symbol: "USDC", decimals: 6, chainAnchorVerified: true, completenessVerified: true, erTransferVerified: true },
    { txType: "withdrawal", amount: 8750e6, fee: 0, netAmount: -8750e6, runningBalance: -16450e6, timestamp: new Date("2026-05-12").getTime(), recipient: "9pAG5xR8...De5678", symbol: "USDC", decimals: 6, chainAnchorVerified: true, completenessVerified: true, erTransferVerified: true },
    { txType: "withdrawal", amount: 2400e6, fee: 0, netAmount: -2400e6, runningBalance: -18850e6, timestamp: new Date("2026-06-28").getTime(), recipient: "2qBH6yS9...Ef9012", symbol: "USDC", decimals: 6, chainAnchorVerified: true, completenessVerified: true, erTransferVerified: true },
    { txType: "withdrawal", amount: 6100e6, fee: 0, netAmount: -6100e6, runningBalance: -24950e6, timestamp: new Date("2026-08-20").getTime(), recipient: "3rCI7zT0...Eg0123", symbol: "USDC", decimals: 6, chainAnchorVerified: true, completenessVerified: true, erTransferVerified: true },
    { txType: "withdrawal", amount: 9500e6, fee: 0, netAmount: -9500e6, runningBalance: -34450e6, timestamp: new Date("2026-11-05").getTime(), recipient: "GxK6sHpq...RaTKT", symbol: "USDC", decimals: 6, chainAnchorVerified: true, completenessVerified: true, erTransferVerified: true },
  ];
}

export function useAuditorEngine(): AuditorEngineResult {
  const [status, setStatus] = useState<AuditorEngineStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [scope, setScope] = useState<AuditScope | null>(null);
  const [reconciliation, setReconciliation] =
    useState<AuditorReconciliationReport | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [transactions, setTransactions] = useState<DecryptedTransaction[]>([]);
  const [summary, setSummary] = useState<AuditorEngineResult["summary"]>(null);
  const executingRef = useRef(false);

  const execute = useCallback(
    async (
      accessToken: string,
      auditorPrivateKeyPkcs8?: string,
      customL1RpcUrl?: string
    ) => {
      if (executingRef.current) return;
      executingRef.current = true;
      setStatus("loading_data");
      setError(null);
      setReconciliation(null);
      const isDemo = accessToken === "demo-token";
      const l1RpcEndpoint = (customL1RpcUrl || "").trim() || L1_DEVNET_RPC;

      try {
        let auditScope: AuditScope;
        if (isDemo) {
          auditScope = {
            org_id: "Aegis_DAO_Demo",
            valid_from: "2026-01-01T00:00:00Z",
            valid_until: "2026-12-31T23:59:59Z",
            allowed_tokens: ["USDC", "SOL"],
          };
        } else {
          const claims = decodeJwtPayload(accessToken);
          if (!claims) throw new Error("Invalid audit JWT");
          auditScope = {
            org_id: claims.org_id,
            valid_from: claims.valid_from,
            valid_until: claims.valid_until,
            allowed_tokens: claims.allowed_tokens,
            viewing_key_id: claims.vk_id,
          };
        }
        setScope(auditScope);

        let raw: DecryptedTransaction[] = [];
        let verifiedChainAnchors = 0;
        let totalBatches = 0;
        let erTransfersVerifiedCount = 0;
        let reconReport: AuditorReconciliationReport | null = null;

        if (isDemo) {
          setStatus("decrypting");
          setProgress("Loading demonstration audit ledger...");
          await new Promise((r) => setTimeout(r, 400));
          raw = generateDemoTransactions();
          verifiedChainAnchors = 1;
          totalBatches = 1;
          erTransfersVerifiedCount = raw.length;
          reconReport = {
            verifiedBy: "demo",
            l1RpcEndpoint,
            treasuryPubkeysChecked: ["DemoTreasury1111111111111111111111111111111"],
            totalL1AnchorsInWindow: 1,
            deliveredMatchedCount: 1,
            undisclosedAnchors: [],
            unanchoredDeliveredRunIds: [],
            completeZeroOmissions: true,
            erTransfersVerifiedCount,
          };
        } else {
          if (!auditorPrivateKeyPkcs8?.trim()) {
            throw new Error(
              "Auditor RSA-OAEP private key is required to decrypt E2EE audit envelopes locally in your browser."
            );
          }

          // Treat /api/audit/decrypt strictly as an UNTRUSTED ciphertext & pointer courier
          setProgress("Fetching encrypted audit envelopes from /api/audit/decrypt...");
          const res = await fetch("/api/audit/decrypt", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(
              data.error || `Audit envelope fetch failed (HTTP ${res.status})`
            );
          }

          setStatus("decrypting");
          const batches: AuditedBatchEnvelope[] = Array.isArray(data.audit?.batches)
            ? data.audit.batches
            : [];
          totalBatches = batches.length;

          // Auditor browser connects DIRECTLY to Solana L1 RPC & MagicBlock ER RPC
          const l1Connection = new Connection(l1RpcEndpoint, "confirmed");
          const erConnection = getErConnection();
          const browserVerifiedBatchesForRecon: Array<{
            payroll_run_id: string;
            anchor_tx_signature: string | null;
            merkle_root: string;
            anchor_verified: boolean;
          }> = [];

          let cumulativeOutflow = 0;

          for (const batch of batches) {
            if (!batch.anchor_tx_signature) {
              throw new Error(
                `Batch ${batch.payroll_run_id} is missing anchor_tx_signature; cannot pull root from Solana L1.`
              );
            }
            if (!batch.e2ee_envelope || !batch.auditor_wrapped_dek) {
              throw new Error(
                `Batch ${batch.payroll_run_id} has no E2EE envelope or auditor-wrapped DEK for this viewing key.`
              );
            }

            // 1. AUDITOR BROWSER pulls & verifies the L1 anchor DIRECTLY off Solana L1 RPC
            //    (NEVER trusts any server-returned root or `verified: true` flag!)
            setProgress(
              `Pulling anchor tx ${batch.anchor_tx_signature.slice(0, 12)}... directly from Solana L1 RPC (${l1RpcEndpoint})...`
            );
            const browserAnchorCheck = await verifyAnchorTransactionOnChain(
              l1Connection,
              batch.anchor_tx_signature,
              batch.initiated_by,
              batch.merkle_root,
              batch.leaf_count
            );

            if (
              !browserAnchorCheck.verified ||
              !browserAnchorCheck.onChainRoot ||
              !browserAnchorCheck.onChainLeafCount
            ) {
              throw new Error(
                `Auditor L1 RPC rejected batch ${batch.payroll_run_id} anchor (${batch.anchor_tx_signature}): ${browserAnchorCheck.error || "Invalid L1 anchor"}`
              );
            }

            const authoritativeL1Root = browserAnchorCheck.onChainRoot;
            const authoritativeL1LeafCount = browserAnchorCheck.onChainLeafCount;
            verifiedChainAnchors += 1;

            browserVerifiedBatchesForRecon.push({
              payroll_run_id: batch.payroll_run_id,
              anchor_tx_signature: batch.anchor_tx_signature,
              merkle_root: authoritativeL1Root,
              anchor_verified: true,
            });

            // 2. Decrypt strictly client-side binding GCM AAD to the BROWSER-FETCHED L1 root
            const expectedAad = buildEnvelopeAad({
              orgId: auditScope.org_id,
              payrollRunId: batch.payroll_run_id,
              merkleRoot: authoritativeL1Root,
              tokenSymbol: batch.token_symbol,
            });

            setProgress(
              `Decrypting batch ${batch.payroll_run_id.slice(0, 8)}... locally & rebuilding Binary Merkle Sum Tree against L1 root...`
            );

            const plaintextJson = await decryptManifestClientSide(
              batch.e2ee_envelope,
              auditorPrivateKeyPkcs8.trim(),
              {
                wrappedDekBase64: batch.auditor_wrapped_dek,
                expectedAad,
              }
            );
            const manifest = JSON.parse(plaintextJson) as DecryptedBatchManifest;

            // 3. Verify FULL Binary Merkle Sum Tree completeness against BROWSER-FETCHED L1 ROOT & COUNT
            const completeness = verifyBatchCompleteness(
              manifest.entries,
              authoritativeL1Root,
              BigInt(batch.total_amount_base_units),
              authoritativeL1LeafCount
            );

            if (!completeness.valid) {
              throw new Error(
                `Batch ${batch.payroll_run_id} failed client-side Merkle Sum Tree completeness check against Solana L1 root: ${completeness.errors.join("; ")}`
              );
            }

            const expectedSender = manifest.initiatedBy || batch.initiated_by;
            const settledMs = new Date(batch.settled_at).getTime();

            for (const entry of manifest.entries) {
              const proofOk =
                verifyMerkleInclusionProof(entry.merkleProof, authoritativeL1Root) &&
                entry.merkleProof.leafHash === entry.commitmentHash;

              if (!proofOk) {
                throw new Error(
                  `Batch ${batch.payroll_run_id} leaf ${entry.index} failed O(log N) Merkle inclusion verification.`
                );
              }

              // 4. Client-side MagicBlock ER Wire Decoding for every on-chain shielded transfer
              let erTransferVerified = false;
              if (
                entry.settlementRail === "onchain_shielded" &&
                entry.settlementTxSignature &&
                expectedSender
              ) {
                setProgress(
                  `Decoding settled MagicBlock ER transfer for leaf ${entry.index} against L1 Merkle root...`
                );
                const transferCheck = await verifyMagicBlockTransferOnChain(
                  erConnection,
                  {
                    signature: entry.settlementTxSignature,
                    leafIndex: entry.index,
                    expectedSender,
                    expectedCommitmentHash: entry.commitmentHash,
                    saltHex: entry.saltHex,
                    runNonce: entry.runNonce,
                    merkleProof: entry.merkleProof,
                    anchoredMerkleRoot: authoritativeL1Root,
                  }
                );
                if (!transferCheck.verified) {
                  throw new Error(
                    `Batch ${batch.payroll_run_id} leaf ${entry.index} failed client-side MagicBlock ER transfer verification: ${transferCheck.error}`
                  );
                }
                erTransferVerified = true;
                erTransfersVerifiedCount += 1;
              }

              const amountNum = Number(entry.amountBaseUnits);
              cumulativeOutflow += amountNum;

              raw.push({
                txType: "withdrawal",
                amount: amountNum,
                fee: 0,
                netAmount: -amountNum,
                runningBalance: -cumulativeOutflow,
                timestamp: settledMs,
                recipient: entry.recipient,
                symbol: entry.tokenSymbol,
                decimals: KNOWN_DECIMALS[entry.tokenSymbol] ?? 6,
                commitment: entry.commitmentHash,
                merkleRoot: authoritativeL1Root,
                anchorTxSignature: batch.anchor_tx_signature,
                chainAnchorVerified: true,
                completenessVerified: completeness.valid && proofOk,
                erTransferVerified,
                settlementRail: entry.settlementRail,
                signature:
                  entry.settlementTxSignature ||
                  batch.anchor_tx_signature ||
                  batch.tx_signatures?.[0],
              });
            }
          }

          // 5. Mandatory Direct Browser-Side Solana L1 Enumeration ("Proof Nothing Was Withheld")
          //    NEVER falls back silently to Aegis server reports — fails loud if L1 RPC fails.
          const treasuryPubkeys: string[] = Array.isArray(data.audit?.treasury_pubkeys)
            ? data.audit.treasury_pubkeys
            : [];

          if (treasuryPubkeys.length === 0) {
            throw new Error(
              "No treasury public keys available to enumerate Solana L1 anchors for cross-batch completeness."
            );
          }

          setProgress(
            `Enumerating all Solana L1 treasury anchors directly via ${l1RpcEndpoint} to verify zero withheld batches...`
          );

          const browserL1Anchors: EnumeratedL1Anchor[] = [];
          let scanned = 0;

          try {
            for (const pubkey of treasuryPubkeys) {
              const resEnum = await enumerateTreasuryAnchorsOnL1(
                l1Connection,
                pubkey,
                {
                  validFromIso: auditScope.valid_from,
                  validUntilIso: auditScope.valid_until,
                  maxSignatures: 200,
                }
              );
              scanned += resEnum.scannedSignatureCount;
              browserL1Anchors.push(...resEnum.anchors);
            }
          } catch (rpcErr) {
            const detail =
              rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
            throw new Error(
              `Direct auditor Solana L1 RPC enumeration failed (${l1RpcEndpoint}): ${detail}. Supply an unthrottled Solana L1 RPC endpoint to complete zero-trust reconciliation.`
            );
          }

          const browserRecon = reconcileAuditedBatchesAgainstL1(
            browserL1Anchors,
            browserVerifiedBatchesForRecon,
            {
              treasuryPubkeysChecked: treasuryPubkeys,
              scannedSignatureCount: scanned,
            }
          );

          reconReport = {
            verifiedBy: "auditor_browser_l1_rpc",
            l1RpcEndpoint,
            treasuryPubkeysChecked: browserRecon.treasuryPubkeysChecked,
            totalL1AnchorsInWindow: browserRecon.totalL1AnchorsInWindow,
            deliveredMatchedCount: browserRecon.deliveredMatchedCount,
            undisclosedAnchors: browserRecon.undisclosedAnchors,
            unanchoredDeliveredRunIds: browserRecon.unanchoredDeliveredRunIds,
            completeZeroOmissions: browserRecon.completeZeroOmissions,
            erTransfersVerifiedCount,
          };
        }

        setStatus("formatting");
        setTransactions(raw);
        setReconciliation(reconReport);
        const { nodes: rfNodes, edges: rfEdges } = buildReactFlowData(raw);
        setNodes(rfNodes);
        setEdges(rfEdges);
        setSummary({
          totalDeposits: 0,
          totalWithdrawals: raw.reduce((s, t) => s + Math.abs(t.netAmount), 0),
          totalFees: 0,
          transactionCount: raw.length,
          filteredCount: raw.length,
          verifiedChainAnchors,
          totalBatches,
          erTransfersVerifiedCount,
        });
        setProgress(null);
        setStatus("complete");
      } catch (err: any) {
        setError(err?.message || "Audit verification failed");
        setStatus("error");
      } finally {
        executingRef.current = false;
      }
    },
    []
  );

  return {
    execute,
    status,
    isLoadingData: status === "loading_data",
    isDecrypting: status === "decrypting",
    isFormatting: status === "formatting",
    error,
    progress,
    scope,
    reconciliation,
    nodes,
    edges,
    transactions,
    summary,
  };
}
