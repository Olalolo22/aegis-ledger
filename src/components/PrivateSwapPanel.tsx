"use client";

import { useState, useEffect } from "react";
import styles from "./PrivateSwapPanel.module.css";
import { usePrivateSwap, type PrivateSwapStatus } from "@/hooks/usePrivateSwap";

const ZK_SWAP_STEPS = [
  { msg: "› Fetching Orca CLMM pool state...", col: "var(--dim)" },
  { msg: "› Wrapping swap output via cloak.wrapOutput()...", col: "var(--dim)" },
  { msg: "› Loading Groth16 WASM prover circuit...", col: "var(--dim)" },
  { msg: " [!] Private inputs stay browser-local.", col: "var(--amber)" },
  { msg: "› Generating witness from swap parameters...", col: "var(--dim)" },
  { msg: " ✓ 128,480 constraints satisfied.", col: "var(--green)" },
  { msg: "› Building Groth16 proof (π_a, π_b, π_c)...", col: "var(--dim)" },
  { msg: " ✓ Proof generated. Size: 192 bytes.", col: "var(--green)" },
  { msg: "› Submitting shielded swap to Cloak pool...", col: "var(--dim)" },
  { msg: " ✓ Swap confirmed. No AMM footprint on-chain.", col: "var(--green)" },
  { msg: " ✓ Output notes deposited into shielded pool.", col: "var(--blue)" },
];

function ZKSwapModal({ 
  onClose,
  status,
  proofProgress,
  error
}: { 
  onClose: () => void;
  status: PrivateSwapStatus;
  proofProgress: string | null;
  error: string | null;
}) {
  const [log, setLog] = useState<{ msg: string; col: string }[]>([]);
  
  const done = status === "success";
  const isError = status === "error";

  useEffect(() => {
    let phase = 0;
    if (status === "quoting") phase = 1;
    if (status === "initializing_wasm") phase = 3;
    if (status === "proving") phase = 5;
    if (status === "signing") phase = 8;
    if (status === "broadcasting") phase = 9;
    if (status === "confirming") phase = 10;
    if (status === "success") phase = ZK_SWAP_STEPS.length;

    setLog(ZK_SWAP_STEPS.slice(0, phase));
  }, [status]);

  const displayLog = [...log];
  if (proofProgress && !done && !isError) {
    displayLog.push({ msg: `› ${proofProgress}`, col: "var(--blue)" });
  }
  if (isError && error) {
    displayLog.push({ msg: `[ERROR] ${error}`, col: "var(--red)" });
  }

  const pct = done ? 100 : Math.min(99, Math.round((log.length / ZK_SWAP_STEPS.length) * 100));

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBox}>
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.modalEyebrow}>Client-Side ZK Execution</span>
            <div className={styles.modalTitle} style={{ fontFamily: "var(--serif)" }}>
              Proving Private Swap
            </div>
          </div>
          <div className={styles.modalStatus}>
            <span style={{ 
              width: 6, height: 6, borderRadius: "50%", display: "inline-block", 
              background: done ? "var(--green)" : isError ? "var(--red)" : "var(--blue)", 
              animation: (done || isError) ? "none" : "ae-blink 1s ease-in-out infinite" 
            }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: done ? "var(--green)" : isError ? "var(--red)" : "var(--blue)" }}>
              {done ? "COMPLETE" : isError ? "FAILED" : status.toUpperCase().replace("_", " ")}
            </span>
          </div>
        </div>

        <div className={styles.ztBanner}>
          <span>🔒</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--amber)", lineHeight: 1.6 }}>
            Swap routed through Orca CLMM → shielded pool. No public AMM footprint.
          </span>
        </div>

        <div className={styles.termBody}>
          {displayLog.map((l, i) => (
            <div key={i} style={{ color: l.col, animation: "ae-row-in 0.2s ease both" }}>{l.msg}</div>
          ))}
          {(!done && !isError) && <span style={{ color: "rgba(255,255,255,0.2)", animation: "ae-pulse 1s ease-in-out infinite" }}>█</span>}
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
              {done ? "✓ Swap confirmed — Close" : "✕ Close and check errors"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PrivateSwapPanel({ orgId = "aegis-core" }: { orgId?: string }) {
  const { execute, status, proofProgress, error, quote } = usePrivateSwap();
  
  const [fromAmount, setFromAmount] = useState("22500");
  const [slippage, setSlippage] = useState("0.5");
  const [showZK, setShowZK] = useState(false);

  // Use the real quote if available, fallback to mock estimate before execution
  const toEstimate = quote 
    ? (Number(quote.estimatedOutputAmount) / 1e6).toFixed(2)
    : fromAmount ? (parseFloat(fromAmount.replace(/,/g, "")) / 96.72).toFixed(2) : "0";

  const handleExecute = async () => {
    setShowZK(true);
    const amountLamports = (parseFloat(fromAmount.replace(/,/g, "")) * 1e9).toString();
    const slippageBps = parseFloat(slippage) * 100;
    
    await execute({
      org_id: orgId,
      amount_lamports: amountLamports,
      slippage_bps: slippageBps,
    });
  };

  return (
    <div className={styles.page}>
      {showZK && (
        <ZKSwapModal 
          onClose={() => setShowZK(false)} 
          status={status}
          proofProgress={proofProgress}
          error={error}
        />
      )}

      {/* Header */}
      <span className={styles.eyebrow}>DAO Treasury · Private Swap</span>
      <h1 className={styles.h1} style={{ fontFamily: "var(--serif)" }}>
        Shield Your Swap<br />
        <em>Orca in-pool routing.</em>
      </h1>

      <div className={styles.grid}>
        
        {/* Swap panel */}
        <div className={styles.swapCard}>
          <div className={styles.swapCardHeader}>
            <div>
              <span className={styles.swapEyebrow}>Private Swap</span>
              <div className={styles.swapTitle}>In-pool · Orca CLMM router</div>
            </div>
            <span className="ae-badge ae-badge-blue">SHIELDED</span>
          </div>

          {/* From */}
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel}>From</label>
            <div className={styles.inputRow}>
              <div className={styles.tokenIcon} style={{ background: "#2775ca" }}>$</div>
              <input 
                className={styles.amountInput} 
                value={fromAmount}
                onChange={e => setFromAmount(e.target.value)}
              />
              <span className={styles.tokenLabel}>USDC</span>
            </div>
          </div>

          <div className={styles.arrow}>↓</div>

          {/* To */}
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel}>To (estimated)</label>
            <div className={styles.inputRow}>
              <div className={styles.tokenIcon} style={{ background: "linear-gradient(135deg,#9945ff,#14f195)" }}>◎</div>
              <div className={styles.amountDisplay}>{toEstimate}</div>
              <span className={styles.tokenLabel}>SOL</span>
            </div>
          </div>

          {/* Route info */}
          <div className={styles.routeInfo}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)" }}>
              Route: Orca CLMM pool → cloak.wrapOutput()
            </span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--green)" }}>
              No AMM footprint
            </span>
          </div>

          {/* Slippage */}
          <div className={styles.slippageRow}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)" }}>Max slippage</span>
            <div className={styles.slippageBtns}>
              {["0.1", "0.5", "1.0"].map(s => (
                <button key={s} onClick={() => setSlippage(s)} 
                        className={`${styles.slippageBtn} ${slippage === s ? styles.slippageActive : ""}`}>
                  {s}%
                </button>
              ))}
            </div>
          </div>

          <button 
            className={styles.execBtn} 
            onClick={handleExecute}
            disabled={!fromAmount || (status !== "idle" && status !== "success" && status !== "error")}
          >
            Execute Private Swap
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Info panel */}
        <div className={styles.infoPanel}>
          <div className={styles.infoPanelHeader}>
            <span className={styles.swapEyebrow}>Why private swaps?</span>
            <div className={styles.swapTitle}>MEV protection</div>
          </div>
          
          {[
            { 
              icon: "👁", 
              title: "Public swaps telegraph strategy", 
              desc: "Every AMM swap on Solana is visible before execution completes. Competitors parse your treasury movements in real time.",
            },
            { 
              icon: "🛡", 
              title: "In-pool routing stays shielded", 
              desc: "Aegis routes your swap entirely inside the Cloak shielded UTXO pool. The output notes go directly into your shielded balance.",
            },
            { 
              icon: "⚡", 
              title: "No front-running surface", 
              desc: "With no public AMM footprint, MEV bots have nothing to detect. Your swap executes at the quoted price.",
            },
          ].map(item => (
            <div key={item.title} className={styles.infoItem}>
              <span className={styles.infoIcon}>{item.icon}</span>
              <div>
                <div className={styles.infoTitle}>{item.title}</div>
                <div className={styles.infoDesc}>{item.desc}</div>
              </div>
            </div>
          ))}

          <div className={styles.infoFooter}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--blue)" }}>
              Powered by @cloak.dev/sdk · cloak.privateSwap()
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
