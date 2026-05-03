"use client";

import { useCallback, useState, useMemo, useEffect } from "react";
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  useAuditorEngine,
  type AuditorEngineStatus,
} from "@/hooks/useAuditorEngine";

// ─── Custom Node Components ───────────────────────────────────

function TreasuryNode({ data }: { data: { label: string; sublabel: string } }) {
  return (
    <div className="rf-node-treasury">
      <div className="node-icon">🏛️</div>
      <div className="node-label">{data.label}</div>
      <div className="node-sublabel">{data.sublabel}</div>
    </div>
  );
}

function EncryptedNode({
  data,
}: {
  data: { label: string; hash: string; index: number };
}) {
  return (
    <div className="rf-node-encrypted">
      <div className="node-icon">🔒</div>
      <div className="node-label">{data.label}</div>
      <div className="node-hash">{data.hash}</div>
    </div>
  );
}

function DecryptedNode({
  data,
}: {
  data: { label: string; amount: string; detail: string };
}) {
  return (
    <div className="rf-node-decrypted">
      <div className="node-icon">🔓</div>
      <div className="node-label">{data.label}</div>
      <div className="node-amount">{data.amount}</div>
      <div className="node-detail">{data.detail}</div>
    </div>
  );
}

// ─── Encrypted Placeholder Nodes ──────────────────────────────

const generateHash = () =>
  Array.from({ length: 64 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)]
  ).join("");

function createPlaceholderNodes(): Node[] {
  return [
    {
      id: "treasury",
      type: "treasury",
      position: { x: 300, y: 0 },
      data: {
        label: "AEGIS TREASURY",
        sublabel: "Shielded Pool — Cloak Protocol",
      },
      draggable: true,
    },
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `utxo-${i}`,
      type: "encrypted",
      position: { x: i * 180 - 60, y: 200 },
      data: {
        label: "Encrypted UTXO",
        hash: generateHash().substring(0, 32) + "...",
        index: i,
      },
      draggable: true,
    })),
  ];
}

function createPlaceholderEdges(): Edge[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `edge-${i}`,
    source: "treasury",
    target: `utxo-${i}`,
    animated: false,
    style: { stroke: "rgba(99, 102, 241, 0.3)", strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "rgba(99, 102, 241, 0.4)",
    },
  }));
}

// ─── Node Types Registry ──────────────────────────────────────

const nodeTypes = {
  treasury: TreasuryNode,
  encrypted: EncryptedNode,
  decrypted: DecryptedNode,
};

// ─── Status Labels ────────────────────────────────────────────

const STATUS_LABELS: Record<AuditorEngineStatus, string> = {
  idle: "Ready",
  loading_data: "Loading audit data...",
  decrypting: "Decrypting UTXO commitments...",
  formatting: "Building fund-flow graph...",
  complete: "Decryption Complete",
  error: "Decryption Failed",
};

// ─── Main Component ───────────────────────────────────────────

interface AuditGraphProps {
  accessToken: string | null;
}

export default function AuditGraph({ accessToken }: AuditGraphProps) {
  const placeholderNodes = useMemo(() => createPlaceholderNodes(), []);
  const placeholderEdges = useMemo(() => createPlaceholderEdges(), []);

  const [nodes, setNodes, onNodesChange] = useNodesState(placeholderNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(placeholderEdges);
  const [hasApplied, setHasApplied] = useState(false);

  const engine = useAuditorEngine();

  // ─── Staggered Node Reveal Animation ──────────────────────
  // When the engine produces new nodes, animate them in one by one
  useEffect(() => {
    if (engine.status !== "complete" || engine.nodes.length === 0) return;

    // Start by showing only the treasury
    const treasury = engine.nodes.find((n) => n.id === "treasury");
    if (treasury) {
      setNodes([treasury]);
      setEdges([]);
    }

    // Stagger-reveal each recipient node + edge
    const recipientNodes = engine.nodes.filter((n) => n.id !== "treasury");
    const recipientEdges = engine.edges;

    let cancelled = false;

    const revealSequentially = async () => {
      for (let i = 0; i < recipientNodes.length; i++) {
        if (cancelled) break;
        await new Promise((resolve) => setTimeout(resolve, 400));

        const node = recipientNodes[i];
        const edge = recipientEdges[i];

        setNodes((nds) => [...nds, node]);
        if (edge) {
          setEdges((eds) => [...eds, edge]);
        }
      }
    };

    revealSequentially();

    return () => {
      cancelled = true;
    };
  }, [engine.status, engine.nodes, engine.edges, setNodes, setEdges]);

  // ─── Apply Viewing Key ────────────────────────────────────
  const applyViewingKey = useCallback(async () => {
    if (!accessToken || hasApplied) return;
    setHasApplied(true);
    await engine.execute(accessToken);
  }, [accessToken, hasApplied, engine]);

  const isActive = engine.isLoadingData || engine.isDecrypting || engine.isFormatting;

  return (
    <div>
      <div
        className="glass-card"
        style={{ height: 500, borderRadius: 16, overflow: "hidden" }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.5}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="rgba(99, 102, 241, 0.08)"
          />
          <Controls />
        </ReactFlow>
      </div>

      {/* ─── Controls Bar ──────────────────────────────────── */}
      <div
        style={{
          marginTop: 16,
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          className="btn-primary"
          onClick={applyViewingKey}
          disabled={!accessToken || isActive || engine.status === "complete"}
        >
          {isActive ? (
            <>
              <span className="spinner" />
              {STATUS_LABELS[engine.status]}
            </>
          ) : engine.status === "complete" ? (
            <>🔓 Viewing Key Applied</>
          ) : (
            <>🔑 Apply Viewing Key</>
          )}
        </button>

        {!accessToken && (
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Awaiting magic link verification...
          </span>
        )}

        {engine.status === "complete" && engine.summary && (
          <span className="badge badge-green">
            ✓ {engine.summary.filteredCount} transactions decrypted
          </span>
        )}

        {engine.error && (
          <span
            style={{
              fontSize: 12,
              color: "var(--accent-red)",
            }}
          >
            {engine.error}
          </span>
        )}
      </div>

      {/* ─── Progress / Scope Info ──────────────────────────── */}
      {engine.progress && (
        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            color: "var(--text-muted)",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
        >
          {engine.progress}
        </div>
      )}

      {/* ─── Audit Scope Badge ─────────────────────────────── */}
      {engine.scope && engine.status === "complete" && (
        <div
          className="glass-card"
          style={{
            marginTop: 16,
            padding: "12px 16px",
            display: "flex",
            gap: 24,
            flexWrap: "wrap",
            alignItems: "center",
            borderColor: "rgba(16, 185, 129, 0.15)",
          }}
        >
          <div>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Audit Window
            </span>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--text-primary)",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {new Date(engine.scope.valid_from).toLocaleDateString()} —{" "}
              {new Date(engine.scope.valid_until).toLocaleDateString()}
            </div>
          </div>

          <div>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Allowed Tokens
            </span>
            <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
              {engine.scope.allowed_tokens.map((t) => (
                <span key={t} className="badge badge-indigo" style={{ fontSize: 10 }}>
                  {t}
                </span>
              ))}
            </div>
          </div>

          {engine.summary && (
            <>
              <div>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Total Outflows
                </span>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--accent-green)",
                    fontFamily: "var(--font-geist-mono), monospace",
                  }}
                >
                  ${(engine.summary.totalWithdrawals / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC
                </div>
              </div>

              <div>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Protocol Fees
                </span>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-geist-mono), monospace",
                  }}
                >
                  ${(engine.summary.totalFees / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
