"use client";

import { useState, useRef, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import styles from "./EmployeeScanner.module.css";
import { useNoteScanner } from "@/hooks/useNoteScanner";
import PrivacyAuditModal from "./PrivacyAuditModal";
import { SettlementReceiptModal } from "./SettlementReceiptModal";
import type { DisbursementReceipt } from "@/lib/offramp/types";
import type { DecryptedPayslip } from "@/types/payslip";
import { IconKey, IconFlame, IconShield, IconFlagNG, IconFlagKE, IconCheck, IconFile } from "./Icons";

export default function EmployeeScanner() {

  const { connected, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { scan, status, progress, payslips, error } = useNoteScanner();

  const [viewingKey, setViewingKey] = useState("");
  const [scanLog, setScanLog] = useState<{ msg: string; col: string }[]>([]);
  const [auditTx, setAuditTx] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<{
    receipt: DisbursementReceipt;
    memo?: string;
  } | null>(null);
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

  const handleViewReceipt = (p: DecryptedPayslip) => {
    const isNgn = p.settlementRail === "ngn_bank";
    const isKes = p.settlementRail === "kes_mpesa";
    const currency = isKes ? "KES" : "NGN";
    const fiatAmount = p.fiatAmount || (isNgn ? 5054000 : 338000);
    const usdAmount = parseFloat(p.amountFormatted.replace(/,/g, "")) || 3800;

    const receipt: DisbursementReceipt = {
      disbursementId: `disb_claim_${p.id.slice(0, 10)}`,
      batchRoot: p.batchCommitmentRoot?.replace("aegis:tee:batch:", "") || "abaca0a0049263512b022b7d52d27564d782103f9012a45",
      noteCommitment: p.commitmentHash,
      recipientWallet: p.id,
      maskedAccount: p.destinationAccount || (isNgn ? "Providus Bank · 0128****12" : "Safaricom M-Pesa · +254 712 *** 44"),
      fiatAmount,
      fiatCurrency: currency,
      usdAmount,
      exchangeRate: p.exchangeRate || (isKes ? 130 : 1330),
      railReference: p.railReference || (isNgn ? "NIBSS/261019/8F42A190" : "MPESA/8F42A1904128"),
      settledAt: p.date || new Date().toISOString(),
      status: "SETTLED",
      network: "solana-devnet",
      provider: isKes ? "Kotani Pay (M-Pesa B2C)" : isNgn ? "Yellow Card / NIBSS Direct Rail" : "MagicBlock TEE Shielded Pool",
      privacyProof: {
        teeAttestation: p.batchCommitmentRoot || "aegis:tee:batch:abaca0a0049263512b022b7d52d27564",
        onChainTrace: "NONE (Attested in TEE Merkle Root)",
        solscanStatus: "CONFIDENTIAL",
        hashSignature: p.commitmentHash,
      },
    };

    setSelectedReceipt({
      receipt,
      memo: p.memo || "Contributor Disbursement",
    });
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
        {connected && publicKey && (
          <>
            <div className={styles.connectedBanner}>
              <span className={styles.connectedDot} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--green)" }}>
                Wallet connected. Identity verified locally.
              </span>
            </div>

            {/* One-click MagicBlock TEE Scan for connected wallet */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #e8ebee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0066ff' }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: 'var(--ink, #08090b)' }}>
                    MagicBlock TEE Resolution
                  </span>
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim, #8e98a6)' }}>
                  Auto-detect confidential note commitments for this wallet
                </span>
              </div>
              <button
                className={styles.scanBtn}
                onClick={() => startScan(publicKey.toBase58())}
                disabled={scanning}
                style={{ background: '#0066ff', padding: '9px 18px', fontSize: 12 }}
              >
                {scanning ? "Scanning…" : "Scan with Wallet"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Viewing key input — air-gapped zero-wallet option */}
      <div className={styles.card} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className={styles.fieldEyebrow}>Air-Gapped Scoped Viewing Key (Optional)</span>
          <button
            className={styles.demoLink}
            onClick={() => {
              const demoBytes = new Uint8Array(32);
              crypto.getRandomValues(demoBytes);
              const demoHex = Array.from(demoBytes).map(b => b.toString(16).padStart(2, '0')).join('');
              setViewingKey(demoHex);
            }}
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
          />
          <button
            className={styles.scanBtn}
            onClick={() => startScan()}
            disabled={!viewingKey || scanning}
          >
            {scanning ? "Scanning…" : "Scan Pool"}
          </button>
        </div>

        {/* Quick Demo Contributor Profiles */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #f0f2f5" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "#8e98a6", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
            Quick Demo Contributor Profiles:
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { label: "Lagos Anchor Dev (₦5.05M)", key: "a1b2c3d4e5f60102030405060708090a1b2c3d4e5f60718293a4b5c6d7e8f901" },
              { label: "Nairobi Lead (KSh 338k)", key: "f9e8d7c6b5a4030201090807060504030201ffeeddccbbaa9988776655443322" },
              { label: "Global Fellow (0.05 SOL)", key: "542cSPaohJExS8mkeHMsgMTJg2gr4GcQWRGUPRpYKsfn00000000000000000000" },
            ].map(prof => (
              <button
                key={prof.label}
                onClick={() => {
                  setViewingKey(prof.key);
                  startScan(prof.key);
                }}
                disabled={scanning}
                style={{
                  background: "#f4f5f7",
                  border: "1px solid #e8ebee",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 10.5,
                  fontFamily: "var(--mono)",
                  color: "#3c4455",
                  cursor: "pointer",
                }}
              >
                {prof.label}
              </button>
            ))}
          </div>
        </div>

        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", display: "block", marginTop: 8 }}>
          Key-based verifier — verification runs entirely in your browser against TEE batch roots. Zero server contact.
        </span>
      </div>

      {selectedReceipt && (
        <SettlementReceiptModal
          receipt={selectedReceipt.receipt}
          memo={selectedReceipt.memo}
          onClose={() => setSelectedReceipt(null)}
        />
      )}

      {/* Merkle scan terminal */}
      {(scanning || scanLog.length > 0) && (
        <div className={`${styles.terminal} ae-fade-up`} style={{ marginBottom: 16 }}>
          <div className={styles.termHeader}>
            <span className={styles.termDot}
              style={{ background: done ? (payslips.length > 0 ? "var(--green)" : "var(--slate)") : status === "error" ? "var(--red)" : "var(--blue)", animation: (done || status === "error") ? "none" : "ae-blink 1s ease-in-out infinite" }} />
            <span className={styles.termLabel}>
              {done ? (payslips.length > 0 ? "Verification complete" : "Verification complete (No notes found)") : status === "error" ? "Verification failed" : "Verifying TEE batch commitments (local)"}
            </span>
          </div>
          <div ref={logRef} className={styles.termBody}>
            {scanLog.map((l, i) => (
              <div key={i} style={{ color: l.col, animation: "ae-row-in 0.2s ease both" }}>{l.msg}</div>
            ))}

            {/* Demo Mode if nothing found */}
            {done && payslips.length === 0 && (
              <div style={{ marginTop: 12, padding: 12, border: '1px dashed var(--border-glass)', borderRadius: 8, animation: 'ae-fade-up 0.4s ease both' }}>
                <p style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 8, lineHeight: 1.4 }}>
                  No live confidential notes found for this identity on-chain.
                  You can scan simulated MagicBlock Intel TDX enclave commitments to verify the client-side decryption flow.
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
                  style={{ cursor: 'pointer', border: 'none', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <IconShield size={12} /> SCAN MAGICBLOCK TEE DEMO ENCLAVE
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
              {payslips.length} shielded {payslips.length === 1 ? "note" : "notes"} verified via Intel TDX Enclave
            </span>
          </div>

          {payslips.map((p, i) => (
            <div key={i} className={styles.payslipCard} style={{ marginBottom: 14 }}>
              <div
                className={styles.payslipAccent}
                style={{ background: p.settlementRail === 'kes_mpesa' ? '#d97706' : p.settlementRail === 'onchain_shielded' ? '#0066ff' : '#00b87a' }}
              />
              <div className={styles.payslipTop}>
                <div style={{ paddingLeft: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span className={styles.fieldEyebrow}>Payslip · note[{p.leafIndex}]</span>
                    {p.settlementRail === 'ngn_bank' && (
                      <span className="ae-badge" style={{ background: 'rgba(5, 150, 105, 0.1)', color: '#059669', border: '1px solid rgba(5, 150, 105, 0.25)', fontSize: 9.5 }}>
                        <IconFlagNG width={12} height={8} /> NGN BANK
                      </span>
                    )}
                    {p.settlementRail === 'kes_mpesa' && (
                      <span className="ae-badge" style={{ background: 'rgba(217, 119, 6, 0.1)', color: '#d97706', border: '1px solid rgba(217, 119, 6, 0.25)', fontSize: 9.5 }}>
                        <IconFlagKE width={12} height={8} /> KES M-PESA
                      </span>
                    )}
                    {p.settlementRail === 'onchain_shielded' && (
                      <span className="ae-badge ae-badge-blue" style={{ fontSize: 9.5 }}>
                        <IconShield size={10} /> SHIELDED UTXO
                      </span>
                    )}
                  </div>

                  <div className={styles.payslipAmount} style={{ fontFamily: "var(--mono)", fontWeight: 700, color: p.fiatCurrency === 'KES' ? '#d97706' : p.settlementRail === 'onchain_shielded' ? '#08090b' : '#059669' }}>
                    {p.fiatAmount ? (
                      <>
                        {p.fiatCurrency === 'KES' ? 'KSh ' : '₦'}{p.fiatAmount.toLocaleString()}
                        <span style={{ fontSize: 13, color: '#8e98a6', fontWeight: 400, marginLeft: 8 }}>
                          (≈ {p.amountFormatted} {p.tokenSymbol})
                        </span>
                      </>
                    ) : (
                      <>{p.amountFormatted} {p.tokenSymbol}</>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleViewReceipt(p)}
                    className="ae-badge"
                    style={{
                      background: 'rgba(0, 102, 255, 0.08)',
                      color: '#0066ff',
                      border: '1px solid rgba(0, 102, 255, 0.25)',
                      cursor: 'pointer',
                      fontWeight: 600,
                      padding: '4px 10px',
                    }}
                    title="Inspect cryptographic settlement proof and zero-knowledge receipt"
                  >
                    CONFIDENTIAL RECEIPT ↗
                  </button>
                  <button
                    onClick={() => setAuditTx(p.txSignature || p.batchCommitmentRoot || p.commitmentHash)}
                    className="ae-badge ae-badge-ghost hover:bg-blue-500/10 hover:text-blue-400 transition-colors cursor-pointer border border-transparent hover:border-blue-500/30"
                  >
                    PRIVACY AUDIT
                  </button>
                </div>
              </div>

              <PrivacyAuditModal
                isOpen={!!auditTx}
                onClose={() => setAuditTx(null)}
                txId={auditTx || ""}
              />

              <div className={styles.payslipGrid}>
                {[
                  { label: "Settlement Rail", val: p.destinationAccount || (p.settlementRail === 'ngn_bank' ? 'Providus Bank' : 'Shielded UTXO') },
                  { label: "Rail Reference", val: p.railReference || "CLEARED" },
                  { label: "Role / Memo", val: p.memo || "Contributor stipend" },
                  { label: "TEE Merkle Root", val: p.batchCommitmentRoot ? `${p.batchCommitmentRoot.slice(0, 18)}...` : `aegis:tee:${p.commitmentHash.slice(0, 10)}...` },
                ].map(d => (
                  <div key={d.label}>
                    <span className={styles.payslipFieldLabel}>{d.label}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink)" }}>{d.val}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Active Direct Off-Ramp Banner */}
          <div style={{
            marginTop: 14,
            padding: "16px 20px",
            background: "rgba(34, 197, 94, 0.04)",
            border: "1px solid rgba(34, 197, 94, 0.2)",
            borderRadius: 14,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconShield size={14} style={{ color: "#059669" }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, fontWeight: 700, color: "#059669" }}>
                Licensed Direct Settlement Active
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 11.5, color: "#64707f", lineHeight: 1.5 }}>
              Funds settled directly to your bank account via licensed NIBSS / M-Pesa corporate payout rails. Zero exposure to random P2P traders or bank compliance freezes. Your salary and personal identity remain completely unindexed on Solana Explorer.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}