"use client";

import { useState, useCallback, useRef } from "react";
import type { Node, Edge } from "reactflow";
import { MarkerType } from "reactflow";

/**
 * useAuditorEngine — Client-side Auditor Decryption Engine + ReactFlow Formatter.
 *
 * Architecture:
 * 1. Decodes the JWT payload to extract the audit scope:
 *    - vk_id, key_id, org_id, valid_from, valid_until, allowed_tokens
 * 2. Calls POST /api/audit/decrypt with the JWT Bearer token:
 *    - The server decrypts the AES-256-GCM encrypted viewing key
 *    - Runs Cloak SDK scanTransactions with the decrypted nk
 *    - Returns the compliance report (amounts, fees, recipients)
 * 3. Applies strict temporal filtering (valid_from / valid_until)
 * 4. Transforms decrypted transactions into ReactFlow nodes + edges:
 *    - Node 1: "The Treasury" (source of all funds)
 *    - Subsequent nodes: Employee / Stealth Addresses
 *    - Edges: Animated fund flow labeled with amount + token
 *
 * State Machine:
 *   idle → isLoadingData → isDecrypting → isFormatting → complete
 *                                                      ↘ error
 *
 * ⚠ The raw viewing key never leaves the server.
 *   The JWT authorizes the server to decrypt in-memory only.
 */

// ─── Status Machine ─────────────────────────────────────────────

export type AuditorEngineStatus =
  | "idle"
  | "loading_data"    // fetching JWT claims + calling API
  | "decrypting"      // server-side decryption + scan in progress
  | "formatting"      // transforming results into ReactFlow data
  | "complete"
  | "error";

// ─── Decrypted Transaction Type ─────────────────────────────────

export interface DecryptedTransaction {
  txType: string;          // "deposit" | "withdrawal" | "transfer" | "swap"
  amount: number;          // lamports or base units
  fee: number;
  netAmount: number;
  runningBalance: number;
  timestamp: number;       // unix ms
  recipient?: string;      // recipient wallet pubkey
  commitment?: string;
  signature?: string;
  mint?: string;
  decimals?: number;
  symbol?: string;
  outputMint?: string;
  outputSymbol?: string;
}

// ─── JWT Claims ─────────────────────────────────────────────────

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

// ─── Audit Scope (extracted from JWT) ───────────────────────────

export interface AuditScope {
  org_id: string;
  valid_from: string;
  valid_until: string;
  allowed_tokens: string[];
  viewing_key_id?: string;
}

// ─── Hook Return Type ───────────────────────────────────────────

export interface AuditorEngineResult {
  /** Trigger the decryption engine */
  execute: (accessToken: string) => Promise<void>;
  /** Current status */
  status: AuditorEngineStatus;
  /** Convenience booleans for UI */
  isLoadingData: boolean;
  isDecrypting: boolean;
  isFormatting: boolean;
  /** Error message */
  error: string | null;
  /** Progress message */
  progress: string | null;
  /** Extracted JWT scope */
  scope: AuditScope | null;
  /** ReactFlow nodes */
  nodes: Node[];
  /** ReactFlow edges */
  edges: Edge[];
  /** Raw decrypted transactions (filtered by temporal scope) */
  transactions: DecryptedTransaction[];
  /** Summary stats */
  summary: {
    totalDeposits: number;
    totalWithdrawals: number;
    totalFees: number;
    transactionCount: number;
    filteredCount: number;
  } | null;
}

// ─── JWT Decoder ────────────────────────────────────────────────

/**
 * Decodes a JWT payload without verifying the signature.
 * (Verification happens server-side in /api/audit/decrypt.)
 */
function decodeJwtPayload(token: string): AuditJwtClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Base64url → Base64
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ─── Token Formatting ───────────────────────────────────────────

const KNOWN_DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  USDT: 6,
};

function formatAmount(amount: number, symbol?: string): string {
  const decimals = symbol ? KNOWN_DECIMALS[symbol] || 9 : 9;
  const value = amount / Math.pow(10, decimals);

  if (value >= 1000) {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${symbol || "SOL"}`;
  }
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${symbol || "SOL"}`;
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr || "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ─── ReactFlow Node/Edge Builder ────────────────────────────────

function buildReactFlowData(transactions: DecryptedTransaction[]): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // ─── Node 1: The Treasury (center-top) ──────────────────
  nodes.push({
    id: "treasury",
    type: "treasury",
    position: { x: 400, y: 120 },
    data: {
      label: "AEGIS TREASURY",
      sublabel: "Shielded Pool — Cloak Protocol",
    },
    draggable: true,
  });

  // ─── Group outgoing transactions by recipient ───────────
  const recipientMap = new Map<
    string,
    { totalAmount: number; txCount: number; symbol: string; timestamps: number[] }
  >();

  for (const tx of transactions) {
    // Only show outgoing flows (withdrawals/transfers)
    if (tx.txType !== "withdrawal" && tx.txType !== "transfer") continue;

    const recipient = tx.recipient || `stealth_${tx.commitment?.slice(0, 8) || "unknown"}`;
    const existing = recipientMap.get(recipient);

    if (existing) {
      existing.totalAmount += Math.abs(tx.netAmount);
      existing.txCount++;
      existing.timestamps.push(tx.timestamp);
    } else {
      recipientMap.set(recipient, {
        totalAmount: Math.abs(tx.netAmount),
        txCount: 1,
        symbol: tx.symbol || "SOL",
        timestamps: [tx.timestamp],
      });
    }
  }

  // ─── Create employee/stealth address nodes ──────────────
  const recipients = Array.from(recipientMap.entries());
  const totalRecipients = recipients.length;

  // Layout: fan out from treasury in a semicircle
  recipients.forEach(([address, data], index) => {
    const nodeId = `recipient-${index}`;

    // Position in a fan below the treasury
    const angleRange = Math.PI * 0.6; // 108-degree fan
    const startAngle = (Math.PI - angleRange) / 2;
    const angle = totalRecipients > 1
      ? startAngle + (index / (totalRecipients - 1)) * angleRange
      : Math.PI / 2; // center if only 1 recipient

    const radius = 420;
    const x = 400 + Math.cos(angle) * radius * 1.8 - 80;
    const y = 440 + Math.sin(angle) * radius * 0.8;

    nodes.push({
      id: nodeId,
      type: "decrypted",
      position: { x, y },
      data: {
        txType: "withdrawal",
        cipherLabel: `Commitment[${(address || "00000000").slice(0, 8)}]`,
        cipherAmount: "HIDDEN",
        cipherDetail: "0xc8d2···3f9a",
        realLabel: data.txCount > 1
          ? `Payroll Batch (${data.txCount}x)`
          : `Recipient (${truncateAddress(address)})`,
        realAmount: formatAmount(data.totalAmount, data.symbol),
        realDetail: `→ ${truncateAddress(address)}`,
      },
      draggable: true,
    });

    // ─── Animated edge from Treasury → Recipient ────────
    edges.push({
      id: `edge-${index}`,
      source: "treasury",
      target: nodeId,
      animated: true,
      data: { realLabel: formatAmount(data.totalAmount, data.symbol) },
      label: formatAmount(data.totalAmount, data.symbol),
      labelStyle: {
        fontSize: 11,
        fontWeight: 700,
        fill: "rgba(16, 185, 129, 0.9)",
        fontFamily: "var(--font-geist-mono), monospace",
      },
      labelBgStyle: {
        fill: "rgba(7, 8, 15, 0.85)",
        rx: 6,
        ry: 6,
      },
      labelBgPadding: [6, 4] as [number, number],
      style: {
        stroke: "rgba(16, 185, 129, 0.5)",
        strokeWidth: 2,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "rgba(16, 185, 129, 0.6)",
      },
    });
  });

  // If no outgoing transactions, show a placeholder
  if (recipients.length === 0) {
    // Show deposit-only view
    const depositTxs = transactions.filter((tx) => tx.txType === "deposit");
    if (depositTxs.length > 0) {
      nodes.push({
        id: "deposits-summary",
        type: "decrypted",
        position: { x: 350, y: 380 },
        data: {
          label: `${depositTxs.length} Deposits Found`,
          amount: formatAmount(
            depositTxs.reduce((s, t) => s + t.amount, 0),
            depositTxs[0].symbol
          ),
          detail: "No outgoing transfers in audit window",
        },
        draggable: true,
      });

      edges.push({
        id: "edge-deposits",
        source: "treasury",
        target: "deposits-summary",
        animated: true,
        style: { stroke: "rgba(99, 102, 241, 0.4)", strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "rgba(99, 102, 241, 0.5)",
        },
      });
    }
  }

  return { nodes, edges };
}

// ─── Demo Data Generator ────────────────────────────────────────

function generateDemoTransactions(): DecryptedTransaction[] {
  const now = Date.now();
  const day = 86_400_000;

  return [
    {
      txType: "withdrawal",
      amount: 5_000_000_000,
      fee: 15_000_000,
      netAmount: -4_985_000_000,
      runningBalance: 45_000_000_000,
      timestamp: now - 2 * day,
      recipient: "61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf",
      commitment: "a1b2c3d4e5f6789012345678901234567890abcdef01234567890abcdef012345",
      signature: "5UGPnAEXYpJm4x9Z3nJyK123456789abcdef",
      symbol: "USDC",
      decimals: 6,
      mint: "61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf",
    },
    {
      txType: "withdrawal",
      amount: 3_200_000_000,
      fee: 9_600_000,
      netAmount: -3_190_400_000,
      runningBalance: 41_800_000_000,
      timestamp: now - 2 * day,
      recipient: "7nYF4xZ8qLp3vW2mJ9kT5rQdH6uNxRfE3aBcDe1234",
      commitment: "b2c3d4e5f6789012345678901234567890abcdef01234567890abcdef0123456",
      signature: "6VHQoBFYqKn5y0A4P2oLzM234567890bcdefg",
      symbol: "USDC",
      decimals: 6,
      mint: "61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf",
    },
    {
      txType: "withdrawal",
      amount: 8_750_000_000,
      fee: 26_250_000,
      netAmount: -8_723_750_000,
      runningBalance: 33_000_000_000,
      timestamp: now - 1 * day,
      recipient: "9pAG5xR8tMn4uW3kL7jS6dFhE2vNxPgD4aBcDe5678",
      commitment: "c3d4e5f6789012345678901234567890abcdef01234567890abcdef01234567",
      signature: "7WIRpCGZrLo6z1B5Q3pMaN345678901cdefgh",
      symbol: "USDC",
      decimals: 6,
      mint: "61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf",
    },
    {
      txType: "withdrawal",
      amount: 2_400_000_000,
      fee: 7_200_000,
      netAmount: -2_392_800_000,
      runningBalance: 30_600_000_000,
      timestamp: now - 1 * day,
      recipient: "2qBH6yS9uNn5vW4lM8kT7eFiG3wOyQhE5bCdEf9012",
      commitment: "d4e5f6789012345678901234567890abcdef01234567890abcdef012345678",
      signature: "8XJSpDHAsMP7a2C6R4qNbO456789012defghi",
      symbol: "USDC",
      decimals: 6,
      mint: "61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf",
    },
    {
      txType: "withdrawal",
      amount: 6_100_000_000,
      fee: 18_300_000,
      netAmount: -6_081_700_000,
      runningBalance: 24_500_000_000,
      timestamp: now,
      recipient: "3rCI7zT0vOo6wX5mN9lU8gGjH4xPzRiF6cDeEg0123",
      commitment: "e5f6789012345678901234567890abcdef01234567890abcdef0123456789",
      signature: "9YKTqEIBtNQ8b3D7S5rOcP567890123efghij",
      symbol: "USDC",
      decimals: 6,
      mint: "61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf",
    },
  ];
}

// ─── Hook ───────────────────────────────────────────────────────

export function useAuditorEngine(): AuditorEngineResult {
  const [status, setStatus] = useState<AuditorEngineStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [scope, setScope] = useState<AuditScope | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [transactions, setTransactions] = useState<DecryptedTransaction[]>([]);
  const [summary, setSummary] = useState<AuditorEngineResult["summary"]>(null);

  // Prevent double-execution
  const executingRef = useRef(false);

  const execute = useCallback(
    async (accessToken: string) => {
      if (executingRef.current) return;
      executingRef.current = true;

      // Reset state
      setError(null);
      setProgress(null);
      setScope(null);
      setNodes([]);
      setEdges([]);
      setTransactions([]);
      setSummary(null);

      try {
        // ─── Phase 1: Load Data (decode JWT + call API) ──────
        setStatus("loading_data");
        setProgress("Decoding JWT audit scope...");

        const isDemo = accessToken === "demo-token";
        let auditScope: AuditScope;

        if (isDemo) {
          // Demo mode: synthetic scope
          auditScope = {
            org_id: "demo",
            valid_from: new Date(Date.now() - 30 * 86_400_000).toISOString(),
            valid_until: new Date(Date.now() + 15 * 60_000).toISOString(),
            allowed_tokens: ["USDC", "SOL"],
          };
        } else {
          // Real mode: decode JWT claims
          const claims = decodeJwtPayload(accessToken);
          if (!claims) {
            throw new Error("Failed to decode JWT payload");
          }

          auditScope = {
            org_id: claims.org_id,
            valid_from: claims.valid_from,
            valid_until: claims.valid_until,
            allowed_tokens: claims.allowed_tokens,
            viewing_key_id: claims.vk_id,
          };
        }

        setScope(auditScope);
        setProgress(
          `Audit scope: ${new Date(auditScope.valid_from).toLocaleDateString()} — ${new Date(auditScope.valid_until).toLocaleDateString()}`
        );

        // ─── Phase 2: Decrypt (call /api/audit/decrypt) ──────
        setStatus("decrypting");
        setProgress("Server is decrypting viewing key + scanning Cloak pool...");

        let rawTransactions: DecryptedTransaction[];
        let reportSummary: AuditorEngineResult["summary"] | null = null;

        if (isDemo) {
          // Simulate API delay for demo
          await new Promise((resolve) => setTimeout(resolve, 1200));
          rawTransactions = generateDemoTransactions();
          reportSummary = {
            totalDeposits: 0,
            totalWithdrawals: rawTransactions.reduce((s, t) => s + Math.abs(t.netAmount), 0),
            totalFees: rawTransactions.reduce((s, t) => s + t.fee, 0),
            transactionCount: rawTransactions.length,
            filteredCount: rawTransactions.length,
          };
        } else {
          // Real API call
          setProgress("Calling /api/audit/decrypt with Bearer token...");

          const res = await fetch("/api/audit/decrypt", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ limit: 500 }),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || "Decryption API failed");
          }

          rawTransactions = data.audit.transactions || [];
          reportSummary = data.audit.summary
            ? {
                totalDeposits: data.audit.summary.totalDeposits || 0,
                totalWithdrawals: data.audit.summary.totalWithdrawals || 0,
                totalFees: data.audit.summary.totalFees || 0,
                transactionCount: data.audit.summary.transactionCount || 0,
                filteredCount: data.audit.filtered_count || rawTransactions.length,
              }
            : null;
        }

        setProgress(`${rawTransactions.length} transactions received. Applying temporal filter...`);

        // ─── Phase 3: Temporal Filtering ─────────────────────
        // Strictly enforce valid_from / valid_until from the JWT.
        // Transactions outside this window are excluded — proving
        // the time-scoped audit feature works.
        const validFrom = new Date(auditScope.valid_from).getTime();
        const validUntil = new Date(auditScope.valid_until).getTime();

        const filtered = rawTransactions.filter((tx) => {
          if (!tx.timestamp) return false;
          const txTime = typeof tx.timestamp === "number" && tx.timestamp > 1e12
            ? tx.timestamp  // already ms
            : tx.timestamp * 1000; // seconds → ms
          return txTime >= validFrom && txTime <= validUntil;
        });

        setTransactions(filtered);

        if (reportSummary) {
          reportSummary.filteredCount = filtered.length;
        }
        setSummary(reportSummary);

        setProgress(`${filtered.length} transactions within audit window (${rawTransactions.length - filtered.length} filtered out)`);

        // ─── Phase 4: Format for ReactFlow ───────────────────
        setStatus("formatting");
        setProgress("Building fund-flow visualization...");

        // Small delay for UI feedback
        await new Promise((resolve) => setTimeout(resolve, 300));

        const { nodes: rfNodes, edges: rfEdges } = buildReactFlowData(filtered);

        setNodes(rfNodes);
        setEdges(rfEdges);

        setProgress(
          `✓ ${rfNodes.length - 1} recipients, ${rfEdges.length} fund flows visualized`
        );
        setStatus("complete");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        setStatus("error");
        setProgress(null);
        console.error("[Aegis Ledger] Auditor engine failed:", err);
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
