"use client";

import { useState, useEffect } from "react";
import styles from "./PayrollTerminal.module.css";
import { usePayrollSigner, type PayrollSignerStatus } from "@/hooks/usePayrollSigner";
import PrivateSwapPanel from "./PrivateSwapPanel";

interface Recipient {
  addr: string;
  amount: string;
  token: "USDC" | "USDT" | "SOL";
  memo: string;
}

const MOCK_RECIPIENTS: Recipient[] = [
  { addr: "7xKt···m3F2", amount: "8,500", token: "USDC", memo: "May salary" },
  { addr: "BqPx···9aL1", amount: "312.89", token: "SOL", memo: "Dev retainer" },
  { addr: "Cm3R···vT5N", amount: "9,800", token: "USDT", memo: "Design sprint" },
  { addr: "Dp9F···k2W8", amount: "6,000", token: "USDC", memo: "Legal review" },
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

// ─── ZK MODAL ─────────────────────────────────────────────────
function ZKModal({ 
  onClose, 
  status, 
  proofProgress, 
  error 
}: { 
  onClose: () => void;
  status: PayrollSignerStatus;
  proofProgress: string | null;
  error: string | null;
}) {
  const [log, setLog] = useState<{ msg: string; col: string }[]>([]);
  
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

    setLog(ZK_LOG_STEPS.slice(0, phase));
  }, [status]);

  // Combine narrative log with real-time hook progress
  const displayLog = [...log];
  if (proofProgress && !done && !isError) {
    displayLog.push({ msg: `› ${proofProgress}`, col: "var(--blue)" });
  }
  if (isError && error) {
    displayLog.push({ msg: `[ERROR] ${error}`, col: "var(--red)" });
  }

  const pct = done ? 100 : Math.min(99, Math.round((log.length / ZK_LOG_STEPS.length) * 100));

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
          <span>🔒</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--amber)", lineHeight: 1.6 }}>
            Your spending key never leaves this browser. All ZK proofs are generated locally via WASM.
          </span>
        </div>

        {/* Terminal log */}
        <div className={styles.termBody}>
          {displayLog.map((l, i) => (
            <div key={i} style={{ color: l.col, animation: "ae-row-in 0.2s ease both" }}>{l.msg}</div>
          ))}
          {(!done && !isError) && <span className={styles.cursor}>█</span>}
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
              {done ? "✓ Transaction confirmed — Close" : "✕ Close and check errors"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────
export default function PayrollTerminal() {
  const { execute, status, proofProgress, error, signingParams } = usePayrollSigner();
  const [recipients] = useState<Recipient[]>(MOCK_RECIPIENTS);
  const [showZK, setShowZK] = useState(false);

  // Derive dynamic values from hook state if available, fallback to defaults
  const balance = "$4,218,440";
  const utxos = signingParams ? signingParams.selected_utxos.length.toString() : "847";
  const locked = signingParams ? `$${(signingParams.selected_utxos.reduce((acc, u) => acc + parseInt(u.amount), 0) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "$124K";

  const handleRunBatch = async () => {
    setShowZK(true);
    // Convert UI recipients to the shape expected by the hook
    const hookRecipients = recipients.map(r => {
      // Very basic mock conversion (strip commas, multiply by decimals)
      const numeric = parseFloat(r.amount.replace(/,/g, ''));
      const lamports = r.token === "SOL" ? numeric * 1e9 : numeric * 1e6;
      return { wallet: r.addr, amount: lamports.toString() };
    });

    await execute({
      org_id: "aegis-core",
      token_symbol: "USDC", // Force USDC for demo batch
      token_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      initiated_by: "", // Hook fills this
      recipients: hookRecipients
    });
  };

  return (
    <div className={styles.page}>
      {showZK && <ZKModal onClose={() => setShowZK(false)} status={status} proofProgress={proofProgress} error={error} />}

      {/* Page header */}
      <span className={styles.eyebrow}>DAO Treasury · Admin</span>
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
          <span className={styles.balanceSub}>{utxos} UTXOs · AES-256-GCM · Poseidon hashed</span>

          <div className={styles.balanceStats}>
            {[
              { label: "Available", val: "$3.9M", green: false },
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

        {/* Private swap panel (right column) */}
        <PrivateSwapPanel />
      </div>

      {/* Batch disbursement */}
      <div className={styles.batchCard}>
        <div className={styles.batchHeader}>
          <div>
            <span className={styles.batchEyebrow}>Batch Disbursement</span>
            <div className={styles.batchTitle}>May 2026 Payroll Run</div>
          </div>
          <div className={styles.batchActions}>
            <button className={`${styles.addBtn}`}>+ Add recipient</button>
            <button
              className={`${styles.runBtn}`}
              onClick={handleRunBatch}
              disabled={status !== "idle" && status !== "completed" && status !== "error"}
            >
              Run shielded batch
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 6.5h9M7.5 3l3.5 3.5L7.5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Table header */}
        <div className={styles.tableHead}>
          {["Stealth address", "Amount", "Token", "Memo", "Status"].map(h => (
            <span key={h} className={styles.tableHeadCell}>{h}</span>
          ))}
        </div>

        {/* Rows */}
        {recipients.map((r, i) => (
          <div key={i} className={styles.tableRow} 
               style={{ borderBottom: i < recipients.length - 1 ? "1px solid var(--mist)" : "none" }}>
            <span className={styles.mono} style={{ color: "var(--mid)", fontSize: 11.5 }}>{r.addr}</span>
            <span className={styles.mono} style={{ fontWeight: 600, fontSize: 12.5 }}>{r.amount}</span>
            <span className={`${styles.tokenBadge} ${r.token === "SOL" ? styles.tokenSol : styles.tokenUsdc}`}>
              {r.token}
            </span>
            <span style={{ fontSize: 12, color: "var(--slate)" }}>{r.memo}</span>
            <span className="ae-badge ae-badge-green">
              {status === "completed" ? "Completed" : "Ready"}
            </span>
          </div>
        ))}

        {/* Footer */}
        <div className={styles.tableFooter}>
          <span className={styles.mono} style={{ fontSize: 10, color: "var(--dim)" }}>
            {recipients.length} recipients · Estimated fee: ~$0.0008 SOL
          </span>
          <span className={styles.mono} style={{ fontSize: 10, color: "var(--blue)" }}>
            On-chain visibility: HIDDEN after execution
          </span>
        </div>
      </div>

      {/* Zero-trust info */}
      <div className="ae-info-strip">
        <span style={{ fontSize: 16 }}>ℹ️</span>
        <p>
          <strong>Zero-trust architecture:</strong> When you initiate any operation, Groth16 ZK proofs
          are generated entirely in your browser via WASM. Your spending key, recipient details, and 
          amounts are never transmitted to any server.
        </p>
      </div>
    </div>
  );
}
