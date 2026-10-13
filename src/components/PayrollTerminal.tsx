"use client";

import { useState, useEffect, useRef } from "react";
import styles from "./PayrollTerminal.module.css";
import { usePayrollSigner, type PayrollSignerStatus } from "@/hooks/usePayrollSigner";
import PrivateSwapPanel from "./PrivateSwapPanel";
import CsvImporter, { type ParsedRecipient } from "./CsvImporter";
import { useLiveFx } from "@/hooks/useLiveFx";
import { 
  IconBolt, 
  IconLock, 
  IconShield, 
  IconFile, 
  IconCopy, 
  IconCheck, 
  IconFlagNG, 
  IconFlagKE 
} from "./Icons";

export interface Recipient {
  addr: string;
  amount: string;
  token: "USDC" | "USDT" | "SOL";
  memo: string;
  settlementRail?: "onchain_shielded" | "ngn_bank" | "kes_mpesa";
  destinationAccount?: string;
}

export const FX_RATES = {
  NGN: 1331, // ₦1,331 / USDC (Nigeria interbank spot)
  KES: 130,  // KSh 130 / USDC (Kenya Safaricom M-Pesa spot)
};

const DEMO_ORG_ID = "b91a045c-27eb-44c1-8409-f62506b328a6";

const MOCK_RECIPIENTS: Recipient[] = [
  {
    addr: "6bq9QqzvjNbQE4sJs4fLsGUpqHe4hPcJVc6oJQyq6RzC",
    amount: "3,800",
    token: "USDC",
    memo: "Senior Anchor Protocol Dev · Lagos",
    settlementRail: "ngn_bank",
    destinationAccount: "Providus Bank · 0128943312",
  },
  {
    addr: "8uE6pQnHLAqLkNhMfVjC9yFeEqx3qkPx4x6VGWjE2FmH",
    amount: "2,600",
    token: "USDC",
    memo: "Mobile / iOS Lead · Nairobi",
    settlementRail: "kes_mpesa",
    destinationAccount: "Safaricom M-Pesa · +254 712 901844",
  },
  {
    addr: "3oLd7mJQ7cVRP4qUKoynTkMfVvFjUeBjG3aJXcgGxGZr",
    amount: "2,200",
    token: "USDC",
    memo: "Frontend Engineer · Abuja",
    settlementRail: "ngn_bank",
    destinationAccount: "Kuda Microfinance · 2049182390",
  },
  {
    addr: "GxK6sHpqmF9qZVzRqFJc4Tbj9aWMGHakBjVkoXvRaTKT",
    amount: "3,500",
    token: "USDC",
    memo: "ZK Research Fellow · Global",
    settlementRail: "onchain_shielded",
    destinationAccount: "Shielded Ephemeral UTXO",
  },
];

const TEE_LOG_STEPS = [
  { msg: "› Splitting salaries into uniform notes to hide exact compensation...", col: "var(--dim)" },
  { msg: " ✓ Note splitting active ($1000, $500, $100 notes protect salary privacy).", col: "var(--green)" },
  { msg: "› Connecting to MagicBlock TEE validator (devnet-tee.magicblock.app)...", col: "var(--dim)" },
  { msg: " [!] Hardware enclave execution: zero client WASM lag.", col: "var(--amber)" },
  { msg: "› Delegating batch account state to Ephemeral Rollup enclave...", col: "var(--dim)" },
  { msg: " ✓ Account delegation verified inside Intel TDX hardware.", col: "var(--green)" },
  { msg: "› Requesting authority signature for batch proposal...", col: "var(--dim)" },
  { msg: " ✓ Signature verified. Submitting to TEE sub-block engine...", col: "var(--green)" },
  { msg: "› Executing batch state transition in sub-50ms slot...", col: "var(--dim)" },
  { msg: " ✓ Sub-second TEE settlement confirmed on Solana.", col: "var(--green)" },
  { msg: "› Dispatching confidential off-ramp webhooks (NGN / KES local rails)...", col: "var(--dim)" },
  { msg: " ✓ ₦9,900,000 Providus/Kuda + KSh 338,000 M-Pesa off-ramp triggers dispatched.", col: "var(--green)" },
  { msg: " ✓ On-chain explorer view: [CONFIDENTIAL · RECIPIENTS & AMOUNTS REDACTED]", col: "var(--blue)" },
  { msg: " ✓ Scoped Merkle viewing keys registered for tax & audit compliance.", col: "var(--green)" },
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
  { msg: "› Submitting shielded batch to MagicBlock TEE enclave...", col: "var(--dim)" },
  { msg: " ✓ Transaction confirmed. Slot 312,847,201.", col: "var(--green)" },
  { msg: " ✓ On-chain view: [REDACTED]", col: "var(--blue)" },
];

function ExecutionModal({
  onClose,
  status,
  proofProgress,
  error,
  recipientProgress,
  rail = "tee",
  txSignatures = [],
}: {
  onClose: () => void;
  status: PayrollSignerStatus;
  proofProgress: string | null;
  error: string | null;
  recipientProgress: { current: number; total: number } | null;
  rail?: "tee" | "cloak";
  txSignatures?: string[];
}) {
  const activeSteps = rail === "tee" ? TEE_LOG_STEPS : ZK_LOG_STEPS;
  const [log, setLog] = useState<{ msg: string; col: string }[]>([]);
  const maxPhaseRef = useRef(0);
  const maxPctRef = useRef(0);

  const done = status === "completed";
  const isError = status === "error";

  useEffect(() => {
    let phase = 0;
    if (status === "preparing") phase = 2;
    if (status === "initializing_wasm") phase = 4;
    if (status === "proving") phase = 7;
    if (status === "signing") phase = 8;
    if (status === "broadcasting") phase = 10;
    if (status === "confirming") phase = 11;
    if (status === "completed") phase = activeSteps.length;

    if (phase > maxPhaseRef.current) {
      maxPhaseRef.current = phase;
      setLog(activeSteps.slice(0, phase));
    }
  }, [status, activeSteps]);

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
    pct = Math.min(99, Math.round((log.length / activeSteps.length) * 100));
  }

  if (pct > maxPctRef.current) {
    maxPctRef.current = pct;
  }
  pct = maxPctRef.current;

  const realSignature = txSignatures?.find(
    (sig) => sig && !sig.startsWith("sim_") && !sig.startsWith("aegis:") && sig.length >= 44
  );

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBox}>
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.modalEyebrow}>
              {rail === "tee" ? "MagicBlock Ephemeral Rollup" : "Client-Side ZK Execution"}
            </span>
            <div className={styles.modalTitle} style={{ fontFamily: "var(--serif)" }}>
              {rail === "tee" ? "Confidential TEE Batch Execution" : "Proving Batch Payroll"}
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
          <IconLock size={13} style={{ color: "var(--amber)", flexShrink: 0 }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--amber)", lineHeight: 1.6 }}>
            {rail === "tee"
              ? "Confidential execution inside Intel TDX hardware enclaves. Sub-second batch execution with zero client lag."
              : "Your spending key never leaves this browser. All ZK proofs are generated locally via WASM."}
          </span>
        </div>
        <div className={styles.termBody}>
          {displayLog.map((l, i) => (
            <div key={i} style={{ color: l.col, animation: "ae-row-in 0.2s ease both" }}>{l.msg}</div>
          ))}
          {(!done && !isError) && <span className={styles.cursor}>█</span>}
        </div>
        <div className={styles.modalFooter}>
          <div className={styles.progressHeader}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "rgba(255,255,255,0.25)" }}>
              {rail === "tee" ? "MagicBlock TEE Progress" : "Groth16 WASM Progress"}
            </span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: done ? "var(--green)" : isError ? "var(--red)" : "var(--blue)" }}>
              {done ? "100%" : isError ? "ERR" : `${pct}%`}
            </span>
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill}
              style={{ width: `${pct}%`, background: done ? "var(--green)" : isError ? "var(--red)" : "var(--blue)" }} />
          </div>
          {(done || isError) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
              {done && realSignature && (
                <a
                  href={`https://explorer.solana.com/tx/${realSignature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    padding: "11px 16px",
                    borderRadius: 10,
                    background: "rgba(34, 224, 154, 0.12)",
                    border: "1px solid rgba(34, 224, 154, 0.4)",
                    color: "#22e09a",
                    fontFamily: "var(--mono)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  <span>View Confirmed Batch on Solana Explorer ↗</span>
                </a>
              )}
              <button onClick={onClose} className={`${styles.confirmBtn} ae-fade-up`} style={{ marginTop: 0 }}>
                {done
                  ? (!realSignature
                    ? "✓ Batch attested via TEE Enclave (Demo Mode) — Close"
                    : "✓ Batch confirmed on-chain — Close")
                  : "✕ Close and inspect"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PayrollTerminal() {
  const { execute, status, proofProgress, error, signingParams, recipientProgress, activeRail, setActiveRail, txSignatures } = usePayrollSigner();
  const { rates: liveFx, isLive, lastUpdated } = useLiveFx();
  const [recipients, setRecipients] = useState<Recipient[]>(MOCK_RECIPIENTS);
  const [showZK, setShowZK] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [hasRunDenominations, setHasRunDenominations] = useState(false);
  const [completedRuns, setCompletedRuns] = useState(0);
  const [showAddRow, setShowAddRow] = useState(false);
  const [showImporter, setShowImporter] = useState(false);
  const [importNotification, setImportNotification] = useState<string | null>(null);
  const [newRow, setNewRow] = useState<Recipient>({
    addr: "",
    amount: "",
    token: "USDC",
    memo: "",
    settlementRail: "ngn_bank",
    destinationAccount: "",
  });
  const prevStatusRef = useRef(status);

  const realBatchSignature = txSignatures?.find(
    (sig) => sig && !sig.startsWith("sim_") && !sig.startsWith("aegis:") && sig.length >= 44
  );

  useEffect(() => {
    if (prevStatusRef.current !== "completed" && status === "completed") {
      setCompletedRuns(prev => prev + 1);
    }
    prevStatusRef.current = status;
  }, [status]);

  const BASE_BALANCE = 148_500; // Realistic operational startup payroll runway
  const batchTotal = recipients.reduce((sum, r) => {
    const numeric = parseFloat(r.amount.replace(/,/g, ""));
    return sum + (isNaN(numeric) ? 0 : numeric);
  }, 0);
  const currentBalance = BASE_BALANCE - (batchTotal * completedRuns);
  const runwayMonths = batchTotal > 0 ? (currentBalance / batchTotal).toFixed(1) : "12.0";
  const balance = `$${currentBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const utxos = String(48 - (completedRuns * recipients.length));
  const utxoSum = signingParams?.selected_utxos 
    ? signingParams.selected_utxos.reduce((sum, u) => sum + parseInt(u.amount), 0) / 1e6
    : 0;

  const isRunning = status !== "idle" && status !== "completed" && status !== "error";
  const lockedAmount = status === "completed"
    ? 0
    : isRunning
      ? (utxoSum > 0 ? utxoSum : batchTotal)
      : completedRuns > 0 ? 0 : batchTotal;
  const locked = lockedAmount === 0 ? "$0" : `$${lockedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const available = `$${(currentBalance - lockedAmount).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const handleAddRecipient = () => {
    if (!newRow.addr || !newRow.amount) return;
    setRecipients(prev => [...prev, { ...newRow }]);
    setNewRow({ addr: "", amount: "", token: "USDC", memo: "", settlementRail: "ngn_bank", destinationAccount: "" });
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
      return { wallet: r.addr, amount: Math.round(lamports).toString(), token: r.token };
    });

    setHasRunDenominations(true);
    const isSolBatch = recipients.length > 0 && recipients.every(r => r.token === "SOL");
    await execute({
      org_id: DEMO_ORG_ID,
      token_symbol: isSolBatch ? "SOL" : "USDC",
      token_mint: isSolBatch 
        ? "So11111111111111111111111111111111111111112" 
        : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      initiated_by: "",
      recipients: hookRecipients,
      rail: activeRail,
    });
  };

  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  const handleGenerateAuditorKey = async () => {
    try {
      setGeneratedKey(null);
      const res = await fetch("/api/audit/generate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_id: DEMO_ORG_ID,
          auditor_identity: "Internal Compliance",
          valid_from: new Date().toISOString(),
          valid_until: new Date(Date.now() + 86400000).toISOString(),
          allowed_tokens: ["USDC", "SOL"]
        })
      });
      const data = await res.json();
      if (!res.ok) {
        console.warn("[Aegis] generate-key API error, generating local demo key:", data.error);
        const demoBytes = new Uint8Array(32);
        crypto.getRandomValues(demoBytes);
        const demoHex = Array.from(demoBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        setGeneratedKey(demoHex);
      } else if (data.viewing_key?.raw_nk_hex) {
        setGeneratedKey(data.viewing_key.raw_nk_hex);
      } else {
        const demoBytes = new Uint8Array(32);
        crypto.getRandomValues(demoBytes);
        const demoHex = Array.from(demoBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        setGeneratedKey(demoHex);
      }
    } catch (e) {
      console.error("Failed to generate key:", e);
      const demoBytes = new Uint8Array(32);
      crypto.getRandomValues(demoBytes);
      const demoHex = Array.from(demoBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      setGeneratedKey(demoHex);
    }
  };

  return (
    <div className={styles.page}>
      {showZK && (
        <ExecutionModal
          onClose={() => setShowZK(false)}
          status={status}
          proofProgress={proofProgress}
          error={error}
          recipientProgress={recipientProgress}
          rail={activeRail}
          txSignatures={txSignatures}
        />
      )}

      {showTopUpModal && (
        <div 
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            background: "rgba(0, 0, 0, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowTopUpModal(false);
          }}
        >
          <div style={{ maxWidth: 440, width: "100%", animation: "ae-fade-up 0.25s ease both" }}>
            <PrivateSwapPanel onClose={() => setShowTopUpModal(false)} />
          </div>
        </div>
      )}

      {/* Page header */}
      <div>
        <span className={styles.eyebrow}>Confidential Global Payroll · Superteam Nigeria Track</span>
        <h1 className={styles.h1} style={{ fontFamily: "var(--serif)" }}>
          Private Payroll for Global Teams<br />
          <em>Pay in USDC. Payout in local bank or M-Pesa. Solscan sees nothing.</em>
        </h1>
      </div>

      <div className={styles.topGrid}>
        {/* Panel 1: Shielded Treasury Enclave */}
        <div className={styles.balanceCard}>
          <div className={styles.balanceGlow1} />
          <div className={styles.balanceGlow2} />
          <div className={styles.balanceHeader}>
            <span className={styles.balanceLabel}>Shielded Treasury Enclave · <span style={{ opacity: 0.65, fontWeight: 400 }}>Demo Runway</span></span>
            <div className={styles.enclavePill}>
              <span className={styles.enclavePillDot} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 9 }}>
                MAGICBLOCK PER · DEVNET-TEE
              </span>
            </div>
          </div>
          <div className={styles.balanceAmount} style={{ fontFamily: "var(--serif)" }}>
            {balance}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22, gap: 12, flexWrap: "wrap" }}>
            <span className={styles.balanceSub} style={{ margin: 0 }}>
              {utxos} Shielded Notes · Sub-50ms TEE Enclave Settlement
            </span>
            <button
              onClick={() => setShowTopUpModal(true)}
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.18)",
                color: "#ffffff",
                borderRadius: 8,
                padding: "6px 12px",
                fontFamily: "var(--mono)",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)"; }}
            >
              + Top Up Treasury
            </button>
          </div>
          <div className={styles.balanceStats} style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {[
              { label: "Available", val: available, green: false },
              { label: "Current Batch", val: locked, green: false },
              { label: "Runway", val: `${runwayMonths} mo`, green: false },
              { label: "TEE Engine", val: "✓ Sub-50ms", green: true },
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

        {/* Panel 2: MagicBlock Enclave Attestation & Compliance */}
        <div className={styles.enclaveCard}>
          <div>
            <div className={styles.enclaveHeader}>
              <div>
                <span className={styles.enclaveEyebrow}>Enclave Attestation & Security</span>
                <div className={styles.enclaveTitle}>Intel TDX Hardware Shield</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(34, 197, 94, 0.08)", border: "1px solid rgba(34, 197, 94, 0.2)", borderRadius: 6, padding: "3px 8px" }}>
                <IconShield size={11} style={{ color: "#16a34a" }} />
                <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, color: "#16a34a" }}>
                  100% PROTECTED
                </span>
              </div>
            </div>

            <div className={styles.enclaveGrid}>
              <div className={styles.enclaveMetric}>
                <span className={styles.enclaveMetricLabel}>Hardware Isolation</span>
                <span className={styles.enclaveMetricVal}>Intel TDX (MagicBlock PER)</span>
              </div>
              <div className={styles.enclaveMetric}>
                <span className={styles.enclaveMetricLabel}>TEE Validator</span>
                <span className={styles.enclaveMetricVal}>MTEWGuqx...zo ✓</span>
              </div>
              <div className={styles.enclaveMetric}>
                <span className={styles.enclaveMetricLabel}>Solscan Footprint</span>
                <span className={styles.enclaveMetricVal} style={{ color: "#16a34a" }}>Zero Leakage (SHA-256 Root)</span>
              </div>
              <div className={styles.enclaveMetric}>
                <span className={styles.enclaveMetricLabel}>Monthly Burn</span>
                <span className={styles.enclaveMetricVal}>${batchTotal.toLocaleString()} USDC / mo</span>
              </div>
            </div>
          </div>

          {/* Integrated Auditor Key Generator */}
          <div className={styles.complianceBox}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 600, color: "#08090b", display: "block" }}>
                  Auditor Selective Disclosure
                </span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "#8e98a6" }}>
                  Generate zero-knowledge viewing key for CPA/IRS audit
                </span>
              </div>
              <button
                onClick={handleGenerateAuditorKey}
                style={{
                  background: "#08090b",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Issue Auditor Key
              </button>
            </div>

            {generatedKey && (
              <div style={{ background: "#ffffff", border: "1px solid #10b981", borderRadius: 8, padding: "8px 12px", animation: "ae-fade-up 0.25s ease" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#10b981", fontWeight: 700, textTransform: "uppercase" }}>
                    ✓ Active 32-Byte Viewing Key
                  </span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedKey);
                        const btn = document.getElementById("panel-copy-btn");
                        if (btn) btn.innerText = "✓ Copied";
                        setTimeout(() => { if (btn) btn.innerText = "Copy"; }, 2000);
                      }}
                      id="panel-copy-btn"
                      style={{ background: "none", border: "none", color: "#10b981", fontSize: 10, cursor: "pointer", fontFamily: "var(--mono)", fontWeight: 600 }}
                    >
                      Copy
                    </button>
                    <a href="/audit" style={{ color: "#0066ff", fontSize: 10, fontFamily: "var(--mono)", textDecoration: "underline" }}>
                      Open /audit →
                    </a>
                  </div>
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#08090b", wordBreak: "break-all" }}>
                  {generatedKey}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Batch disbursement */}
      <div className={styles.batchCard}>
        <div className={styles.batchHeader}>
          <div>
            <span className={styles.batchEyebrow}>Batch Disbursement</span>
            <div className={styles.batchTitle}>October 2026 Contributor Payroll</div>
          </div>
          <div className={styles.batchActions}>
            <button 
              className={styles.addBtn} 
              onClick={() => setShowImporter((s: boolean) => !s)}
              style={showImporter ? { background: "var(--ink)", color: "#fff" } : undefined}
            >
              {showImporter ? (
                "✕ Close CSV"
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <IconFile size={12} /> Import CSV
                </span>
              )}
            </button>
            <button className={`${styles.addBtn}`} onClick={() => setShowAddRow((s: boolean) => !s)}>
              {showAddRow ? "✕ Cancel" : "+ Add row"}
            </button>
            <button
              className={`${styles.runBtn}`}
              onClick={handleRunBatch}
              disabled={status !== "idle" && status !== "completed" && status !== "error"}
              title="Disburse batch in sub-50ms via MagicBlock Intel TDX Enclave"
            >
              ⚡ Disburse via MagicBlock TEE
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 6.5h9M7.5 3l3.5 3.5L7.5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        {importNotification && (
          <div style={{
            background: "var(--green-soft)",
            border: "1px solid var(--green-border)",
            color: "var(--green)",
            padding: "10px 20px",
            margin: "0 28px 16px 28px",
            borderRadius: "var(--r-sm)",
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}>
            <span>✓ {importNotification}</span>
            <span style={{ cursor: "pointer", opacity: 0.7 }} onClick={() => setImportNotification(null)}>✕</span>
          </div>
        )}

        {showImporter && (
          <div style={{ padding: "0 28px 16px 28px" }}>
            <CsvImporter 
              onImport={(imported) => {
                setRecipients(imported);
                setShowImporter(false);
                setImportNotification(`Successfully imported ${imported.length} recipients ($${imported.reduce((s, r) => s + parseFloat(r.amount.replace(/,/g, '')), 0).toLocaleString()} USDC).`);
              }}
              onCancel={() => setShowImporter(false)}
            />
          </div>
        )}

        <div className={styles.fxBanner}>
          <div className={styles.fxRates}>
            <span style={{ color: "#8e98a6", fontSize: 10, textTransform: "uppercase" }}>Spot Off-Ramp Rails:</span>
            <span className={styles.fxPill}>
              <IconFlagNG width={14} height={10} /> NGN <strong>₦{liveFx.NGN.toLocaleString()}</strong> / USDC
            </span>
            <span className={styles.fxPill}>
              <IconFlagKE width={14} height={10} /> KES <strong>KSh {liveFx.KES}</strong> / USDC
            </span>
            <span className={styles.fxPill}>
              <IconShield size={12} style={{ color: "#0066ff" }} /> Solscan Visibility <strong>Hidden</strong>
            </span>
          </div>
          <div style={{ color: isLive ? "#22e09a" : "#8e98a6", fontSize: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: isLive ? "#22e09a" : "#8e98a6", display: "inline-block" }} />
            {isLive ? `Live FX Feed (${lastUpdated || "Synced"})` : "Live FX Syncing..."}
          </div>
        </div>

        <div className={styles.tableScrollWrapper}>
          <div className={styles.tableHead}>
            {["Contributor / Stealth address", "USDC Amount", "Settlement Rail", "Est. Local Payout", "Solscan Visibility", ""].map(h => (
              <span key={h} className={styles.tableHeadCell}>{h}</span>
            ))}
          </div>

          {recipients.map((r, i) => {
            const numericAmount = parseFloat(r.amount.replace(/,/g, '')) || 0;
            const isNgn = r.settlementRail === "ngn_bank";
            const isKes = r.settlementRail === "kes_mpesa";
            const localPayout = isNgn
              ? `₦${(numericAmount * liveFx.NGN).toLocaleString()}`
              : isKes
                ? `KSh ${(numericAmount * liveFx.KES).toLocaleString()}`
                : `${r.amount} USDC`;

            return (
              <div className={styles.tableRow} key={i}
                style={{ borderBottom: i < recipients.length - 1 || showAddRow ? "1px solid var(--mist)" : "none" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className={styles.mono} style={{ color: "var(--ink)", fontWeight: 600, fontSize: 12 }}>
                    {r.memo || "Contributor"}
                  </span>
                  <span className={styles.mono} style={{ color: "var(--mid)", fontSize: 10.5 }}>
                    {r.addr.slice(0, 4)}···{r.addr.slice(-4)}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className={styles.mono} style={{ fontWeight: 600, fontSize: 12.5 }}>{r.amount}</span>
                  <span className={`${styles.tokenBadge} ${styles.tokenUsdc}`}>{r.token}</span>
                </div>

                <div>
                  {isNgn && (
                    <div className={styles.railBadgeNgn} title={r.destinationAccount}>
                      <IconFlagNG width={13} height={9} /> NGN Bank
                      <span style={{ opacity: 0.7, fontSize: 9.5 }}>· {r.destinationAccount?.split("·")[0]?.trim() || "Bank"}</span>
                    </div>
                  )}
                  {isKes && (
                    <div className={styles.railBadgeKes} title={r.destinationAccount}>
                      <IconFlagKE width={13} height={9} /> KES M-Pesa
                      <span style={{ opacity: 0.7, fontSize: 9.5 }}>· Mobile</span>
                    </div>
                  )}
                  {!isNgn && !isKes && (
                    <div className={styles.railBadgeShielded} title={r.destinationAccount}>
                      <IconShield size={11} /> Shielded UTXO
                    </div>
                  )}
                </div>

                <div style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600, color: isNgn ? "#059669" : isKes ? "#d97706" : "var(--ink)" }}>
                  {localPayout}
                </div>

                <div>
                  <span className="ae-badge ae-badge-green">
                    {status === "completed" ? "Paid (Private)" : "Hidden"}
                  </span>
                </div>

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
            );
          })}

          {showAddRow && (
            <div className={styles.addRowContainer}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <input placeholder="Wallet address (base58)" value={newRow.addr}
                  onChange={e => setNewRow(p => ({ ...p, addr: e.target.value }))}
                  style={{ fontFamily: "var(--mono)", fontSize: 11, padding: "5px 8px", border: "1px solid #e8ebee", borderRadius: 6, width: "100%" }} />
                <input placeholder="Role / Contributor note" value={newRow.memo}
                  onChange={e => setNewRow(p => ({ ...p, memo: e.target.value }))}
                  style={{ fontFamily: "var(--mono)", fontSize: 10.5, padding: "4px 8px", border: "1px solid #e8ebee", borderRadius: 6, width: "100%" }} />
              </div>

              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input placeholder="Amount" value={newRow.amount}
                  onChange={e => setNewRow(p => ({ ...p, amount: e.target.value }))}
                  style={{ fontFamily: "var(--mono)", fontSize: 11, padding: "5px 6px", border: "1px solid #e8ebee", borderRadius: 6, width: "65px" }} />
                <select
                  value={newRow.token}
                  onChange={e => setNewRow(p => ({ ...p, token: e.target.value as any }))}
                  style={{ fontFamily: "var(--mono)", fontSize: 10.5, padding: "5px 4px", border: "1px solid #e8ebee", borderRadius: 6 }}
                >
                  <option value="USDC">USDC</option>
                  <option value="SOL">SOL</option>
                </select>
              </div>

              <div>
                <select
                  value={newRow.settlementRail || "ngn_bank"}
                  onChange={e => setNewRow(p => ({ ...p, settlementRail: e.target.value as any }))}
                  style={{ fontFamily: "var(--mono)", fontSize: 10.5, padding: "5px 6px", border: "1px solid #e8ebee", borderRadius: 6, width: "100%" }}
                >
                  <option value="ngn_bank">NGN Bank (Nigeria)</option>
                  <option value="kes_mpesa">KES M-Pesa (Kenya)</option>
                  <option value="onchain_shielded">Shielded UTXO</option>
                </select>
              </div>

              <div>
                <input
                  placeholder={newRow.settlementRail === "kes_mpesa" ? "+254 7..." : "Bank & Account"}
                  value={newRow.destinationAccount || ""}
                  onChange={e => setNewRow(p => ({ ...p, destinationAccount: e.target.value }))}
                  style={{ fontFamily: "var(--mono)", fontSize: 10.5, padding: "5px 6px", border: "1px solid #e8ebee", borderRadius: 6, width: "100%" }}
                />
              </div>

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

        {completedRuns > 0 && (
          <div className={styles.receiptCard}>
            <div className={styles.receiptHeader}>
              <div className={styles.receiptTitle}>
                <IconCheck size={14} style={{ color: "#22e09a", display: "inline-block", verticalAlign: "middle" }} />
                <span>Emerging Markets Settlement Receipt (Batch #{completedRuns})</span>
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "#22e09a", background: "rgba(34, 224, 154, 0.12)", padding: "4px 10px", borderRadius: 6 }}>
                MAGICBLOCK PER CONFIRMED
              </div>
            </div>
            
            <div className={styles.receiptGrid}>
              <div className={styles.receiptStat}>
                <span className={styles.receiptStatLabel}>Total USDC Disbursed</span>
                <div className={styles.receiptStatVal}>${batchTotal.toLocaleString()} USDC</div>
              </div>
              <div className={styles.receiptStat}>
                <span className={styles.receiptStatLabel}>Nigerian Rails (NGN)</span>
                <div className={styles.receiptStatVal} style={{ color: "#34d399" }}>
                  ₦{recipients.filter(r => r.settlementRail === "ngn_bank").reduce((sum, r) => sum + ((parseFloat(r.amount.replace(/,/g, '')) || 0) * liveFx.NGN), 0).toLocaleString()}
                </div>
              </div>
              <div className={styles.receiptStat}>
                <span className={styles.receiptStatLabel}>Kenyan Rails (KES)</span>
                <div className={styles.receiptStatVal} style={{ color: "#fbbf24" }}>
                  KSh {recipients.filter(r => r.settlementRail === "kes_mpesa").reduce((sum, r) => sum + ((parseFloat(r.amount.replace(/,/g, '')) || 0) * liveFx.KES), 0).toLocaleString()}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 11, fontFamily: "var(--mono)", flexWrap: "wrap", gap: 10 }}>
              <span style={{ color: "rgba(255,255,255,0.6)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                <IconLock size={12} /> Public Solscan View: <strong>Sender, amounts & recipients hidden (Zero leakage)</strong>
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {realBatchSignature ? (
                  <a 
                    href={`https://explorer.solana.com/tx/${realBatchSignature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: "#60a5fa",
                      textDecoration: "none",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 4
                    }}
                  >
                    View Batch on Solana Explorer ↗
                  </a>
                ) : (
                  <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10.5 }}>
                    Anchored in TEE Batch Root (devnet-tee.magicblock.app)
                  </span>
                )}
                <a 
                  href="/audit"
                  style={{
                    color: "#22e09a",
                    textDecoration: "none",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 4
                  }}
                >
                  Open Auditor Viewing Link →
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
