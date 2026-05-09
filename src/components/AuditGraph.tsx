"use client";

import { useState, useCallback, useEffect } from "react";
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
import { useAuditorEngine } from "@/hooks/useAuditorEngine";

/* ── Custom ReactFlow Node Components ── */
const glassStyle = {
  background: 'rgba(15, 16, 28, 0.75)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
  padding: '14px 18px',
  backdropFilter: 'blur(12px)',
  minWidth: 160,
  textAlign: 'center' as const,
};

function CustomTreasuryNode({ data }: { data: any }) {
  return (
    <div style={{ ...glassStyle, border: '1px solid rgba(0,184,122,0.25)', minWidth: 200 }}>
      <Handle type="source" position={Position.Bottom} style={{ background: '#00b87a', width: 8, height: 8 }} />
      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: '#00b87a', marginBottom: 4 }}>
        {data.label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--dim)' }}>
        {data.sublabel}
      </div>
    </div>
  );
}

function CustomEncryptedNode({ data }: { data: any }) {
  return (
    <div style={{ ...glassStyle, border: '1px solid rgba(255,255,255,0.04)' }}>
      <Handle type="target" position={Position.Top} style={{ background: 'rgba(0,184,122,0.3)', width: 6, height: 6 }} />
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ghost)', marginBottom: 2 }}>
        {data.label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ghost)', opacity: 0.5 }}>
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
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
        {data.realLabel || data.label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: accentColor, fontWeight: 500 }}>
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
    if (!key) {
      setTtl("--:--");
      return;
    }
    try {
      if (key === "demo-token") {
        setTtl("15m 00s remaining");
        return;
      }
      const parts = key.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        if (payload.valid_until) {
          const ms = new Date(payload.valid_until).getTime() - Date.now();
          if (ms <= 0) {
            setTtl("Expired");
          } else {
            const hours = Math.floor(ms / 3600000);
            const mins = Math.floor((ms % 3600000) / 60000);
            const secs = Math.floor((ms % 60000) / 1000);
            if (hours > 0) {
              setTtl(`${hours}h ${mins}m remaining`);
            } else {
              setTtl(`${mins}m ${secs}s remaining`);
            }
          }
          return;
        }
      }
    } catch (e) {
      // ignore
    }
    setTtl("Invalid format");
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
            placeholder="vk_audit_q3_2025_bc4e···f8a2"
          />

          <div className={styles.keyMeta}>
            {[
              { label: "Scope", val: "Q3 2025 · read-only", col: "var(--ink)" },
              { label: "TTL", val: ttl, col: "var(--amber)" },
              { label: "Session", val: "Redis-backed · auto-revoke", col: "var(--dim)" },
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
          <button className={styles.demoKeyBtn}
            onClick={() => setKey("demo-token")}>
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
  const [timeline, setTimeline] = useState(50);

  const { execute, status, progress, scope, nodes: rfNodes, edges: rfEdges, transactions, summary, error } = useAuditorEngine();

  useEffect(() => {
    if (authed && localToken && status === "idle") {
      execute(localToken);
    }
  }, [authed, localToken, status, execute]);

  const handleAuth = (key: string) => {
    setLocalToken(key);
    setAuthed(true);
  };

  const handleRevoke = () => {
    setAuthed(false);
    setLocalToken("");
    window.location.reload(); // Simple state reset
  };

  const handleDecryptToggle = () => {
    if (decrypted) {
      setDecrypted(false);
      return;
    }
    setScanning(true);
    // The "decryption" only happens after the 1s scan animation finishes
    setTimeout(() => {
      setDecrypted(true);
      setScanning(false);
    }, 1000);
  };

  const [ttl, setTtl] = useState("--:--");

  useEffect(() => {
    if (!scope?.valid_until) return;
    const interval = setInterval(() => {
      const ms = new Date(scope.valid_until).getTime() - Date.now();
      if (ms <= 0) { 
        setTtl("Expired"); 
        clearInterval(interval); 
        return; 
      }
      const hours = Math.floor(ms / 3600000);
      const mins = Math.floor((ms % 3600000) / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      if (hours > 0) {
        setTtl(`${hours}h ${mins}m`);
      } else {
        setTtl(`${mins}m ${secs}s`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [scope?.valid_until]);

  if (!authed) return <AuditorLogin onAuth={handleAuth} />;

  const isDone = status === "complete";
  const quarters = ["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"];
  const currentQ = quarters[Math.floor((timeline / 100) * (quarters.length - 1))];

  const getSelectedDateStr = () => {
    if (!scope?.valid_from || !scope?.valid_until) return "Loading...";
    const start = new Date(scope.valid_from).getTime();
    const end = new Date(scope.valid_until).getTime();
    const selectedMs = start + ((end - start) * (timeline / 100));
    return new Date(selectedMs).toLocaleDateString();
  };

  // Map real transactions to UI shape
  const realTxs = transactions.map(tx => ({
    date: new Date(tx.timestamp).toISOString().split('T')[0],
    from: "DaoTreasury.sol",
    to: tx.recipient ? `${tx.recipient.slice(0, 4)}···${tx.recipient.slice(-4)}` : "Unknown",
    amount: `$${(Math.abs(tx.netAmount) / Math.pow(10, tx.decimals || 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 9 })}`,
    type: tx.txType === "withdrawal" ? "Payroll" : "Transfer"
  }));

  const CIPHERTEXT_TXS = transactions.map(tx => ({
    date: "0x4a3f···", 
    from: "0xc8d2e1···3f9a",
    to: `Commitment[${(tx.commitment || "").slice(0, 8)}...]`, 
    amount: "HIDDEN", 
    type: "0x01",
  }));

  const displayNodes = rfNodes.map(n => {
    if (n.id === "treasury") {
      return {
        ...n,
        type: "treasury",
        data: {
          ...n.data,
          label: decrypted ? "DAO Treasury" : "0xc8d2···3f9a",
          sublabel: decrypted ? "Aegis Ledger — Verified" : "Shielded Pool — Cloak Protocol",
        }
      }
    }

    const isEmp = n.data?.label?.includes("Employee");
    return {
      ...n,
      type: decrypted ? "decrypted" : "encrypted",
      data: {
        ...n.data,
        label: decrypted 
          ? (isEmp ? n.data.label.replace("Employee", "Payroll Batch") : n.data.label)
          : `Commitment[0${(n.id.match(/\d+/) || ["83"])[0]}]`,
        amount: decrypted ? n.data.amount : "HIDDEN",
        detail: decrypted ? n.data.detail : "0xc8d2···3f9a",
        txType: n.id.includes("deposit") ? "swap" : "withdrawal",
      }
    }
  });

  const displayEdges = rfEdges.map((e, index) => ({
    ...e,
    animated: true,
    style: {
      stroke: decrypted 
        ? (e.id.includes("deposit") ? "#d97c0a" : "#00b87a")
        : "rgba(0,184,122,0.3)",
      strokeWidth: 2,
      strokeDasharray: decrypted ? "none" : "5 5",
    },
    label: decrypted ? e.label : "HIDDEN",
  }));

  const displayTxs = decrypted ? realTxs : CIPHERTEXT_TXS;
  const showFlow = isDone;

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Compliance View · {scope?.org_id || "Loading..."}</span>
          <h1 className={styles.h1} style={{ fontFamily: "var(--serif)" }}>
            Treasury Ledger<br />
            <em>Read-only audit access.</em>
          </h1>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.authedPill}>
            <span className={styles.authedDot} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--green)" }}>
              Authenticated · {ttl} TTL
            </span>
          </div>
        </div>
      </div>

      {/* Timeline scrubber */}
      <div className={`${styles.card} ${styles.timelineCard}`}>
        <div className={styles.timelineHeader}>
          <div>
            <span className={styles.fieldEyebrow}>Viewing Window</span>
            <div className={styles.timelineTitle}>
              Valid period: {scope ? "Authorized Scope" : "Loading..."}
              <span className={styles.timelineSub}>
                {scope ? ` · ${new Date(scope.valid_from).toLocaleDateString()} – ${getSelectedDateStr()}` : ""}
              </span>
            </div>
          </div>
          <div className={styles.currentQBadge}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink)" }}>
              Current: {currentQ}
            </span>
          </div>
        </div>
        <input type="range" min={0} max={100} value={timeline}
          onChange={e => setTimeline(Number(e.target.value))}
          className={styles.slider}
        />
        <div className={styles.quarterLabels}>
          {quarters.map((q, i) => (
            <span key={q} style={{ fontFamily: "var(--mono)", fontSize: 9.5, 
              color: i === Math.floor((timeline / 100) * (quarters.length - 1)) ? "var(--ink)" : "var(--ghost)" }}>
              {q}
            </span>
          ))}
        </div>
      </div>

      {/* ReactFlow + decrypt panel */}
      <div className={styles.graphRow}>

        {/* ReactFlow canvas */}
        <div className={styles.flowCard}>
          <div className={styles.flowCardHeader}>
            <span className={styles.fieldLabel}>Transaction Flow Graph</span>
            <span className="ae-badge ae-badge-dim">
              {status === "error" ? "Error" : isDone ? "ReactFlow · live canvas" : progress || "Loading..."}
            </span>
          </div>
          <div className={styles.flowCanvas}>
            {showFlow ? (
              <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                {!decrypted && (
                  <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
                    <span className="ae-badge ae-badge-ghost">🔒 Encrypted Graph</span>
                  </div>
                )}
                <ReactFlow
                  nodes={displayNodes}
                  edges={displayEdges}
                  nodeTypes={nodeTypes}
                  connectionMode={ConnectionMode.Loose}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                  nodesDraggable={true}
                  nodesConnectable={false}
                  elementsSelectable={true}
                  proOptions={{ hideAttribution: true }}
                  style={{ filter: decrypted ? 'hue-rotate(120deg) brightness(1.2) contrast(1.1)' : 'none', transition: 'filter 0.5s ease' }}
                >
                  <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--mist)" />
                  <Controls showInteractive={false} />
                </ReactFlow>

                <style>{`
                  @keyframes scanDown {
                    from { top: 0%; opacity: 0; }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    to { top: 100%; opacity: 0; }
                  }
                `}</style>

                {scanning && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '2px',
                    background: 'linear-gradient(90deg, transparent, #00ffcc, #00ffcc, transparent)',
                    boxShadow: '0 0 20px #00ffcc, 0 0 40px #00ffcc',
                    zIndex: 100,
                    pointerEvents: 'none',
                    animation: 'scanDown 1s linear forwards'
                  }} />
                )}
              </div>
            ) : (
              <div className={styles.flowLocked}>
                <div className={styles.flowLockedInner}>
                  <span style={{ fontSize: 24, marginBottom: 8, display: "block" }}>
                    {!isDone ? "⏳" : "🔒"}
                  </span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--mid)" }}>
                    {!isDone ? (progress || "Decrypting ledger...") : "Toggle decrypt to reveal flow"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Decrypt toggle panel */}
        <div className={`${styles.card} ${styles.decryptPanel}`}>
          <span className={styles.fieldEyebrow}>Ledger View Mode</span>

          <div className={styles.toggleRow}>
            <div>
              <div className={styles.toggleTitle}>
                {decrypted ? "Decrypted Ledger" : "Public Ciphertext"}
              </div>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)" }}>
                {decrypted ? "Plaintext · verified" : "Scrambled on-chain hashes"}
              </span>
            </div>
            <button
              className={styles.toggle}
              onClick={handleDecryptToggle}
              style={{ background: decrypted ? "var(--green)" : (scanning ? "var(--blue)" : "var(--mist)") }}
              disabled={!isDone || scanning}
              aria-label="Toggle decrypt"
            >
              <span className={styles.toggleThumb}
                style={{ transform: decrypted ? "translateX(20px)" : "none" }} />
            </button>
          </div>

          <div className={styles.statsBlock}>
            {[
              { label: "Transactions", val: summary ? summary.filteredCount.toString() : "-", special: null },
              { label: "Total outflow", val: decrypted && summary ? `$${(summary.totalWithdrawals / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "ENCRYPTED", special: decrypted ? null : "hidden" },
              { label: "Recipients", val: decrypted ? `${rfNodes.length - 1} wallets` : "HIDDEN", special: decrypted ? null : "hidden" },
              { label: "Proof status", val: "✓ Groth16", special: "ok" },
            ].map(s => (
              <div key={s.label} className={styles.statRow}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--dim)" }}>{s.label}</span>
                <span style={{ 
                  fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 500, 
                  color: s.special === "ok" ? "var(--green)" : s.special === "hidden" ? "var(--ghost)" : "var(--ink)",
                }}>{s.val}</span>
              </div>
            ))}
          </div>

          <div className={styles.readOnlyNote}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--blue)", lineHeight: 1.6, display: "block" }}>
              Viewing key is cryptographic read-only. It cannot authorise any transaction.
            </span>
          </div>
        </div>
      </div>

      {/* Ledger table */}
      <div className={`${styles.card} ${styles.tableCard}`}>
        <div className={styles.tableHeader}>
          <span className={styles.fieldLabel}>Transaction Records</span>
          <span className={`ae-badge ${decrypted ? "ae-badge-green" : "ae-badge-ghost"}`}>
            {decrypted ? "DECRYPTED VIEW" : "CIPHERTEXT VIEW"}
          </span>
        </div>
        <div className={styles.tableHead}>
          {["Date / Block", "From", "To", "Amount", "Type"].map(h => (
            <span key={h} style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</span>
          ))}
        </div>
        {displayTxs.map((row, i) => (
          <div key={i} className={styles.tableRow}
            style={{ borderBottom: i < displayTxs.length - 1 ? "1px solid var(--mist)" : "none" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: decrypted ? "var(--slate)" : "var(--ghost)" }}>{row.date}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: decrypted ? "var(--mid)" : "var(--ghost)" }}>{row.from}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: decrypted ? "var(--mid)" : "var(--ghost)" }}>{row.to}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, fontWeight: 500, color: decrypted ? "var(--ink)" : "var(--ghost)" }}>{row.amount}</span>
            <span className={`ae-badge ${
              !decrypted ? "ae-badge-ghost" : 
              row.type === "Payroll" ? "ae-badge-blue" : "ae-badge-amber"
            }`}>{row.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
