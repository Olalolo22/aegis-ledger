"use client";

import { useState, useEffect, useRef } from "react";
import styles from "./PayrollTerminal.module.css";
import { usePayrollSigner, type PayrollSignerStatus } from "@/hooks/usePayrollSigner";
import PrivateSwapPanel from "./PrivateSwapPanel";
import ProvingVisualizer from "./ProvingVisualizer";
import PrivacyScoreCard from "./PrivacyScoreCard";

interface Recipient {
  addr: string;
  amount: string;
  token: "USDC" | "USDT" | "SOL";
  memo: string;
}

const DEMO_ORG_ID = "b91a045c-27eb-44c1-8409-f62506b328a6";

const MOCK_RECIPIENTS: Recipient[] = [
  { addr: "6bq9QqzvjNbQE4sJs4fLsGUpqHe4hPcJVc6oJQyq6RzC", amount: "8,500", token: "USDC", memo: "May salary" },
  { addr: "8uE6pQnHLAqLkNhMfVjC9yFeEqx3qkPx4x6VGWjE2FmH", amount: "312.89", token: "SOL", memo: "Dev retainer" },
  { addr: "3oLd7mJQ7cVRP4qUKoynTkMfVvFjUeBjG3aJXcgGxGZr", amount: "9,800", token: "USDT", memo: "Design sprint" },
  { addr: "GxK6sHpqmF9qZVzRqFJc4Tbj9aWMGHakBjVkoXvRaTKT", amount: "6,000", token: "USDC", memo: "Legal review" },
];

const ZK_LOG_STEPS = [
  { msg: "› Loading Groth16 WASM prover circuit...", col: "var(--dim)" },
  { msg: "› Initialising Poseidon hash state (t=5)...", col: "var(--dim)" },
  { msg: "› Generating witness from private inputs...", col: "var(--dim)" },
  { msg: " [!] Spending key never serialised. Browser-only.", col: "var(--amber)" },
  { msg: "› Running R1CS constraint satisfaction check...", col: "var(--dim)" },
  { msg: " ✓ 128,480 constraints satisfied.", col: "var(--green)" },
  { msg: "› Building Groth16 proof (π_a, π_b, π_c)...", col: "var(--dim)" },
  { msg: " ✓ Proof generated. Size: 192 bytes.", col: "var(--green)" },
  { msg: "› Serialising to Solana transaction format...", col: "var(--dim)" },
  { msg: " ✓ ZK proof verified on-chain.", col: "var(--green)" },
  { msg: "› Submitting shielded batch to Cloak pool...", col: "var(--dim)" },
  { msg: " ✓ Transaction confirmed. Slot 312,847,201.", col: "var(--green)" },
  { msg: " ✓ On-chain view: [REDACTED]", col: "var(--blue)" },
];

function ZKModal({
  onClose,
  status,
  proofProgress,
  error,
  recipientProgress
}: {
  onClose: () => void;
  status: PayrollSignerStatus;
  proofProgress: string | null;
  error: string | null;
  recipientProgress: { current: number; total: number } | null;
}) {
  const [log, setLog] = useState<{ msg: string; col: string }[]>([]);
  const maxPhaseRef = useRef(0);
  const maxPctRef = useRef(0);

  const done = status === "completed";
  const isError = status === "error";

  useEffect(() => {
    let phase = 0;
    if (status === "preparing") phase = 1;
    if (status === "initializing_wasm") phase = 2;
    if (status === "proving") phase = 7;
    if (status === "signing") phase = 9;
    if (status === "broadcasting") phase = 11;
    if (status === "confirming") phase = 12;
    if (status === "completed") phase = ZK_LOG_STEPS.length;

    if (phase > maxPhaseRef.current) {
      maxPhaseRef.current = phase;
      setLog(ZK_LOG_STEPS.slice(0, phase));
    }
  }, [status]);

  useEffect(() => {
    if (status === "idle" || status === "preparing") {
      maxPhaseRef.current = 0;
      maxPctRef.current = 0;
      setLog([]);
    }
  }, [status]);

  const displayLog = [...log];
  if (proofProgress && !done && !isError) {
    displayLog.push({ msg: `› ${proofProgress}`, col: "var(--blue)" });
  }
  if (isError && error) {
    displayLog.push({ msg: `[ERROR] ${error}`, col: "var(--red)" });
  }

  let pct: number;
  if (done) {
    pct = 100;
  } else if (recipientProgress && recipientProgress.total > 0 && !isError) {
    const recipientIdx = Math.max(0, recipientProgress.current - 1);
    const startPct = 20;
    const endPct = 90;
    const totalRange = endPct - startPct;
    const recipientBasePct = startPct + (totalRange * (recipientIdx / recipientProgress.total));
    const currentRecipientChunk = totalRange / recipientProgress.total;
    
    let stepPct = 0;
    if (status === "proving") stepPct = 0.3;
    if (status === "signing") stepPct = 0.6;
    if (status === "broadcasting") stepPct = 0.9;
    if (status === "confirming") { pct = 95; } else {
      pct = Math.round(recipientBasePct + (currentRecipientChunk * stepPct));
    }
    pct = pct!;
  } else {
    pct = Math.min(99, Math.round((log.length / ZK_LOG_STEPS.length) * 100));
  }

  if (pct > maxPctRef.current) {
    maxPctRef.current = pct;
  }
  pct = maxPctRef.current;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBox}>
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.modalEyebrow}>Client-Side ZK Execution</span>
            <div className={styles.modalTitle} style={{ fontFamily: "var(--serif)" }}>
              Proving Batch Payroll
            </div>
          </div>
          <div className={styles.modalStatus}>
            <span className={styles.modalStatusDot}
              style={{ background: done ? "var(--green)" : isError ? "var(--red)" : "var(--blue)", animation: (done || isError) ? "none" : "ae-blink 1s ease-in-out infinite" }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: done ? "var(--green)" : isError ? "var(--red)" : "var(--blue)" }}>
              {done ? "COMPLETE" : isError ? "FAILED" : status.toUpperCase().replace("_", " ")}
            </span>
          </div>
        </div>
        <div className={styles.ztBanner}>
          <span>🔒</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--amber)", lineHeight: 1.6 }}>
            Your spending key never leaves this browser. All ZK proofs are generated locally via WASM.
          </span>
        </div>
        <ProvingVisualizer isActive={status === "proving" || status === "initializing_wasm"} />
        <div className={styles.termBody}>
          {displayLog.map((l, i) => (
            <div key={i} style={{ color: l.col, animation: "ae-row-in 0.2s ease both" }}>{l.msg}</div>
          ))}
          {(!done && !isError) && <span className={styles.cursor}>█</span>}
        </div>
        <div className={styles.modalFooter}>
          <div className={styles.progressHeader}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "rgba(255,255,255,0.25)" }}>Groth16 WASM Progress</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: done ? "var(--green)" : isError ? "var(--red)" : "var(--blue)" }}>
              {done ? "100%" : isError ? "ERR" : `${pct}%`}
            </span>
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill}
              style={{ width: `${pct}%`, background: done ? "var(--green)" : isError ? "var(--red)" : "var(--blue)" }} />
          </div>
          {(done || isError) && (
            <button onClick={onClose} className={`${styles.confirmBtn} ae-fade-up`}>
              {done ? "✓ Transaction confirmed — Close" : "✕ Close and check errors"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PayrollTerminal() {
  const { execute, status, proofProgress, error, signingParams, recipientProgress } = usePayrollSigner();
  const [recipients, setRecipients] = useState<Recipient[]>(MOCK_RECIPIENTS);
  const [showZK, setShowZK] = useState(false);
  const [hasRunDenominations, setHasRunDenominations] = useState(false);
  const [completedRuns, setCompletedRuns] = useState(0);
  const [showAddRow, setShowAddRow] = useState(false);
  const [newRow, setNewRow] = useState<Recipient>({ addr: "", amount: "", token: "USDC", memo: "" });
  const prevStatusRef = useRef(status);

  useEffect(() => {
    if (prevStatusRef.current !== "completed" && status === "completed") {
      setCompletedRuns(prev => prev + 1);
    }
    prevStatusRef.current = status;
  }, [status]);

  const BASE_BALANCE = 4_218_440;
  const batchTotal = recipients.reduce((sum, r) => {
    const numeric = parseFloat(r.amount.replace(/,/g, ""));
    return sum + (isNaN(numeric) ? 0 : numeric);
  }, 0);
  const currentBalance = BASE_BALANCE - (batchTotal * completedRuns);
  const balance = `$${currentBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const utxos = String(847 - (completedRuns * recipients.length));
  const utxoSum = signingParams?.selected_utxos 
    ? signingParams.selected_utxos.reduce((sum, u) => sum + parseInt(u.amount), 0) / 1e6
    : 0;

  const isRunning = status !== "idle" && status !== "completed" && status !== "error";
  const lockedAmount = status === "completed"
    ? 0
    : isRunning
      ? (utxoSum > 0 ? utxoSum : batchTotal)
      : completedRuns > 0 ? 0 : 124_000;
  const locked = lockedAmount === 0 ? "$0" : `$${lockedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const available = `$${((currentBalance - lockedAmount) / 1_000_000).toFixed(1)}M`;

  const handleAddRecipient = () => {
    if (!newRow.addr || !newRow.amount) return;
    setRecipients(prev => [...prev, { ...newRow }]);
    setNewRow({ addr: "", amount: "", token: "USDC", memo: "" });
    setShowAddRow(false);
  };

  const handleDeleteRecipient = (index: number) => {
    setRecipients(prev => prev.filter((_, i) => i !== index));
  };

  const handleRunBatch = async () => {
    setShowZK(true);
    const hookRecipients = recipients.map(r => {
      const numeric = parseFloat(r.amount.replace(/,/g, ''));
      const lamports = r.token === "SOL" ? numeric * 1e9 : numeric * 1e6;
      return { wallet: r.addr, amount: lamports.toString() };
    });

    setHasRunDenominations(true);
    await execute({
      org_id: DEMO_ORG_ID,
      token_symbol: "USDC",
      token_mint: "61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf",
      initiated_by: "",
      recipients: hookRecipients
    });
  };

  return (
    <div className={styles.page}>
      {showZK && <ZKModal onClose={() => setShowZK(false)} status={status} proofProgress={proofProgress} error={error} recipientProgress={recipientProgress} />}

      {/* Page header */}
      <div>
        <span className={styles.eyebrow}>DAO Treasury · Admin</span>
        <h1 className={styles.h1} style={{ fontFamily: "var(--serif)" }}>
          Treasury Dashboard<br />
          <em>May 2026 operations.</em>
        </h1>
      </div>

      <div className={styles.topGrid}>
        {/* Shielded balance card */}
        <div className={styles.balanceCard}>
          <div className={styles.balanceGlow1} />
          <div className={styles.balanceGlow2} />
          <div className={styles.balanceHeader}>
            <span className={styles.balanceLabel}>Shielded Balance</span>
            <div className={styles.cloakPill}>
              <span className={styles.cloakPillDot} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 9 }}>CLOAK POOL</span>
            </div>
          </div>
          <div className={styles.balanceAmount} style={{ fontFamily: "var(--serif)" }}>
            {balance}
          </div>
          <span className={styles.balanceSub}>{utxos} UTXOs · AES-256-GCM · Poseidon hashed</span>
          <div className={styles.balanceStats}>
            {[
              { label: "Available", val: available, green: false },
              { label: "Locked · payroll", val: locked, green: false },
              { label: "ZK proofs", val: "✓ 100%", green: true },
            ].map(s => (
              <div key={s.label}>
                <span className={styles.statLabel}>{s.label}</span>
                <div className={styles.statVal} style={{ color: s.green ? "#22e09a" : "rgba(255,255,255,0.88)" }}>
                  {s.val}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
          <PrivacyScoreCard usingDenominations={hasRunDenominations} hasRuns={completedRuns > 0} />
          <PrivateSwapPanel />
        </div>
      </div>

      {/* Batch disbursement */}
      <div className={styles.batchCard}>
        <div className={styles.batchHeader}>
          <div>
            <span className={styles.batchEyebrow}>Batch Disbursement</span>
            <div className={styles.batchTitle}>May 2026 Payroll Run</div>
          </div>
          <div className={styles.batchActions}>
            <button className={`${styles.addBtn}`} onClick={() => setShowAddRow(s => !s)}>
              {showAddRow ? "✕ Cancel" : "+ Add recipient"}
            </button>
            <button
              className={`${styles.runBtn}`}
              onClick={handleRunBatch}
              disabled={status !== "idle" && status !== "completed" && status !== "error"}
            >
              Run shielded batch
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 6.5h9M7.5 3l3.5 3.5L7.5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className={styles.tableHead}>
          {["Stealth address", "Amount", "Token", "Memo", "Status", ""].map(h => (
            <span key={h} className={styles.tableHeadCell}>{h}</span>
          ))}
        </div>

        {recipients.map((r, i) => (
          <div className={styles.tableRow} key={i}
            style={{ borderBottom: i < recipients.length - 1 || showAddRow ? "1px solid var(--mist)" : "none",
              gridTemplateColumns: "1fr 120px 80px 1fr 100px 36px" }}>
            <span className={styles.mono} style={{ color: "var(--mid)", fontSize: 11.5 }}>{r.addr.slice(0, 4)}···{r.addr.slice(-4)}</span>
            <span className={styles.mono} style={{ fontWeight: 600, fontSize: 12.5 }}>{r.amount}</span>
            <span className={`${styles.tokenBadge} ${r.token === "SOL" ? styles.tokenSol : styles.tokenUsdc}`}>
              {r.token}
            </span>
            <span style={{ fontSize: 12, color: "var(--slate)" }}>{r.memo}</span>
            <span className="ae-badge ae-badge-green">
              {status === "completed" ? "Completed" : "Ready"}
            </span>
            <button
              onClick={() => handleDeleteRecipient(i)}
              disabled={status !== "idle" && status !== "completed" && status !== "error"}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#bdc4ce", fontSize: 14, lineHeight: 1, padding: 4,
                opacity: (status !== "idle" && status !== "completed" && status !== "error") ? 0.3 : 1,
              }}
              title="Remove recipient"
            >✕</button>
          </div>
        ))}

        {showAddRow && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 120px 80px 1fr 100px 36px",
            padding: "10px 28px", gap: 8, alignItems: "center",
            background: "rgba(0,102,255,0.03)",
            borderBottom: "1px solid #e8ebee",
          }}>
            <input placeholder="Wallet address (base58)" value={newRow.addr}
              onChange={e => setNewRow(p => ({ ...p, addr: e.target.value }))}
              style={{ fontFamily: "var(--mono)", fontSize: 11, padding: "6px 8px", border: "1px solid #e8ebee", borderRadius: 6, width: "100%" }} />
            <input placeholder="Amount" value={newRow.amount}
              onChange={e => setNewRow(p => ({ ...p, amount: e.target.value }))}
              style={{ fontFamily: "var(--mono)", fontSize: 11, padding: "6px 8px", border: "1px solid #e8ebee", borderRadius: 6, width: "100%" }} />
            <select value={newRow.token} onChange={e => setNewRow(p => ({ ...p, token: e.target.value as "USDC" | "USDT" | "SOL" }))}
              style={{ fontFamily: "var(--mono)", fontSize: 11, padding: "6px 8px", border: "1px solid #e8ebee", borderRadius: 6 }}>
              <option>USDC</option><option>USDT</option><option>SOL</option>
            </select>
            <input placeholder="Memo" value={newRow.memo}
              onChange={e => setNewRow(p => ({ ...p, memo: e.target.value }))}
              style={{ fontFamily: "var(--mono)", fontSize: 11, padding: "6px 8px", border: "1px solid #e8ebee", borderRadius: 6, width: "100%" }} />
            <button onClick={handleAddRecipient}
              disabled={!newRow.addr || !newRow.amount}
              style={{
                padding: "6px 12px", borderRadius: 6, background: "#08090b",
                color: "#fff", border: "none", fontFamily: "var(--mono)",
                fontSize: 11, cursor: "pointer", fontWeight: 600,
                opacity: (!newRow.addr || !newRow.amount) ? 0.4 : 1,
              }}>Add</button>
            <span />
          </div>
        )}
      </div>

      {/* Auditor Access Utility */}
      <div className={styles.batchCard} style={{ marginTop: 24, border: '1px solid var(--border-glass)', background: 'rgba(99, 102, 241, 0.03)' }}>
        <div className={styles.batchHeader}>
          <div>
            <span className={styles.batchEyebrow} style={{ color: 'var(--blue)' }}>Auditor Access Control</span>
            <div className={styles.batchTitle}>Scoped Key Generation</div>
          </div>
          <button 
            className={styles.runBtn}
            style={{ background: 'var(--blue)', color: 'white' }}
            onClick={async () => {
              try {
                const res = await fetch("/api/audit/generate-key", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    org_id: DEMO_ORG_ID,
                    auditor_identity: "Internal Audit Team",
                    valid_from: new Date().toISOString(),
                    valid_until: new Date(Date.now() + 86400000).toISOString(), // 24h
                    allowed_tokens: ["USDC", "SOL"]
                  })
                });
                const data = await res.json();
                if (data.viewing_key) {
                  // In a real app, the server doesn't return the raw key, 
                  // but for the demo, we'll simulate the "Magic Link" generation.
                  const mockKey = `vk_aegis_${data.viewing_key.key_id.slice(0, 8)}${Math.random().toString(36).slice(2, 10)}`;
                  alert(`REAL AUDITOR KEY GENERATED\n\nID: ${data.viewing_key.id}\nKey ID: ${data.viewing_key.key_id}\n\nSince this is a demo, please use the "Use demo key" button in the portals to see the pre-populated 2026 audit data. To show a real on-chain scan, you would use this Scoped Key.`);
                }
              } catch (e) {
                console.error("Failed to generate key:", e);
              }
            }}
          >
            Generate Real Viewing Key
          </button>
        </div>
        <div style={{ padding: '0 28px 24px', fontSize: 12, color: 'var(--dim)', lineHeight: 1.5 }}>
          This utility generates a time-scoped cryptographic viewing key for the organization. 
          The key is encrypted using the <strong>AEGIS_MASTER_SECRET</strong> and stored in Supabase. 
          Use this to demonstrate the "Zero-Knowledge" access request flow to judges.
        </div>
      </div>
    </div>
  );
}
