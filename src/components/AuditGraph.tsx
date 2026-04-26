"use client";

import { useCallback, useState, useMemo } from "react";
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

// ─── Graph Data ───────────────────────────────────────────────

const generateHash = () =>
  Array.from({ length: 64 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)]
  ).join("");

// Simulated decrypted payroll data (what the compliance report reveals)
const decryptedPayments = [
  { amount: "5,000 USDC", detail: "→ Contractor A Wallet", label: "Payroll #1 — Contractor" },
  { amount: "3,200 USDC", detail: "→ Contractor B Wallet", label: "Payroll #2 — Designer" },
  { amount: "8,750 USDC", detail: "→ Contractor C Wallet", label: "Payroll #3 — Lead Dev" },
  { amount: "2,400 USDC", detail: "→ Contractor D Wallet", label: "Payroll #4 — Marketing" },
  { amount: "6,100 USDC", detail: "→ Contractor E Wallet", label: "Payroll #5 — Ops Lead" },
];

function createInitialNodes(): Node[] {
  return [
    {
      id: "treasury",
      type: "treasury",
      position: { x: 300, y: 0 },
      data: { label: "AEGIS TREASURY", sublabel: "Shielded Pool — Cloak Protocol" },
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

function createInitialEdges(): Edge[] {
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

// ─── Main Component ───────────────────────────────────────────

interface AuditGraphProps {
  accessToken: string | null;
}

export default function AuditGraph({ accessToken }: AuditGraphProps) {
  const initialNodes = useMemo(() => createInitialNodes(), []);
  const initialEdges = useMemo(() => createInitialEdges(), []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isDecrypted, setIsDecrypted] = useState(false);

  const applyViewingKey = useCallback(async () => {
    if (!accessToken || isDecrypting || isDecrypted) return;

    setIsDecrypting(true);

    try {
      // Call the decrypt endpoint (in production, this actually decrypts)
      // For the demo, we simulate the response since we need a real Cloak instance
      const response = await fetch("/api/audit/decrypt", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit: 250 }),
      });

      // Whether the API succeeds or not, we animate the demo data
      // In production, `data.audit.transactions` would populate the nodes
      if (response.ok) {
        const data = await response.json();
        console.log("Compliance report:", data);
      }
    } catch {
      // API may not be fully wired to Cloak in dev — continue with demo data
    }

    // ─── Animate Node Transformation ─────────────────────────
    // Stagger the reveal: each node transforms 400ms after the previous
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 400));

      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === `utxo-${i}`) {
            return {
              ...node,
              type: "decrypted",
              data: {
                label: decryptedPayments[i].label,
                amount: decryptedPayments[i].amount,
                detail: decryptedPayments[i].detail,
              },
            };
          }
          return node;
        })
      );

      // Animate the edge too
      setEdges((eds) =>
        eds.map((edge) => {
          if (edge.id === `edge-${i}`) {
            return {
              ...edge,
              animated: true,
              style: { stroke: "rgba(16, 185, 129, 0.5)", strokeWidth: 2 },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: "rgba(16, 185, 129, 0.6)",
              },
            };
          }
          return edge;
        })
      );
    }

    setIsDecrypting(false);
    setIsDecrypted(true);
  }, [accessToken, isDecrypting, isDecrypted, setNodes, setEdges]);

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

      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <button
          className="btn-primary"
          onClick={applyViewingKey}
          disabled={!accessToken || isDecrypting || isDecrypted}
        >
          {isDecrypting ? (
            <>
              <span className="spinner" />
              Decrypting UTXOs...
            </>
          ) : isDecrypted ? (
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

        {isDecrypted && (
          <span className="badge badge-green">
            ✓ 5 transactions decrypted
          </span>
        )}
      </div>
    </div>
  );
}
