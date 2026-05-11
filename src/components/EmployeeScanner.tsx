"use client";

import { useState, useRef, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import styles from "./EmployeeScanner.module.css";
import { useNoteScanner } from "@/hooks/useNoteScanner";
import PrivacyAuditModal from "./PrivacyAuditModal";



export default function EmployeeScanner() {

  const { connected, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { scan, status, progress, payslips, error } = useNoteScanner();

  const [viewingKey, setViewingKey] = useState("");
  const [scanLog, setScanLog] = useState<{ msg: string; col: string }[]>([]);
  const [auditTx, setAuditTx] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const done = status === "complete";
  const scanning = status === "parsing_key" || status === "scanning";

  const handleWalletToggle = async () => {
    if (connected) {
      await disconnect();
    } else {
      setVisible(true);
    }
  };

  const startScan = async (overrideKey?: string) => {
    const keyToUse = overrideKey || viewingKey;
    if (!keyToUse || scanning) return;
    setScanLog([]);
    await scan(keyToUse);
  };

  // Append real progress messages to the log
  useEffect(() => {
    if (progress?.message) {
      let col = "var(--dim)";
      if (progress.message.includes("✓")) col = "var(--green)";
      if (progress.message.includes("MISS")) col = "var(--slate)";
      if (progress.message.includes("failed") || progress.message.includes("Error")) col = "var(--red)";
      setScanLog(prev => [...prev, { msg: `› ${progress.message}`, col }]);
    }
  }, [progress]);

  // Handle errors
  useEffect(() => {
    if (status === "error" && error) {
      setScanLog(prev => [...prev, { msg: `[ERROR] ${error}`, col: "var(--red)" }]);
    }
  }, [status, error]);

  // Auto-scroll the terminal
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [scanLog]);

  return (
    <div className={styles.page}>

      {/* Header */}
      <span className={styles.eyebrow}>Employee Portal</span>
      <h1 className={styles.h1} style={{ fontFamily: "var(--serif)" }}>
        My Payslips<br />
        <em>Verified privately.</em>
      </h1>

      {/* Wallet connect */}
      <div className={styles.card} style={{ marginBottom: 16 }}>
        <div className={styles.walletRow}>
          <div>
            <span className={styles.fieldEyebrow}>Wallet</span>
            <div className={styles.walletAddr}>
              {connected && publicKey ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}` : "Not connected"}
            </div>
          </div>
          <button
            className={`${styles.walletBtn} ${connected ? styles.walletBtnConnected : styles.walletBtnDisconnected}`}
            onClick={handleWalletToggle}
          >
            {connected ? "Disconnect" : "Connect Wallet"}
          </button>
        </div>
        {connected && (
          <div className={styles.connectedBanner}>
            <span className={styles.connectedDot} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--green)" }}>
              Wallet connected. Identity verified locally.
            </span>
          </div>
        )}
      </div>

      {/* Viewing key input */}
      <div className={`${styles.card} ${!connected ? styles.cardDisabled : ""}`}
        style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className={styles.fieldEyebrow}>Scoped Viewing Key</span>
          <button 
            className={styles.demoLink}
            onClick={() => {
              // Generate a valid 64-char hex key (real 32-byte cryptographic key)
              const demoBytes = new Uint8Array(32);
              crypto.getRandomValues(demoBytes);
              const demoHex = Array.from(demoBytes).map(b => b.toString(16).padStart(2, '0')).join('');
              setViewingKey(demoHex);
            }}
            disabled={!connected}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'var(--blue)', 
              fontSize: 10, 
              fontFamily: 'var(--mono)', 
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            Generate demo key
          </button>
        </div>
        <div className={styles.keyRow}>
          <input
            className={styles.keyInput}
            value={viewingKey}
            onChange={e => setViewingKey(e.target.value)}
            placeholder="Paste 64-char hex viewing key from Treasury"
            disabled={!connected}
          />
          <button
            className={styles.scanBtn}
            onClick={startScan}
            disabled={!viewingKey || scanning || !connected}
          >
            {scanning ? "Scanning…" : "Scan Pool"}
          </button>
        </div>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", display: "block", marginTop: 8 }}>
          Scoped key — only unlocks notes addressed to your wallet. Zero server contact.
        </span>
      </div>

      {/* Merkle scan terminal */}
      {(scanning || scanLog.length > 0) && (
        <div className={`${styles.terminal} ae-fade-up`} style={{ marginBottom: 16 }}>
          <div className={styles.termHeader}>
            <span className={styles.termDot}
              style={{ background: done ? (payslips.length > 0 ? "var(--green)" : "var(--slate)") : status === "error" ? "var(--red)" : "var(--blue)", animation: (done || status === "error") ? "none" : "ae-blink 1s ease-in-out infinite" }} />
            <span className={styles.termLabel}>
              {done ? (payslips.length > 0 ? "Scan complete" : "Scan complete (No notes found)") : status === "error" ? "Scan failed" : "Scanning Merkle tree (local)"}
            </span>
          </div>
          <div ref={logRef} className={styles.termBody}>
            {scanLog.map((l, i) => (
              <div key={i} style={{ color: l.col, animation: "ae-row-in 0.2s ease both" }}>{l.msg}</div>
            ))}
            
            {/* Suggest Demo Mode if nothing found */}
            {done && payslips.length === 0 && viewingKey !== "demo-token" && (
              <div style={{ marginTop: 12, padding: 12, border: '1px dashed var(--border-glass)', borderRadius: 8, animation: 'ae-fade-up 0.4s ease both' }}>
                <p style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 8, lineHeight: 1.4 }}>
                  No live shielded notes found for this viewing key on the relay. 
                  This is expected if no transactions have been broadcast to this organization yet.
                </p>
                <button 
                  onClick={() => {
                    const demoBytes = new Uint8Array(32);
                    crypto.getRandomValues(demoBytes);
                    const demoHex = Array.from(demoBytes).map(b => b.toString(16).padStart(2, '0')).join('');
                    setViewingKey(demoHex);
                    startScan(demoHex);
                  }}
                  className="ae-badge ae-badge-blue"
                  style={{ cursor: 'pointer', border: 'none', padding: '6px 12px' }}
                >
                  🚀 GENERATE DEMO KEY & SCAN
                </button>
              </div>
            )}

            {(!done && status !== "error") && <span style={{ color: "rgba(255,255,255,0.2)", animation: "ae-pulse 1s ease-in-out infinite" }}>█</span>}
          </div>
        </div>
      )}

      {/* Payslip cards */}
      {payslips.length > 0 && (
        <div className="ae-fade-up">
          <div className={styles.notesHeader}>
            <span className={styles.notesDot} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--green)" }}>
              {payslips.length} shielded {payslips.length === 1 ? "note" : "notes"} decrypted
            </span>
          </div>

          {payslips.map((p, i) => (
            <div key={i} className={styles.payslipCard} style={{ marginBottom: 12 }}>
              <div className={styles.payslipAccent} />
              <div className={styles.payslipTop}>
                <div style={{ paddingLeft: 14 }}>
                  <span className={styles.fieldEyebrow}>Payslip · note[{p.leafIndex}]</span>
                  <div className={styles.payslipAmount} style={{ fontFamily: "var(--serif)" }}>
                    {p.amountFormatted} {p.tokenSymbol}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    onClick={() => setAuditTx(p.txSignature || p.commitmentHash)}
                    className="ae-badge ae-badge-ghost hover:bg-blue-500/10 hover:text-blue-400 transition-colors cursor-pointer border border-transparent hover:border-blue-500/30"
                  >
                    PRIVACY AUDIT
                  </button>
                  <span className="ae-badge ae-badge-green">DECRYPTED</span>
                </div>
              </div>

              <PrivacyAuditModal
                isOpen={!!auditTx}
                onClose={() => setAuditTx(null)}
                txId={auditTx || ""}
              />
              <div className={styles.payslipGrid}>
                {[
                  { label: "Token", val: p.tokenSymbol },
                  { label: "Date", val: p.date ? p.date.split('T')[0] : "Unknown" },
                  { label: "Memo", val: p.memo || "Payroll disbursement" },
                  { label: "Tx ref", val: `cloak:${p.commitmentHash.slice(0, 10)}...` },
                ].map(d => (
                  <div key={d.label}>
                    <span className={styles.payslipFieldLabel}>{d.label}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink)" }}>{d.val}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Coming soon */}
          <div className={styles.comingSoonWrap}>
            <button disabled className={styles.comingSoonBtn}>
              <span>🔥</span>
              Anonymous Burn & Withdraw
              <span className="ae-badge ae-badge-ghost">Coming Q3 2025</span>
            </button>
            <p className={styles.comingSoonDesc}>
              Destroys your shielded note and mints SPL tokens to a fresh burner wallet —
              permanently breaking heuristic chain links between your identity and the payment.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}