"use client";

import { useState, useCallback, useRef } from "react";
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

/**
 * useAuditorEngine — Client-Side Zero-Knowledge Auditor Decryption Engine.
 *
 * Security Invariant:
 * - Aegis servers NEVER decrypt payroll manifests.
 * - `/api/audit/decrypt` independently pulls each batch's Merkle root off Solana L1
 *   RPC and delivers the client-encrypted `e2ee_envelope` + `auditor_wrapped_dek`.
 * - This hook decrypts each manifest locally in the auditor's browser using the
 *   auditor's private key (never sent to any server) and verifies full Binary
 *   Merkle Sum Tree completeness directly against the L1-anchored root.
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
  settlementRail?: string;
  mint?: string;
  decimals?: number;
  symbol?: string;
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
  token_symbol: string;
  merkle_root: string;
  leaf_count: number;
  total_amount_base_units: string;
  tx_signatures: string[];
  settled_at: string;
  settlement_verified: boolean;
  chain_anchor: {
    verified: boolean;
    signature: string | null;
    slot?: number | null;
    block_time?: number | null;
    on_chain_root?: string | null;
    on_chain_leaf_count?: number | null;
    signer_verified?: boolean;
    error?: string | null;
  };
  e2ee_envelope: EncryptedAuditEnvelope | null;
  auditor_wrapped_dek: string | null;
  aad_matches_chain_root: boolean;
}

interface DecryptedBatchManifest {
  version: number;
  payrollRunId: string;
  orgId: string;
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
  }>;
}

export interface AuditorEngineResult {
  execute: (accessToken: string, auditorPrivateKeyPkcs8?: string) => Promise<void>;
  status: AuditorEngineStatus;
  isLoadingData: boolean;
  isDecrypting: boolean;
  isFormatting: boolean;
  error: string | null;
  progress: string | null;
  scope: AuditScope | null;
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
      sublabel: "MagicBlock PER (L1-Anchored · Client-Side E2EE)",
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
    { txType: "withdrawal", amount: 4500e6, fee: 0, netAmount: -4500e6, runningBalance: -4500e6, timestamp: new Date("2026-02-15").getTime(), recipient: "61ro7AEx...pMPunJf", symbol: "USDC", decimals: 6, chainAnchorVerified: true, completenessVerified: true },
    { txType: "withdrawal", amount: 3200e6, fee: 0, netAmount: -3200e6, runningBalance: -7700e6, timestamp: new Date("2026-03-10").getTime(), recipient: "7nYF4xZ8...De1234", symbol: "USDC", decimals: 6, chainAnchorVerified: true, completenessVerified: true },
    { txType: "withdrawal", amount: 8750e6, fee: 0, netAmount: -8750e6, runningBalance: -16450e6, timestamp: new Date("2026-05-12").getTime(), recipient: "9pAG5xR8...De5678", symbol: "USDC", decimals: 6, chainAnchorVerified: true, completenessVerified: true },
    { txType: "withdrawal", amount: 2400e6, fee: 0, netAmount: -2400e6, runningBalance: -18850e6, timestamp: new Date("2026-06-28").getTime(), recipient: "2qBH6yS9...Ef9012", symbol: "USDC", decimals: 6, chainAnchorVerified: true, completenessVerified: true },
    { txType: "withdrawal", amount: 6100e6, fee: 0, netAmount: -6100e6, runningBalance: -24950e6, timestamp: new Date("2026-08-20").getTime(), recipient: "3rCI7zT0...Eg0123", symbol: "USDC", decimals: 6, chainAnchorVerified: true, completenessVerified: true },
    { txType: "withdrawal", amount: 9500e6, fee: 0, netAmount: -9500e6, runningBalance: -34450e6, timestamp: new Date("2026-11-05").getTime(), recipient: "GxK6sHpq...RaTKT", symbol: "USDC", decimals: 6, chainAnchorVerified: true, completenessVerified: true },
  ];
}

export function useAuditorEngine(): AuditorEngineResult {
  const [status, setStatus] = useState<AuditorEngineStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [scope, setScope] = useState<AuditScope | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [transactions, setTransactions] = useState<DecryptedTransaction[]>([]);
  const [summary, setSummary] = useState<AuditorEngineResult["summary"]>(null);
  const executingRef = useRef(false);

  const execute = useCallback(
    async (accessToken: string, auditorPrivateKeyPkcs8?: string) => {
      if (executingRef.current) return;
      executingRef.current = true;
      setStatus("loading_data");
      setError(null);
      const isDemo = accessToken === "demo-token";

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

        if (isDemo) {
          setStatus("decrypting");
          setProgress("Loading demonstration audit ledger...");
          await new Promise((r) => setTimeout(r, 400));
          raw = generateDemoTransactions();
          verifiedChainAnchors = 1;
          totalBatches = 1;
        } else {
          if (!auditorPrivateKeyPkcs8?.trim()) {
            throw new Error(
              "Auditor RSA-OAEP private key is required to decrypt E2EE audit envelopes locally in your browser."
            );
          }

          setProgress(
            "Fetching L1-verified encrypted audit envelopes from /api/audit/decrypt..."
          );
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

          let cumulativeOutflow = 0;

          for (const batch of batches) {
            if (!batch.chain_anchor?.verified || !batch.chain_anchor.on_chain_root) {
              throw new Error(
                `Batch ${batch.payroll_run_id} failed Solana L1 root anchor verification: ${batch.chain_anchor?.error || "Unanchored root"}`
              );
            }
            if (!batch.e2ee_envelope || !batch.auditor_wrapped_dek) {
              throw new Error(
                `Batch ${batch.payroll_run_id} has no E2EE envelope or auditor-wrapped DEK for this viewing key.`
              );
            }

            verifiedChainAnchors += 1;
            const onChainRoot = batch.chain_anchor.on_chain_root;
            const expectedAad = buildEnvelopeAad({
              orgId: auditScope.org_id,
              payrollRunId: batch.payroll_run_id,
              merkleRoot: onChainRoot,
              tokenSymbol: batch.token_symbol,
            });

            setProgress(
              `Decrypting batch ${batch.payroll_run_id.slice(0, 8)}... locally in browser & verifying against L1 root...`
            );

            // Decrypt strictly client-side with auditor's private key
            const plaintextJson = await decryptManifestClientSide(
              batch.e2ee_envelope,
              auditorPrivateKeyPkcs8.trim(),
              {
                wrappedDekBase64: batch.auditor_wrapped_dek,
                expectedAad,
              }
            );
            const manifest = JSON.parse(plaintextJson) as DecryptedBatchManifest;

            // Verify FULL Binary Merkle Sum Tree completeness against the SOLANA L1 ROOT
            const completeness = verifyBatchCompleteness(
              manifest.entries,
              onChainRoot,
              BigInt(batch.total_amount_base_units),
              batch.leaf_count
            );

            if (!completeness.valid) {
              throw new Error(
                `Batch ${batch.payroll_run_id} failed client-side Merkle Sum Tree completeness check against Solana L1 root: ${completeness.errors.join("; ")}`
              );
            }

            const settledMs = new Date(batch.settled_at).getTime();
            for (const entry of manifest.entries) {
              const proofOk =
                verifyMerkleInclusionProof(entry.merkleProof, onChainRoot) &&
                entry.merkleProof.leafHash === entry.commitmentHash;

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
                merkleRoot: onChainRoot,
                anchorTxSignature: batch.chain_anchor.signature || undefined,
                chainAnchorVerified: true,
                completenessVerified: completeness.valid && proofOk,
                settlementRail: entry.settlementRail,
                signature: batch.tx_signatures?.[0],
              });
            }
          }
        }

        setStatus("formatting");
        setTransactions(raw);
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
    nodes,
    edges,
    transactions,
    summary,
  };
}
