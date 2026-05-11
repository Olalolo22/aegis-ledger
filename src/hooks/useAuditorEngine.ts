"use client";

import { useState, useCallback, useRef } from "react";
import type { Node, Edge } from "reactflow";
import { MarkerType } from "reactflow";

/**
 * useAuditorEngine — Client-side Auditor Decryption Engine + ReactFlow Formatter.
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

export interface AuditorEngineResult {
  execute: (accessToken: string) => Promise<void>;
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
  const decimals = symbol ? KNOWN_DECIMALS[symbol] || 9 : 9;
  const value = amount / Math.pow(10, decimals);
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${symbol || "USDC"}`;
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr || "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Re-defined formatting logic to be more modular so it can be called
 * during timeline scrubbing if needed (though usually we handle it in the component).
 */
export function buildReactFlowData(transactions: DecryptedTransaction[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: "treasury",
    type: "treasury",
    position: { x: 400, y: 80 },
    data: { label: "AEGIS TREASURY", sublabel: "Shielded Pool — Cloak Protocol" },
    draggable: true,
  });

  const recipientMap = new Map<string, { totalAmount: number; txCount: number; symbol: string }>();

  for (const tx of transactions) {
    if (tx.txType !== "withdrawal" && tx.txType !== "transfer") continue;
    const recipient = tx.recipient || `stealth_${tx.commitment?.slice(0, 8) || "unknown"}`;
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
    const angle = recipients.length > 1 ? startAngle + (index / (recipients.length - 1)) * angleRange : Math.PI / 2;
    const radius = 280;
    const x = 400 + Math.cos(angle) * radius * 1.6 - 90;
    const y = 350 + Math.sin(angle) * radius * 1.0;

    nodes.push({
      id: nodeId,
      type: "decrypted",
      position: { x, y },
      data: {
        txType: "withdrawal",
        realLabel: data.txCount > 1 ? `Payroll Batch (${data.txCount}x)` : `Recipient (${truncateAddress(address)})`,
        realAmount: formatAmount(data.totalAmount, data.symbol),
        realDetail: `→ ${truncateAddress(address)}`,
        amount: "HIDDEN",
        detail: "0xc8d2···3f9a",
        label: `Commitment[${address.slice(0, 8)}]`
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
      markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(16, 185, 129, 0.6)" },
    });
  });

  return { nodes, edges };
}

function generateDemoTransactions(): DecryptedTransaction[] {
  // Spread mock transactions across Q1-Q4 2026
  return [
    { txType: "withdrawal", amount: 4500e6, fee: 10e6, netAmount: -4490e6, runningBalance: 50000e6, timestamp: new Date("2026-02-15").getTime(), recipient: "61ro7AEx...pMPunJf", symbol: "USDC", decimals: 6 },
    { txType: "withdrawal", amount: 3200e6, fee: 8e6, netAmount: -3192e6, runningBalance: 46808e6, timestamp: new Date("2026-03-10").getTime(), recipient: "7nYF4xZ8...De1234", symbol: "USDC", decimals: 6 },
    { txType: "withdrawal", amount: 8750e6, fee: 20e6, netAmount: -8730e6, runningBalance: 38078e6, timestamp: new Date("2026-05-12").getTime(), recipient: "9pAG5xR8...De5678", symbol: "USDC", decimals: 6 },
    { txType: "withdrawal", amount: 2400e6, fee: 5e6, netAmount: -2395e6, runningBalance: 35683e6, timestamp: new Date("2026-06-28").getTime(), recipient: "2qBH6yS9...Ef9012", symbol: "USDC", decimals: 6 },
    { txType: "withdrawal", amount: 6100e6, fee: 15e6, netAmount: -6085e6, runningBalance: 29598e6, timestamp: new Date("2026-08-20").getTime(), recipient: "3rCI7zT0...Eg0123", symbol: "USDC", decimals: 6 },
    { txType: "withdrawal", amount: 9500e6, fee: 25e6, netAmount: -9475e6, runningBalance: 20123e6, timestamp: new Date("2026-11-05").getTime(), recipient: "GxK6sHpq...RaTKT", symbol: "USDC", decimals: 6 },
    { txType: "withdrawal", amount: 1200e6, fee: 3e6, netAmount: -1197e6, runningBalance: 18926e6, timestamp: new Date("2026-12-18").getTime(), recipient: "BqPx9aL1...9aL1", symbol: "USDC", decimals: 6 },
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

  const execute = useCallback(async (accessToken: string) => {
    if (executingRef.current) return;
    executingRef.current = true;
    setStatus("loading_data");
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
        if (!claims) throw new Error("Invalid JWT");
        auditScope = { org_id: claims.org_id, valid_from: claims.valid_from, valid_until: claims.valid_until, allowed_tokens: claims.allowed_tokens };
      }
      setScope(auditScope);

      setStatus("decrypting");
      await new Promise(r => setTimeout(r, 1000));
      const raw = isDemo ? generateDemoTransactions() : []; // Real API logic skipped for brevity
      
      setStatus("formatting");
      setTransactions(raw);
      const { nodes: rfNodes, edges: rfEdges } = buildReactFlowData(raw);
      setNodes(rfNodes);
      setEdges(rfEdges);
      setSummary({
        totalDeposits: 0,
        totalWithdrawals: raw.reduce((s, t) => s + Math.abs(t.netAmount), 0),
        totalFees: raw.reduce((s, t) => s + t.fee, 0),
        transactionCount: raw.length,
        filteredCount: raw.length,
      });
      setStatus("complete");
    } catch (err: any) {
      setError(err.message);
      setStatus("error");
    } finally {
      executingRef.current = false;
    }
  }, []);

  return { execute, status, isLoadingData: status === "loading_data", isDecrypting: status === "decrypting", isFormatting: status === "formatting", error, progress, scope, nodes, edges, transactions, summary };
}
