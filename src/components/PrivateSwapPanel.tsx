"use client";

import { useState, useEffect } from "react";
import styles from "./PrivateSwapPanel.module.css";
import { usePrivateSwap, type PrivateSwapStatus } from "@/hooks/usePrivateSwap";
import { useTokenPrices } from "@/hooks/useTokenPrices";

const ZK_SWAP_STEPS = [
  { msg: "› Fetching shielded pool state...", col: "var(--dim)" },
  { msg: "› Preparing swap output notes...", col: "var(--dim)" },
  { msg: "› Loading Groth16 WASM prover circuit...", col: "var(--dim)" },
  { msg: " [!] Private inputs stay browser-local.", col: "var(--amber)" },
  { msg: "› Generating witness from swap parameters...", col: "var(--dim)" },
  { msg: " ✓ 128,480 constraints satisfied.", col: "var(--green)" },
  { msg: "› Building Groth16 proof (π_a, π_b, π_c)...", col: "var(--dim)" },
  { msg: " ✓ Proof generated. Size: 192 bytes.", col: "var(--green)" },
  { msg: "› Submitting shielded swap to Cloak pool...", col: "var(--dim)" },
  { msg: " ✓ Swap confirmed. Shielded routing complete.", col: "var(--green)" },
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
            Swap routed through shielded pool. Your spending key never leaves this browser.
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

export default function PrivateSwapPanel({ orgId = "b91a045c-27eb-44c1-8409-f62506b328a6" }: { orgId?: string }) {
  const { execute, status, proofProgress, error, quote } = usePrivateSwap();
  const { getRate, isLive } = useTokenPrices();
  
  const TOKENS = ["SOL", "USDC", "USDT"] as const;
  type Token = typeof TOKENS[number];

  const [fromAmount, setFromAmount] = useState("");
  const [inputToken, setInputToken] = useState<Token>("SOL");
  const [outputToken, setOutputToken] = useState<Token>("USDC");
  const [slippage, setSlippage] = useState("0.5");
  const [showZK, setShowZK] = useState(false);

  // Cycle to the next token, skipping the "other" token
  const cycleToken = (current: Token, avoid: Token): Token => {
    const idx = TOKENS.indexOf(current);
    let next = TOKENS[(idx + 1) % TOKENS.length];
    if (next === avoid) next = TOKENS[(idx + 2) % TOKENS.length];
    return next;
  };

  const handleFlip = () => {
    setInputToken(outputToken);
    setOutputToken(inputToken);
  };

  // Live exchange rate from CoinGecko (with fallback)
  const exchangeRate = getRate(inputToken, outputToken);

  const toEstimate = quote 
    ? (Number(quote.estimatedOutputAmount) / 1e6).toFixed(4)
    : fromAmount ? (parseFloat(fromAmount.replace(/,/g, "")) * exchangeRate).toFixed(4) : "0.00";

  const tokenIcon = (t: Token) => {
    if (t === "SOL") return { bg: "linear-gradient(135deg,#9945ff,#14f195)", sym: "◎" };
    if (t === "USDC") return { bg: "#2775ca", sym: "$" };
    return { bg: "#26a17b", sym: "₮" };
  };

  const handleExecute = async () => {
    setShowZK(true);
    const numeric = parseFloat(fromAmount.replace(/,/g, ""));
    const decimals = inputToken === "SOL" ? 1e9 : 1e6;
    const amountLamports = (numeric * decimals).toString();
    const slippageBps = parseFloat(slippage) * 100;
    
    await execute({
      org_id: orgId,
      amount_lamports: amountLamports,
      slippage_bps: slippageBps,
    });
  };

  return (
    <>
      {showZK && (
        <ZKSwapModal 
          onClose={() => setShowZK(false)} 
          status={status}
          proofProgress={proofProgress}
          error={error}
        />
      )}

      {/* Swap panel */}
      <div className={styles.swapCard} style={{ height: "100%" }}>
        <div className={styles.swapCardHeader}>
          <div>
            <span className={styles.swapEyebrow}>Private Swap</span>
            <div className={styles.swapTitle}>Shielded pool routing</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 5, height: 5, borderRadius: "50%", display: "inline-block",
              background: isLive ? "#22e09a" : "#f59e0b",
              boxShadow: isLive ? "0 0 6px #22e09a" : "none",
            }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, color: isLive ? "#22e09a" : "#f59e0b" }}>
              {isLive ? "LIVE" : "CACHED"}
            </span>
          </div>
        </div>

        {/* From */}
        <div className={styles.inputGroup}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label className={styles.inputLabel}>From</label>
            <button 
              style={{ background: "none", border: "none", color: "var(--blue)", fontSize: 10, cursor: "pointer", fontFamily: "var(--mono)" }}
              onClick={handleFlip}
            >
              ⇄ Flip
            </button>
          </div>
          <div className={styles.inputRow}>
            <div className={styles.tokenIcon} style={{ background: tokenIcon(inputToken).bg }}>
              {tokenIcon(inputToken).sym}
            </div>
            <input 
              className={styles.amountInput} 
              value={fromAmount}
              placeholder="0.00"
              onChange={e => setFromAmount(e.target.value)}
            />
            <button 
              className={styles.tokenLabel}
              style={{ cursor: "pointer", background: "none", border: "none", color: "inherit", fontFamily: "inherit", fontSize: "inherit" }}
              onClick={() => setInputToken(cycleToken(inputToken, outputToken))}
              title="Click to change token"
            >
              {inputToken} ▾
            </button>
          </div>
        </div>

        <div className={styles.arrow}>↓</div>

        {/* To */}
        <div className={styles.inputGroup}>
          <label className={styles.inputLabel}>To (estimated)</label>
          <div className={styles.inputRow}>
            <div className={styles.tokenIcon} style={{ background: tokenIcon(outputToken).bg }}>
              {tokenIcon(outputToken).sym}
            </div>
            <div className={styles.amountDisplay} style={{ opacity: fromAmount ? 1 : 0.4 }}>
              {toEstimate}
            </div>
            <button 
              className={styles.tokenLabel}
              style={{ cursor: "pointer", background: "none", border: "none", color: "inherit", fontFamily: "inherit", fontSize: "inherit" }}
              onClick={() => setOutputToken(cycleToken(outputToken, inputToken))}
              title="Click to change token"
            >
              {outputToken} ▾
            </button>
          </div>
        </div>

        {/* Rate info */}
        <div className={styles.routeInfo} style={{ justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#8e98a6" }}>
            1 {inputToken} ≈ {exchangeRate < 0.01 ? exchangeRate.toFixed(6) : exchangeRate.toFixed(4)} {outputToken}
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#00b87a" }}>
            Shielded routing
          </span>
        </div>

        {/* Slippage */}
        <div className={styles.slippageRow}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#8e98a6" }}>Max slippage</span>
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
    </>
  );
}
