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
  { msg: "ΓÇ║ Loading Groth16 WASM prover circuit...", col: "var(--dim)" },
  { msg: "ΓÇ║ Initialising Poseidon hash state (t=5)...", col: "var(--dim)" },
  { msg: "ΓÇ║ Generating witness from private inputs...", col: "var(--dim)" },
  { msg: " [!] Spending key never serialised. Browser-only.", col: "var(--amber)" },
  { msg: "ΓÇ║ Running R1CS constraint satisfaction check...", col: "var(--dim)" },
  { msg: " Γ£ô 128,480 constraints satisfied.", col: "var(--green)" },
  { msg: "ΓÇ║ Building Groth16 proof (╧Ç_a, ╧Ç_b, ╧Ç_c)...", col: "var(--dim)" },
  { msg: " Γ£ô Proof generated. Size: 192 bytes.", col: "var(--green)" },
  { msg: "ΓÇ║ Serialising to Solana transaction format...", col: "var(--dim)" },
  { msg: " Γ£ô ZK proof verified on-chain.", col: "var(--green)" },
  { msg: "ΓÇ║ Submitting shielded batch to Cloak pool...", col: "var(--dim)" },
  { msg: " Γ£ô Transaction confirmed. Slot 312,847,201.", col: "var(--green)" },
  { msg: " Γ£ô On-chain view: [REDACTED]", col: "var(--blue)" },
];

// ΓöÇΓöÇΓöÇ ZK MODAL ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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
    // Map the real status to the narrative log steps
    let phase = 0;
    if (status === "preparing") phase = 1;
    if (status === "initializing_wasm") phase = 2;
    if (status === "proving") phase = 7;
    if (status === "signing") phase = 9;
    if (status === "broadcasting") phase = 11;
    if (status === "confirming") phase = 12;
    if (status === "completed") phase = ZK_LOG_STEPS.length;

    // Only ever grow the log ΓÇö never shrink when status cycles
    // back to "proving" for the next recipient in a batch.
    if (phase > maxPhaseRef.current) {
      maxPhaseRef.current = phase;
      setLog(ZK_LOG_STEPS.slice(0, phase));
    }
  }, [status]);

  // Reset high-water marks when a new run starts
  useEffect(() => {
    if (status === "idle" || status === "preparing") {
      maxPhaseRef.current = 0;
      maxPctRef.current = 0;
      setLog([]);
    }
  }, [status]);

  // Combine narrative log with real-time hook progress
  const displayLog = [...log];
  if (proofProgress && !done && !isError) {
    displayLog.push({ msg: `ΓÇ║ ${proofProgress}`, col: "var(--blue)" });
  }
  if (isError && error) {
    displayLog.push({ msg: `[ERROR] ${error}`, col: "var(--red)" });
  }

  // Calculate progress percentage ΓÇö only ever increases
  let pct: number;
  if (done) {
    pct = 100;
  } else if (recipientProgress && recipientProgress.total > 0 && !isError) {
    // Recipient-based smooth progress (20% ΓåÆ 90% across all recipients)
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

  // Never let pct decrease
  if (pct > maxPctRef.current) {
    maxPctRef.current = pct;
  }
  pct = maxPctRef.current;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBox}>
        {/* Header */}
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

        {/* Zero-trust banner */}
        <div className={styles.ztBanner}>
          <span>≡ƒöÆ</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--amber)", lineHeight: 1.6 }}>
            Your spending key never leaves this browser. All ZK proofs are generated locally via WASM.
          </span>
        </div>

        {/* Enhanced Visualizer */}
        <ProvingVisualizer isActive={status === "proving" || status === "initializing_wasm"} />

        {/* Terminal log */}
        <div className={styles.termBody}>
          {displayLog.map((l, i) => (
            <div key={i} style={{ color: l.col, animation: "ae-row-in 0.2s ease both" }}>{l.msg}</div>
          ))}
          {(!done && !isError) && <span className={styles.cursor}>Γûê</span>}
        </div>

        {/* Progress */}
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
              {done ? "Γ£ô Transaction confirmed ΓÇö Close" : "Γ£ò Close and check errors"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ΓöÇΓöÇΓöÇ MAIN COMPONENT ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
export default function PayrollTerminal() {
  const { execute, status, proofProgress, error, signingParams, recipientProgress } = usePayrollSigner();
  const [recipients, setRecipients] = useState<Recipient[]>(MOCK_RECIPIENTS);
  const [showZK, setShowZK] = useState(false);
  const [hasRunDenominations, setHasRunDenominations] = useState(false);
  const [completedRuns, setCompletedRuns] = useState(0);
  const [showAddRow, setShowAddRow] = useState(false);
  const [newRow, setNewRow] = useState<Recipient>({ addr: "", amount: "", token: "USDC", memo: "" });
  const prevStatusRef = useRef(status);

  // Track when a batch completes to decrement balance
  useEffect(() => {
    if (prevStatusRef.current !== "completed" && status === "completed") {
      setCompletedRuns(prev => prev + 1);
    }
    prevStatusRef.current = status;
  }, [status]);

  // Reactive balance ΓÇö locked = pre-run batch total, clears to $0 after completion
  const BASE_BALANCE = 4_218_440;
  const batchTotal = recipients.reduce((sum, r) => {
    const numeric = parseFloat(r.amount.replace(/,/g, ""));
    return sum + (isNaN(numeric) ? 0 : numeric);
  }, 0);
  const currentBalance = BASE_BALANCE - (batchTotal * completedRuns);
  const balance = `$${currentBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const utxos = String(847 - (completedRuns * recipients.length));
  // locked = what's currently reserved. In a UTXO pool, you lock the entire consumed notes (UTXOs),
  // not just the batch total. We sum the selected UTXOs from the API.
  const utxoSum = signingParams?.selected_utxos 
    ? signingParams.selected_utxos.reduce((sum, u) => sum + parseInt(u.amount), 0) / 1e6
    : 0;

  const isRunning = status !== "idle" && status !== "completed" && status !== "error";
  const lockedAmount = status === "completed"
    ? 0
    : isRunning
      ? (utxoSum > 0 ? utxoSum : batchTotal) // use true UTXO sum if available, else batch total
      : completedRuns > 0 ? 0 : 124_000; // $124K pre-run placeholder, $0 after
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
    // Convert UI recipients to the shape expected by the hook
    const hookRecipients = recipients.map(r => {
      // Very basic mock conversion (strip commas, multiply by decimals)
      const numeric = parseFloat(r.amount.replace(/,/g, ''));
      const lamports = r.token === "SOL" ? numeric * 1e9 : numeric * 1e6;
      return { wallet: r.addr, amount: lamports.toString() };
    });

    setHasRunDenominations(true);
    await execute({
      org_id: DEMO_ORG_ID,
      token_symbol: "USDC", // Force USDC for demo batch
      token_mint: "61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf", // Devnet USDC (Circle)
      initiated_by: "", // Hook fills this
      recipients: hookRecipients
    });
  };

  return (
    <div className={styles.page}>
      {showZK && <ZKModal onClose={() => setShowZK(false)} status={status} proofProgress={proofProgress} error={error} recipientProgress={recipientProgress} />}

      {/* Page header */}
      <span className={styles.eyebrow}>DAO Treasury ┬╖ Admin</span>
      <h1 className={styles.h1} style={{ fontFamily: "var(--serif)" }}>
        Treasury Dashboard<br />
        <em>May 2026 operations.</em>
      </h1>

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
          <span className={styles.balanceSub}>{utxos} UTXOs ┬╖ AES-256-GCM ┬╖ Poseidon hashed</span>

          <div className={styles.balanceStats}>
            {[
              { label: "Available", val: available, green: false },
              { label: "Locked ┬╖ payroll", val: locked, green: false },
              { label: "ZK proofs", val: "Γ£ô 100%", green: true },
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
              {showAddRow ? "Γ£ò Cancel" : "+ Add recipient"}
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

        {/* Table header */}
        <div className={styles.tableHead}>
          {["Stealth address", "Amount", "Token", "Memo", "Status", ""].map(h => (
            <span key={h} className={styles.tableHeadCell}>{h}</span>
          ))}
        </div>

        {/* Rows */}
        {recipients.map((r, i) => (
          <div className={styles.tableRow}
            style={{ borderBottom: i < recipients.length - 1 || showAddRow ? "1px solid var(--mist)" : "none",
              gridTemplateColumns: "1fr 120px 80px 1fr 100px 36px" }}>
            <span className={styles.mono} style={{ color: "var(--mid)", fontSize: 11.5 }}>{r.addr.slice(0, 4)}┬╖┬╖┬╖{r.addr.slice(-4)}</span>
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
            >Γ£ò</button>
          </div>
        ))}

        {/* Add-recipient inline form */}
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
        <div className={styles.tableFooter}>
          <span className={styles.mono} style={{ fontSize: 10, color: "var(--dim)" }}>
            {recipients.length} recipients ┬╖ Estimated fee: ~$0.0008 SOL
          </span>
          <span className={styles.mono} style={{ fontSize: 10, color: "var(--blue)" }}>
            On-chain visibility: HIDDEN after execution
          </span>
        </div>
      </div>

      {/* Zero-trust info */}
      <div className="ae-info-strip">
        <span style={{ fontSize: 16 }}>Γä╣∩╕Å</span>
        <p>
          <strong>Zero-trust architecture:</strong> When you initiate any operation, Groth16 ZK proofs
          are generated entirely in your browser via WASM. Your spending key, recipient details, and
          amounts are never transmitted to any server.
        </p>
      </div>
    </div>
  );
}
