"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Node,
  Edge,
  ConnectionMode,
  BackgroundVariant,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import styles from "./AuditGraph.module.css";
import { useAuditorEngine, buildReactFlowData } from "@/hooks/useAuditorEngine";

/* ── Custom ReactFlow Node Components ── */
const glassStyle = {
  background: 'rgba(15, 16, 28, 0.75)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
  padding: '14px 18px',
  backdropFilter: 'blur(12px)',
  minWidth: 180,
  textAlign: 'center' as const,
};

function CustomTreasuryNode({ data }: { data: any }) {
  return (
    <div style={{ ...glassStyle, border: '1px solid rgba(0,184,122,0.25)', minWidth: 200 }}>
      <Handle type="source" position={Position.Bottom} style={{ background: '#00b87a', width: 8, height: 8 }} />
      <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: '#00b87a', marginBottom: 4 }}>
        {data.label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--dim)' }}>
        {data.sublabel}
      </div>
    </div>
  );
}

function CustomEncryptedNode({ data }: { data: any }) {
  return (
    <div style={{ ...glassStyle, border: '1px solid rgba(255,255,255,0.04)' }}>
      <Handle type="target" position={Position.Top} style={{ background: 'rgba(0,184,122,0.3)', width: 6, height: 6 }} />
      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ghost)', marginBottom: 2 }}>
        {data.label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ghost)', opacity: 0.5 }}>
        {data.amount}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--ghost)', opacity: 0.4, marginTop: 2 }}>
        {data.detail}
      </div>
    </div>
  );
}

function CustomDecryptedNode({ data }: { data: any }) {
  const accentColor = data.txType === 'swap' ? '#d97c0a' : '#00b87a';
  return (
    <div style={{ ...glassStyle, border: `1px solid ${accentColor}33` }}>
      <Handle type="target" position={Position.Top} style={{ background: accentColor, width: 6, height: 6 }} />
      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
        {data.realLabel || data.label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: accentColor, fontWeight: 500 }}>
        {data.realAmount || data.amount}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--mid)', marginTop: 2 }}>
        {data.realDetail || data.detail}
      </div>
    </div>
  );
}

const nodeTypes = {
  treasury: CustomTreasuryNode,
  encrypted: CustomEncryptedNode,
  decrypted: CustomDecryptedNode,
};

function AuditorLogin({ onAuth }: { onAuth: (key: string) => void }) {
  const [key, setKey] = useState("");
  const [ttl, setTtl] = useState("--:--");

  useEffect(() => {
    if (!key) { setTtl("--:--"); return; }
    if (key === "demo-token") { setTtl("15m 00s remaining"); return; }
    setTtl("Session active");
  }, [key]);

  return (
    <div className={styles.loginWrap}>
      <div className={styles.loginBox}>
        <div className={styles.loginMark} style={{ fontFamily: "var(--serif)" }}>Æ</div>
        <span className={styles.eyebrow}>Compliance Access</span>
        <h1 className={styles.loginTitle} style={{ fontFamily: "var(--serif)" }}>Auditor Login</h1>
        <p className={styles.loginSub}>
          Authenticate with your time-limited cryptographic viewing key to access the shielded treasury ledger.
        </p>

        <div className={styles.loginCard}>
          <label className={styles.fieldLabel}>Viewing key (magic-link JWT)</label>
          <input
            className={styles.keyInput}
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="vk_audit_q1_2026_bc4e···f8a2"
          />

          <div className={styles.keyMeta}>
            {[
              { label: "Scope", val: "FY 2026 · read-only", col: "var(--ink)" },
              { label: "TTL", val: ttl, col: "var(--amber)" },
              { label: "Session", val: "time-limited · auto-expires", col: "var(--dim)" },
            ].map(r => (
              <div key={r.label} className={styles.keyMetaRow}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)" }}>{r.label}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: r.col }}>{r.val}</span>
              </div>
            ))}
          </div>

          <button
            className={styles.authBtn}
            onClick={() => { if (key) onAuth(key); }}
            disabled={!key}
          >
            Authenticate →
          </button>
          <button className={styles.demoKeyBtn} onClick={() => setKey("demo-token")}>
            Use demo key
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AuditGraph({ accessToken }: { accessToken?: string }) {
  const [localToken, setLocalToken] = useState<string>(accessToken || "");
  const [authed, setAuthed] = useState(!!accessToken);
  const [decrypted, setDecrypted] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [timeline, setTimeline] = useState(100);

  const { execute, status, scope, transactions } = useAuditorEngine();

  useEffect(() => {
    if (authed && localToken && status === "idle") {
      execute(localToken);
    }
  }, [authed, localToken, status, execute]);

  const handleAuth = (key: string) => { setLocalToken(key); setAuthed(true); };

  const handleDecryptToggle = () => {
    if (decrypted) { setDecrypted(false); return; }
    setScanning(true);
    setTimeout(() => { setDecrypted(true); setScanning(false); }, 1000);
  };

  // ─── Timeline Logic ───────────────────────────────────────────
  const quarters = ["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"];
  
  const selectedRangeEnd = useMemo(() => {
    if (!scope?.valid_from || !scope?.valid_until) return Date.now();
    const start = new Date(scope.valid_from).getTime();
    const end = new Date(scope.valid_until).getTime();
    return start + (end - start) * (timeline / 100);
  }, [scope, timeline]);

  const currentQ = useMemo(() => {
    const date = new Date(selectedRangeEnd);
    const month = date.getMonth();
    if (month < 3) return "Q1 2026 (Jan–Mar)";
    if (month < 6) return "Q2 2026 (Apr–Jun)";
    if (month < 9) return "Q3 2026 (Jul–Sep)";
    return "Q4 2026 (Oct–Dec)";
  }, [selectedRangeEnd]);

  const filteredTxs = useMemo(() => {
    if (!scope?.valid_from) return [];
    const start = new Date(scope.valid_from).getTime();
    return transactions.filter(tx => tx.timestamp >= start && tx.timestamp <= selectedRangeEnd);
  }, [transactions, scope, selectedRangeEnd]);

  const { nodes, edges } = useMemo(() => buildReactFlowData(filteredTxs), [filteredTxs]);

  const uniqueRecipientsCount = useMemo(() => {
    const set = new Set();
    filteredTxs.forEach(tx => { if (tx.recipient) set.add(tx.recipient); });
    return set.size;
  }, [filteredTxs]);

  const displayNodes = nodes.map(n => {
    if (n.id === "treasury") {
      return {
        ...n,
        data: {
          ...n.data,
          label: decrypted ? "DAO Treasury" : "0xc8d2···3f9a",
          sublabel: decrypted ? "Aegis Ledger — Verified" : "Shielded Pool — Cloak Protocol",
        }
      };
    }
    return {
      ...n,
      type: decrypted ? "decrypted" : "encrypted",
      data: {
        ...n.data,
        label: decrypted ? n.data.realLabel || n.data.label : n.data.label,
        amount: decrypted ? n.data.realAmount || n.data.amount : "HIDDEN",
        detail: decrypted ? n.data.realDetail || n.data.detail : "0xc8d2···3f9a",
      }
    };
  });

  const displayEdges = edges.map(e => ({
    ...e,
    label: decrypted ? e.label : "HIDDEN",
    animated: true,
    style: { 
      stroke: decrypted ? "#00b87a" : "rgba(0,184,122,0.3)", 
      strokeWidth: 2, 
      strokeDasharray: decrypted ? "none" : "5 5" 
    },
  }));

  const isDone = status === "complete";
  const showFlow = isDone;

  if (!authed) return <AuditorLogin onAuth={handleAuth} />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Compliance View · {scope?.org_id || "Demo_DAO"}</span>
          <h1 className={styles.h1} style={{ fontFamily: "var(--serif)" }}>
            Treasury Ledger<br />
            <em>Read-only audit access.</em>
          </h1>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.authedPill}>
            <span className={styles.authedDot} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--green)" }}>
              Authenticated · Session: time-limited · auto-expires
            </span>
          </div>
        </div>
      </div>

      <div className={`${styles.card} ${styles.timelineCard}`}>
        <div className={styles.timelineHeader}>
          <div>
            <span className={styles.fieldEyebrow}>Valid Period / Authorized Scope</span>
            <div className={styles.timelineTitle}>
              {scope ? "FY 2026 Audit Window" : "Loading..."}
              <span className={styles.timelineSub}>
                {scope ? ` · Jan 1, 2026 – ${new Date(selectedRangeEnd).toLocaleDateString()}` : ""}
              </span>
            </div>
          </div>
          <div className={styles.currentQBadge}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink)" }}>
              Current: {currentQ}
            </span>
          </div>
        </div>
        <input type="range" min={0} max={100} value={timeline} onChange={e => setTimeline(Number(e.target.value))} className={styles.slider} />
        <div className={styles.quarterLabels}>
          {quarters.map((q, i) => (
            <span key={q} style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: i === Math.floor((timeline / 101) * quarters.length) ? "var(--ink)" : "var(--ghost)" }}>{q}</span>
          ))}
        </div>
      </div>

      <div className={styles.graphRow}>
        <div className={styles.flowCard}>
          <div className={styles.flowCardHeader}>
            <span className={styles.fieldLabel}>Transaction Flow Graph</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mid)", marginLeft: 12 }}>
              ↓ Showing {filteredTxs.length} transactions in {currentQ.split(' ')[0]} ↓
            </span>
          </div>
          <div className={styles.flowCanvas}>
            {showFlow ? (
                <ReactFlow 
                  nodes={displayNodes} 
                  edges={displayEdges} 
                  nodeTypes={nodeTypes} 
                  fitView 
                  fitViewOptions={{ padding: 0.1 }}
                  connectionMode={ConnectionMode.Loose}
                proOptions={{ hideAttribution: true }}
                style={{ filter: decrypted ? 'hue-rotate(120deg) brightness(1.2) contrast(1.1)' : 'none', transition: 'filter 0.5s ease' }}
              >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--mist)" />
                <Controls showInteractive={false} />
              </ReactFlow>
            ) : (
              <div className={styles.flowLocked}>
                <div className={styles.flowLockedInner}>
                  <span style={{ fontSize: 24, marginBottom: 8, display: "block" }}>⌛</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--mid)" }}>Deciphering ledger...</span>
                </div>
              </div>
            )}
            {scanning && <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '2px', background: '#00ffcc', boxShadow: '0 0 20px #00ffcc', zIndex: 100, animation: 'scanDown 1s linear forwards' }} />}
          </div>
        </div>

        <div className={`${styles.card} ${styles.decryptPanel}`}>
          <span className={styles.fieldEyebrow}>Ledger View Mode</span>
          <div className={styles.toggleRow}>
            <div>
              <div className={styles.toggleTitle}>{decrypted ? "Decrypted Ledger" : "Public Ciphertext"}</div>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)" }}>{decrypted ? "Plaintext · verified" : "Scrambled on-chain hashes"}</span>
            </div>
            <button className={styles.toggle} onClick={handleDecryptToggle} style={{ background: decrypted ? "var(--green)" : "var(--mist)" }} disabled={!isDone || scanning}>
              <span className={styles.toggleThumb} style={{ transform: decrypted ? "translateX(20px)" : "none" }} />
            </button>
          </div>
          <div className={styles.statsBlock}>
            {[
              { label: "Transactions", val: filteredTxs.length.toString() },
              { label: "Total outflow", val: decrypted ? `$${(filteredTxs.reduce((s, t) => s + Math.abs(t.netAmount), 0) / 1e6).toLocaleString()}` : "ENCRYPTED" },
              { label: "Recipients", val: decrypted ? `${uniqueRecipientsCount} wallets` : "HIDDEN" },
              { label: "Proof status", val: "✓ Groth16", col: "var(--green)" },
            ].map(s => (
              <div key={s.label} className={styles.statRow}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--dim)" }}>{s.label}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 500, color: s.col || "var(--ink)" }}>{s.val}</span>
              </div>
            ))}
          </div>
          <div className={styles.readOnlyNote}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--blue)", lineHeight: 1.6, display: "block", marginTop: 16 }}>
              Viewing key is cryptographic read-only. It cannot authorise any transaction.
            </span>
          </div>
        </div>
      </div>

      <div className={`${styles.card} ${styles.tableCard}`}>
        <div className={styles.tableHeader}>
          <span className={styles.fieldLabel}>Transaction Records</span>
          <span className={`ae-badge ${decrypted ? "ae-badge-green" : "ae-badge-ghost"}`}>{decrypted ? "DECRYPTED VIEW" : "CIPHERTEXT VIEW"}</span>
        </div>
        <div className={styles.tableHead}>
          {["Date / Block", "From", "To", "Amount", "Type"].map(h => (
            <span key={h} style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--dim)", textTransform: "uppercase" }}>{h}</span>
          ))}
        </div>
        {filteredTxs.map((tx, i) => (
          <div key={i} className={styles.tableRow} style={{ borderBottom: i < filteredTxs.length - 1 ? "1px solid var(--mist)" : "none" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{new Date(tx.timestamp).toLocaleDateString()}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}>{decrypted ? "DaoTreasury.sol" : "0xc8d2···3f9a"}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{decrypted ? (tx.recipient ? `${tx.recipient.slice(0, 4)}···${tx.recipient.slice(-4)}` : "Unknown") : `Commitment[${tx.commitment?.slice(0,8) || "..."}]`}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, fontWeight: 500 }}>{decrypted ? `$${(Math.abs(tx.netAmount) / 1e6).toLocaleString()}` : "HIDDEN"}</span>
            <span className={`ae-badge ${decrypted ? (tx.txType === "withdrawal" ? "ae-badge-blue" : "ae-badge-amber") : "ae-badge-ghost"}`}>{decrypted ? (tx.txType === "withdrawal" ? "Payroll" : "Transfer") : "0x01"}</span>
          </div>
        ))}
      </div>
      <style>{`@keyframes scanDown { from { top: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } to { top: 100%; opacity: 0; } }`}</style>
    </div>
  );
}
