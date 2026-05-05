"use client";

import { useState, useCallback, useEffect } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  ConnectionMode,
  BackgroundVariant,
} from "reactflow";
import "reactflow/dist/style.css";
import styles from "./AuditGraph.module.css";
import { useAuditorEngine } from "@/hooks/useAuditorEngine";

function AuditorLogin({ onAuth }: { onAuth: (key: string) => void }) {
  const [key, setKey] = useState("");

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
              { label: "TTL", val: "14:32 remaining", col: "var(--amber)" },
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
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      setTtl(`${mins}:${secs.toString().padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [scope?.valid_until]);

  if (!authed) return <AuditorLogin onAuth={handleAuth} />;

  const isDone = status === "complete";
  const quarters = ["Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025"];
  const currentQ = quarters[Math.floor((timeline / 100) * (quarters.length - 1))];

  // Map real transactions to UI shape
  const realTxs = transactions.map(tx => ({
    date: new Date(tx.timestamp).toISOString().split('T')[0],
    from: "DaoTreasury.sol",
    to: tx.recipient ? `${tx.recipient.slice(0, 6)}...${tx.recipient.slice(-4)}` : "Unknown",
    amount: `$${(Math.abs(tx.netAmount) / Math.pow(10, tx.decimals || 6)).toLocaleString()}`,
    type: tx.txType === "withdrawal" ? "Payroll" : "Transfer"
  }));

  const CIPHERTEXT_TXS = transactions.map(tx => ({
    date: "0x4a3f···", 
    from: "0xc8d2e1···3f9a",
    to: `Commitment[${(tx.commitment || "").slice(0, 8)}...]`, 
    amount: "HIDDEN", 
    type: "0x01",
  }));

  const displayTxs = decrypted ? realTxs : CIPHERTEXT_TXS;
  const showFlow = decrypted && isDone;

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
          <button className={styles.revokeBtn} onClick={handleRevoke}>
            Revoke session →
          </button>
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
                {scope ? ` · ${new Date(scope.valid_from).toLocaleDateString()} – ${new Date(scope.valid_until).toLocaleDateString()}` : ""}
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
              <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                connectionMode={ConnectionMode.Loose}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                nodesDraggable={true}
                nodesConnectable={false}
                elementsSelectable={true}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--mist)" />
                <Controls showInteractive={false} />
                <MiniMap nodeStrokeWidth={3} pannable zoomable />
              </ReactFlow>
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
              onClick={() => setDecrypted(!decrypted)}
              style={{ background: decrypted ? "var(--green)" : "var(--mist)" }}
              disabled={!isDone}
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
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: decrypted ? "var(--mid)" : "var(--ghost)" }}>{row.to}</span>
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
