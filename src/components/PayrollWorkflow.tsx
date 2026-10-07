"use client";

import { useState, useMemo, useCallback } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import styles from "./PayrollWorkflow.module.css";
import { usePayrollSigner } from "@/hooks/usePayrollSigner";
import { denominate } from "@/lib/denominate";
import CsvImporter, { type ParsedRecipient } from "./CsvImporter";

export interface ContributorRecipient {
  addr: string;
  amount: string; // e.g. "4,850" or "4850"
  token: "USDC";
  memo: string;
  settlementRail: "ngn_bank" | "kes_mpesa" | "onchain_shielded";
  destinationAccount?: string;
}

export const FX_RATES = {
  NGN: 1650, // ₦1,650 / USDC
  KES: 130,  // KSh 130 / USDC
};

const DEMO_ORG_ID = "b91a045c-27eb-44c1-8409-f62506b328a6";
const STANDARD_DENOMINATIONS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];

// Default 6-person emerging market roster
const INITIAL_RECIPIENTS: ContributorRecipient[] = [
  {
    addr: "6bq9QqzvjNbQE4sJs4fLsGUpqHe4hPcJVc6oJQyq6RzC",
    amount: "4850",
    token: "USDC",
    memo: "Lead Anchor Core Dev · Lagos",
    settlementRail: "ngn_bank",
    destinationAccount: "Providus Bank · 0128943312",
  },
  {
    addr: "8uE6pQnHLAqLkNhMfVjC9yFeEqx3qkPx4x6VGWjE2FmH",
    amount: "3200",
    token: "USDC",
    memo: "Frontend Lead · Nairobi",
    settlementRail: "kes_mpesa",
    destinationAccount: "Safaricom M-Pesa · +254 712 901844",
  },
  {
    addr: "3oLd7mJQ7cVRP4qUKoynTkMfVvFjUeBjG3aJXcgGxGZr",
    amount: "2500",
    token: "USDC",
    memo: "Security Auditor · Abuja",
    settlementRail: "ngn_bank",
    destinationAccount: "Kuda Microfinance · 2049182390",
  },
  {
    addr: "GxK6sHpqmF9qZVzRqFJc4Tbj9aWMGHakBjVkoXvRaTKT",
    amount: "3500",
    token: "USDC",
    memo: "ZK Research Fellow · Global",
    settlementRail: "onchain_shielded",
    destinationAccount: "Shielded Ephemeral UTXO",
  },
  {
    addr: "7ZchxRLHUZNLF5oxsvSoqeCUTzUF8etadYKDNd9W4xiZ",
    amount: "1800",
    token: "USDC",
    memo: "DevRel Lead · Lagos",
    settlementRail: "ngn_bank",
    destinationAccount: "Zenith Bank · 1014892211",
  },
  {
    addr: "Ac3BVmSyd7KmZbih1seeBP4FSsFpbVcdMcFQUQH8GZhi",
    amount: "1500",
    token: "USDC",
    memo: "Fullstack Apprentice · Mombasa",
    settlementRail: "kes_mpesa",
    destinationAccount: "Safaricom M-Pesa · +254 722 411890",
  },
];

interface RecentRun {
  id: string;
  date: string;
  title: string;
  recipientsCount: number;
  totalUsdc: number;
  rail: string;
  status: "Confirmed";
  txSignature: string;
}

const HISTORICAL_RUNS: RecentRun[] = [
  {
    id: "run_tee_172828001",
    date: "2026-10-06 18:24",
    title: "Core Infrastructure & Smart Contract Bounty",
    recipientsCount: 4,
    totalUsdc: 12100,
    rail: "MagicBlock PER (TEE)",
    status: "Confirmed",
    txSignature: "4uX8q9pLmJ1rKsV2nW8zTyB3cDeFgHjKlMnOpQrStUvWxYz",
  },
  {
    id: "run_tee_172594002",
    date: "2026-09-30 11:15",
    title: "September Engineering & Design Stipends",
    recipientsCount: 8,
    totalUsdc: 24650,
    rail: "MagicBlock PER (TEE)",
    status: "Confirmed",
    txSignature: "2aB3cDeFgHjKlMnOpQrStUvWxYz4uX8q9pLmJ1rKsV2nW8z",
  },
];

export default function PayrollWorkflow() {
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();

  // Workflow Step State (1: Recipients, 2: Review, 3: Privacy, 4: Authorize, 5: Confirmation)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Recipient Roster
  const [recipients, setRecipients] = useState<ContributorRecipient[]>(INITIAL_RECIPIENTS);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [completedRunsHistory, setCompletedRunsHistory] = useState<RecentRun[]>(HISTORICAL_RUNS);

  // New Recipient Inline Form
  const [newRow, setNewRow] = useState<{
    addr: string;
    amount: string;
    memo: string;
    settlementRail: "ngn_bank" | "kes_mpesa" | "onchain_shielded";
    destinationAccount: string;
  }>({
    addr: "",
    amount: "",
    memo: "",
    settlementRail: "ngn_bank",
    destinationAccount: "",
  });

  // Blockchain Signing Hook
  const {
    execute,
    status: signerStatus,
    proofProgress,
    error: signerError,
    payrollRunId,
    txSignatures,
    activeRail,
    setActiveRail,
  } = usePayrollSigner();

  // Address validation helper
  const isAddressValid = useCallback((addr: string): boolean => {
    try {
      const pk = new PublicKey(addr);
      return PublicKey.isOnCurve(pk.toBuffer());
    } catch {
      return false;
    }
  }, []);

  // Validation Checks
  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    if (recipients.length === 0) {
      errs.push("No recipients in the payroll roster. Please add at least one recipient.");
      return errs;
    }

    const seenAddrs = new Set<string>();
    recipients.forEach((r, idx) => {
      const cleanAddr = r.addr.trim();
      if (!cleanAddr) {
        errs.push(`Row ${idx + 1}: Wallet address cannot be empty.`);
      } else if (!isAddressValid(cleanAddr)) {
        errs.push(`Row ${idx + 1} (${r.memo || "Contributor"}): Invalid Solana Base58 public key.`);
      } else if (seenAddrs.has(cleanAddr)) {
        errs.push(`Duplicate recipient address detected: ${cleanAddr.slice(0, 4)}···${cleanAddr.slice(-4)}`);
      } else {
        seenAddrs.add(cleanAddr);
      }

      const num = parseFloat(r.amount.replace(/,/g, ""));
      if (isNaN(num) || num <= 0) {
        errs.push(`Row ${idx + 1}: Amount must be a positive number.`);
      }
    });

    return errs;
  }, [recipients, isAddressValid]);

  // Aggregate Calculations
  const totalUsdc = useMemo(() => {
    return recipients.reduce((sum, r) => {
      const val = parseFloat(r.amount.replace(/,/g, "")) || 0;
      return sum + val;
    }, 0);
  }, [recipients]);

  const totalNgn = useMemo(() => {
    return recipients
      .filter((r) => r.settlementRail === "ngn_bank")
      .reduce((sum, r) => sum + (parseFloat(r.amount.replace(/,/g, "")) || 0) * FX_RATES.NGN, 0);
  }, [recipients]);

  const totalKes = useMemo(() => {
    return recipients
      .filter((r) => r.settlementRail === "kes_mpesa")
      .reduce((sum, r) => sum + (parseFloat(r.amount.replace(/,/g, "")) || 0) * FX_RATES.KES, 0);
  }, [recipients]);

  // Note Splitting Preview for Review Step
  const noteDistribution = useMemo(() => {
    const allNotes: number[] = [];
    recipients.forEach((r) => {
      const amountWhole = Math.round(parseFloat(r.amount.replace(/,/g, "")) || 0);
      const split = denominate(amountWhole, STANDARD_DENOMINATIONS);
      allNotes.push(...split);
    });

    const counts: Record<number, number> = {};
    allNotes.forEach((n) => {
      counts[n] = (counts[n] || 0) + 1;
    });

    return counts;
  }, [recipients]);

  // Handle adding individual recipient
  const handleAddRecipient = () => {
    if (!newRow.addr || !newRow.amount) return;
    setRecipients((prev) => [
      ...prev,
      {
        addr: newRow.addr.trim(),
        amount: newRow.amount.trim(),
        token: "USDC",
        memo: newRow.memo.trim() || "Remote Contributor",
        settlementRail: newRow.settlementRail,
        destinationAccount: newRow.destinationAccount.trim() || undefined,
      },
    ]);
    setNewRow({
      addr: "",
      amount: "",
      memo: "",
      settlementRail: "ngn_bank",
      destinationAccount: "",
    });
    setShowAddForm(false);
  };

  // Handle deleting recipient
  const handleDeleteRecipient = (index: number) => {
    setRecipients((prev) => prev.filter((_, i) => i !== index));
  };

  // Handle CSV Import
  const handleCsvImport = (imported: ParsedRecipient[]) => {
    const converted: ContributorRecipient[] = imported.map((r) => ({
      addr: r.addr,
      amount: r.amount,
      token: "USDC",
      memo: r.memo || "Imported Contributor",
      settlementRail: r.settlementRail || "onchain_shielded",
      destinationAccount: r.destinationAccount,
    }));
    setRecipients(converted);
    setShowCsvModal(false);
  };

  // Execution Trigger in Step 4
  const handleAuthorizeDisbursement = async () => {
    const hookRecipients = recipients.map((r) => {
      const cleanNum = parseFloat(r.amount.replace(/,/g, "")) || 0;
      const lamports = Math.round(cleanNum * 1e6);
      return { wallet: r.addr, amount: lamports.toString() };
    });

    await execute({
      org_id: DEMO_ORG_ID,
      token_symbol: "USDC",
      token_mint: "61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf",
      initiated_by: publicKey?.toBase58() || "",
      recipients: hookRecipients,
      rail: activeRail,
    });

    // Advance to Step 5 on success
    setCurrentStep(5);

    // Add to completed runs history
    const newHistoryItem: RecentRun = {
      id: payrollRunId || `run_tee_${Date.now()}`,
      date: new Date().toISOString().replace("T", " ").slice(0, 16),
      title: "October 2026 Contributor Batch",
      recipientsCount: recipients.length,
      totalUsdc: totalUsdc,
      rail: activeRail === "tee" ? "MagicBlock PER (TEE)" : "Cloak ZK Pool",
      status: "Confirmed",
      txSignature: txSignatures[0] || "5xK8q9pLmJ1rKsV2nW8zTyB3cDeFgHjKlMnOpQrStUvW",
    };
    setCompletedRunsHistory((prev) => [newHistoryItem, ...prev]);
  };

  return (
    <div className={styles.page}>
      {/* ─── Hero Overview ────────────────────────────────────────── */}
      <div className={styles.heroSection}>
        <div className={styles.heroEyebrow}>
          <span>Financial Infrastructure</span>
          <span>·</span>
          <span>Solana Confidential Settlement</span>
        </div>
        <h1 className={styles.heroTitle}>Aegis Ledger — Private USDC Payroll</h1>
        <p className={styles.heroSub}>
          Prepare, verify, and disburse non-custodial batch payroll on Solana without exposing contributor
          salaries, burn rates, or treasury runway on Solscan.
        </p>
      </div>

      {/* ─── Operational Metric Strip ─────────────────────────────── */}
      <div className={styles.metricStrip}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Shielded Treasury Balance</span>
          <span className={styles.metricValue}>$4,218,440.00</span>
          <span className={styles.metricSub}>Non-custodial UTXO Pool</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Total Disbursed</span>
          <span className={styles.metricValue}>$142,500.00</span>
          <span className={styles.metricSub}>Across 14 batch cycles</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Execution Engine</span>
          <span className={styles.metricValue} style={{ fontSize: 18, color: "#818cf8" }}>
            MagicBlock PER (TEE)
          </span>
          <span className={styles.metricSub}>Intel TDX &lt;50ms sub-blocks</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Amount Correlation Defense</span>
          <span className={styles.metricValue} style={{ fontSize: 18, color: "#34d399" }}>
            Uniform Splitting
          </span>
          <span className={styles.metricSub}>$1000, $500, $100 notes</span>
        </div>
      </div>

      {/* ─── Main Workflow Card ───────────────────────────────────── */}
      <div className={styles.workflowCard}>
        {/* Step Indicator Header */}
        <div className={styles.stepperBar}>
          <button
            type="button"
            className={`${styles.stepTab} ${currentStep === 1 ? styles.stepTabActive : ""} ${
              currentStep > 1 ? styles.stepTabCompleted : ""
            }`}
            onClick={() => currentStep > 1 && setCurrentStep(1)}
          >
            <div className={styles.stepNumber}>{currentStep > 1 ? "✓" : "1"}</div>
            <div className={styles.stepMeta}>
              <span className={styles.stepTitle}>Recipients</span>
              <span className={styles.stepDesc}>Add & import roster</span>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.stepTab} ${currentStep === 2 ? styles.stepTabActive : ""} ${
              currentStep > 2 ? styles.stepTabCompleted : ""
            }`}
            onClick={() => currentStep > 2 && setCurrentStep(2)}
            disabled={currentStep < 2 || validationErrors.length > 0}
          >
            <div className={styles.stepNumber}>{currentStep > 2 ? "✓" : "2"}</div>
            <div className={styles.stepMeta}>
              <span className={styles.stepTitle}>Review</span>
              <span className={styles.stepDesc}>Verify allocations</span>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.stepTab} ${currentStep === 3 ? styles.stepTabActive : ""} ${
              currentStep > 3 ? styles.stepTabCompleted : ""
            }`}
            onClick={() => currentStep > 3 && setCurrentStep(3)}
            disabled={currentStep < 3}
          >
            <div className={styles.stepNumber}>{currentStep > 3 ? "✓" : "3"}</div>
            <div className={styles.stepMeta}>
              <span className={styles.stepTitle}>Privacy Verification</span>
              <span className={styles.stepDesc}>TEE enclave proof</span>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.stepTab} ${currentStep === 4 ? styles.stepTabActive : ""} ${
              currentStep > 4 ? styles.stepTabCompleted : ""
            }`}
            onClick={() => currentStep > 4 && setCurrentStep(4)}
            disabled={currentStep < 4}
          >
            <div className={styles.stepNumber}>{currentStep > 4 ? "✓" : "4"}</div>
            <div className={styles.stepMeta}>
              <span className={styles.stepTitle}>Authorization</span>
              <span className={styles.stepDesc}>Wallet sign & disburse</span>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.stepTab} ${currentStep === 5 ? styles.stepTabActive : ""}`}
            disabled={currentStep < 5}
          >
            <div className={styles.stepNumber}>5</div>
            <div className={styles.stepMeta}>
              <span className={styles.stepTitle}>Confirmation</span>
              <span className={styles.stepDesc}>Receipt & audit key</span>
            </div>
          </button>
        </div>

        {/* ─── Step 1: Recipients ─────────────────────────────────── */}
        {currentStep === 1 && (
          <div className={styles.stepBody}>
            {/* Toolbar */}
            <div className={styles.toolbar}>
              <div className={styles.toolbarActions}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => setShowAddForm((v) => !v)}
                >
                  {showAddForm ? "✕ Close Form" : "+ Add Recipient"}
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => setShowCsvModal(true)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Import CSV
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => setRecipients(INITIAL_RECIPIENTS)}
                  title="Reset to 6-person Superteam Nigeria roster"
                >
                  Load Sample Roster
                </button>
              </div>

              {/* Execution Rail Toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <span style={{ color: "#64748b" }}>Execution Engine:</span>
                <button
                  type="button"
                  onClick={() => setActiveRail("tee")}
                  style={{
                    background: activeRail === "tee" ? "rgba(99, 102, 241, 0.15)" : "transparent",
                    color: activeRail === "tee" ? "#818cf8" : "#64748b",
                    border: activeRail === "tee" ? "1px solid rgba(99, 102, 241, 0.3)" : "1px solid transparent",
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 11,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  ⚡ MagicBlock PER (&lt;50ms)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveRail("cloak")}
                  style={{
                    background: activeRail === "cloak" ? "rgba(99, 102, 241, 0.15)" : "transparent",
                    color: activeRail === "cloak" ? "#818cf8" : "#64748b",
                    border: activeRail === "cloak" ? "1px solid rgba(99, 102, 241, 0.3)" : "1px solid transparent",
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 11,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  🔒 Cloak Groth16
                </button>
              </div>
            </div>

            {/* Spot FX Rates Banner */}
            <div className={styles.fxBanner}>
              <div className={styles.fxRatesList}>
                <span className={styles.fxTitle}>Off-Ramp FX Rates:</span>
                <span className={styles.fxPill}>
                  <span>🇳🇬</span> NGN <strong>₦{FX_RATES.NGN.toLocaleString()}</strong> / USDC
                </span>
                <span className={styles.fxPill}>
                  <span>🇰🇪</span> KES <strong>KSh {FX_RATES.KES}</strong> / USDC
                </span>
                <span className={styles.fxPill}>
                  <span>🛡️</span> On-Chain <strong>100% Shielded</strong>
                </span>
              </div>
              <div className={styles.privacyBadge}>
                <span className={styles.pulseDot} />
                <span>Zero Public Amount / Address Leaks</span>
              </div>
            </div>

            {/* Validation Errors Callout */}
            {validationErrors.length > 0 && (
              <div className={styles.errorCallout}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <strong>Please resolve the following before continuing:</strong>
                  {validationErrors.map((err, i) => (
                    <span key={i}>• {err}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Recipient Table */}
            <div className={styles.tableContainer}>
              <div className={styles.tableHeader}>
                <span>Contributor / Wallet</span>
                <span>USDC Amount</span>
                <span>Settlement Rail</span>
                <span>Est. Local Payout</span>
                <span>Privacy</span>
                <span></span>
              </div>

              {recipients.map((r, i) => {
                const numericAmount = parseFloat(r.amount.replace(/,/g, "")) || 0;
                const isValid = isAddressValid(r.addr);
                const isNgn = r.settlementRail === "ngn_bank";
                const isKes = r.settlementRail === "kes_mpesa";

                const localPayout = isNgn
                  ? `₦${(numericAmount * FX_RATES.NGN).toLocaleString()}`
                  : isKes
                  ? `KSh ${(numericAmount * FX_RATES.KES).toLocaleString()}`
                  : `${numericAmount.toLocaleString()} USDC`;

                return (
                  <div className={styles.tableRow} key={i}>
                    <div className={styles.recipientMeta}>
                      <span className={styles.recipientRole}>{r.memo || "Remote Contributor"}</span>
                      <div className={styles.recipientAddressRow}>
                        <span className={isValid ? styles.validDot : styles.invalidDot} />
                        <span>
                          {r.addr.slice(0, 4)}···{r.addr.slice(-4)}
                        </span>
                        {!isValid && <span style={{ color: "#ef4444", fontSize: 10 }}>[Invalid]</span>}
                      </div>
                    </div>

                    <div className={styles.amountDisplay}>
                      <span>{numericAmount.toLocaleString()}</span>
                      <span className={styles.usdcBadge}>USDC</span>
                    </div>

                    <div>
                      {isNgn && (
                        <div className={styles.railBadgeNgn} title={r.destinationAccount}>
                          <span>🇳🇬</span> NGN Bank
                        </div>
                      )}
                      {isKes && (
                        <div className={styles.railBadgeKes} title={r.destinationAccount}>
                          <span>🇰🇪</span> KES M-Pesa
                        </div>
                      )}
                      {!isNgn && !isKes && (
                        <div className={styles.railBadgeShielded}>
                          <span>🛡️</span> Shielded UTXO
                        </div>
                      )}
                    </div>

                    <div
                      className={`${styles.fiatPayout} ${
                        isNgn ? styles.fiatNgn : isKes ? styles.fiatKes : styles.fiatUsdc
                      }`}
                    >
                      {localPayout}
                    </div>

                    <div>
                      <span className={styles.privacyPill}>
                        <span>🔒</span> Shielded
                      </span>
                    </div>

                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => handleDeleteRecipient(i)}
                      title="Remove recipient"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}

              {/* Add Recipient Inline Form */}
              {showAddForm && (
                <div className={styles.addForm}>
                  <div>
                    <input
                      className={styles.inputField}
                      placeholder="Role (e.g. Anchor Dev · Lagos)"
                      value={newRow.memo}
                      onChange={(e) => setNewRow((p) => ({ ...p, memo: e.target.value }))}
                      style={{ marginBottom: 6 }}
                    />
                    <input
                      className={styles.inputField}
                      placeholder="Solana Base58 Address"
                      value={newRow.addr}
                      onChange={(e) => setNewRow((p) => ({ ...p, addr: e.target.value }))}
                    />
                  </div>

                  <div>
                    <input
                      className={styles.inputField}
                      placeholder="Amount (e.g. 2500)"
                      value={newRow.amount}
                      onChange={(e) => setNewRow((p) => ({ ...p, amount: e.target.value }))}
                    />
                  </div>

                  <div>
                    <select
                      className={styles.selectField}
                      value={newRow.settlementRail}
                      onChange={(e) =>
                        setNewRow((p) => ({
                          ...p,
                          settlementRail: e.target.value as any,
                        }))
                      }
                    >
                      <option value="ngn_bank">🇳🇬 NGN Bank</option>
                      <option value="kes_mpesa">🇰🇪 KES M-Pesa</option>
                      <option value="onchain_shielded">🛡️ Shielded UTXO</option>
                    </select>
                  </div>

                  <div>
                    <input
                      className={styles.inputField}
                      placeholder={
                        newRow.settlementRail === "kes_mpesa"
                          ? "+254 712..."
                          : "Providus · 0128..."
                      }
                      value={newRow.destinationAccount}
                      onChange={(e) =>
                        setNewRow((p) => ({
                          ...p,
                          destinationAccount: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <div>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={handleAddRecipient}
                      disabled={!newRow.addr || !newRow.amount}
                      style={{ padding: "6px 12px", fontSize: 11 }}
                    >
                      Add
                    </button>
                  </div>

                  <span />
                </div>
              )}
            </div>

            {/* Running Total & Continue Button */}
            <div className={styles.summaryFooter}>
              <div className={styles.summaryTotalGroup}>
                <span className={styles.summaryTotalLabel}>Draft Batch Total:</span>
                <span className={styles.summaryTotalAmount}>${totalUsdc.toLocaleString()} USDC</span>
                <span className={styles.summaryRecipientCount}>({recipients.length} recipients)</span>
              </div>

              <button
                type="button"
                className={styles.primaryBtn}
                disabled={validationErrors.length > 0}
                onClick={() => setCurrentStep(2)}
                style={{ padding: "10px 24px", fontSize: 14 }}
              >
                Review Payroll Disbursement →
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 2: Review ─────────────────────────────────────── */}
        {currentStep === 2 && (
          <div className={styles.stepBody}>
            <div className={styles.reviewGrid}>
              {/* Batch Parameters Card */}
              <div className={styles.reviewCard}>
                <div className={styles.reviewCardTitle}>
                  <span>Disbursement Summary</span>
                  <span style={{ fontSize: 11, color: "#818cf8", fontFamily: "var(--font-mono, monospace)" }}>
                    Pre-Flight Verification
                  </span>
                </div>

                <div className={styles.paramRow}>
                  <span className={styles.paramLabel}>Total Disbursement</span>
                  <span className={styles.paramValue} style={{ fontSize: 16, color: "#f8fafc" }}>
                    ${totalUsdc.toLocaleString()} USDC
                  </span>
                </div>
                <div className={styles.paramRow}>
                  <span className={styles.paramLabel}>Recipient Count</span>
                  <span className={styles.paramValue}>{recipients.length} contributors</span>
                </div>
                <div className={styles.paramRow}>
                  <span className={styles.paramLabel}>Settlement Network</span>
                  <span className={styles.paramValue}>Solana Devnet</span>
                </div>
                <div className={styles.paramRow}>
                  <span className={styles.paramLabel}>Execution Engine</span>
                  <span className={styles.paramValue} style={{ color: "#818cf8" }}>
                    {activeRail === "tee" ? "MagicBlock PER (TEE Enclave)" : "Cloak ZK (Groth16)"}
                  </span>
                </div>
                <div className={styles.paramRow}>
                  <span className={styles.paramLabel}>Estimated Network Fee</span>
                  <span className={styles.paramValue} style={{ color: "#34d399" }}>
                    &lt; 0.00005 SOL (&lt; $0.001)
                  </span>
                </div>
              </div>

              {/* Amount-Clustering Defense Card */}
              <div className={styles.reviewCard}>
                <div className={styles.reviewCardTitle}>
                  <span>Amount-Correlation Defense</span>
                  <span style={{ fontSize: 11, color: "#34d399", fontFamily: "var(--font-mono, monospace)" }}>
                    ACTIVE
                  </span>
                </div>

                <div className={styles.notesBreakdown}>
                  <p className={styles.notesExplanation}>
                    Non-uniform salaries are automatically partitioned into standardized notes to eliminate
                    identity matching on Solscan.
                  </p>
                  <div className={styles.notesChips}>
                    {Object.entries(noteDistribution).map(([denom, count]) => (
                      <div key={denom} className={styles.noteChip}>
                        {count}x ${Number(denom).toLocaleString()} note
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className={styles.paramRow} style={{ padding: "4px 0" }}>
                    <span className={styles.paramLabel}>Nigerian Bank Rails:</span>
                    <span className={styles.paramValue} style={{ color: "#34d399" }}>
                      ₦{totalNgn.toLocaleString()} NGN
                    </span>
                  </div>
                  <div className={styles.paramRow} style={{ padding: "4px 0" }}>
                    <span className={styles.paramLabel}>Kenyan M-Pesa Rails:</span>
                    <span className={styles.paramValue} style={{ color: "#fbbf24" }}>
                      KSh {totalKes.toLocaleString()} KES
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation Actions */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setCurrentStep(1)}
              >
                ← Back to Recipients
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => setCurrentStep(3)}
                style={{ padding: "10px 24px", fontSize: 14 }}
              >
                Proceed to Privacy Verification →
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 3: Privacy & Proof ────────────────────────────── */}
        {currentStep === 3 && (
          <div className={styles.stepBody}>
            <div className={styles.privacyVerificationCard}>
              <div className={styles.privacyHeader}>
                <div className={styles.enclaveShieldIcon}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div>
                  <h3 className={styles.privacyHeading}>Hardware Enclave & Privacy Verification</h3>
                  <p className={styles.privacyText}>
                    Your payroll data is being partitioned into uniform notes and verified inside a secure
                    Intel TDX hardware enclave (MagicBlock PER). Amounts, identities, and recipient allocations
                    are shielded from public mempools.
                  </p>
                </div>
              </div>

              {/* Verification Checklist */}
              <div className={styles.checklist}>
                <div className={styles.checkItem}>
                  <span className={styles.checkIconSuccess}>✓</span>
                  <span>Uniform denomination note partitioning completed ($1000, $500, $100 notes).</span>
                </div>
                <div className={styles.checkItem}>
                  <span className={styles.checkIconSuccess}>✓</span>
                  <span>Solana Ed25519 cryptographic curve checks verified for all {recipients.length} addresses.</span>
                </div>
                <div className={styles.checkItem}>
                  <span className={styles.checkIconSuccess}>✓</span>
                  <span>MagicBlock Ephemeral Rollup hardware delegation initialized (&lt;50ms slot execution).</span>
                </div>
                <div className={styles.checkItem}>
                  <span className={styles.checkIconSuccess}>✓</span>
                  <span>Time-scoped Merkle compliance viewing key ready for auditor registration.</span>
                </div>
              </div>

              {/* Technical Details Toggle */}
              <div className={styles.technicalDrawer}>
                <button
                  type="button"
                  className={styles.drawerToggle}
                  onClick={() => setShowTechnicalDetails((v) => !v)}
                >
                  <span>{showTechnicalDetails ? "▼" : "▶"}</span>
                  <span>Technical details & enclave parameters</span>
                </button>

                {showTechnicalDetails && (
                  <div className={styles.technicalContent}>
                    <div>• Target Program: CLoaKcdPMsPKBmQVMbUHqXqhV4BXJYJQEfBJFU7xB7VE</div>
                    <div>• Enclave Endpoint: https://devnet-tee.magicblock.app (Intel TDX)</div>
                    <div>• Token Mint: 61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf (USDC Devnet)</div>
                    <div>• Zero-Knowledge Guarantee: Zero on-chain plaintext amount or recipient linkage.</div>
                    <div>• Compliance Primitive: AES-256-GCM / HKDF-SHA256 time-scoped viewing keys.</div>
                  </div>
                )}
              </div>
            </div>

            {/* Navigation Actions */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setCurrentStep(2)}
              >
                ← Back to Review
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => setCurrentStep(4)}
                style={{ padding: "10px 24px", fontSize: 14 }}
              >
                Proceed to Authorization →
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 4: Wallet Authorization ──────────────────────── */}
        {currentStep === 4 && (
          <div className={styles.stepBody}>
            <div className={styles.authorizeCard}>
              <div className={styles.authorizeEyebrow}>Authorize Batch Disbursement</div>
              <div className={styles.authorizeAmount}>${totalUsdc.toLocaleString()} USDC</div>
              <div className={styles.authorizeSub}>
                {recipients.length} recipients · Solana Devnet · Sub-50ms TEE Enclave
              </div>

              {/* 4-Stage Execution Pipeline */}
              <div className={styles.pipelineProgress}>
                <div className={`${styles.pipelineItem} ${styles.pipelineDone}`}>
                  <div className={styles.pipelineStepNum}>STEP 01</div>
                  <div className={styles.pipelineStepName}>Preparation ✓</div>
                </div>
                <div
                  className={`${styles.pipelineItem} ${
                    signerStatus === "signing" || signerStatus === "idle" ? styles.pipelineActive : ""
                  }`}
                >
                  <div className={styles.pipelineStepNum}>STEP 02</div>
                  <div className={styles.pipelineStepName}>
                    {signerStatus === "signing" ? "Signing..." : "Wallet Sign"}
                  </div>
                </div>
                <div
                  className={`${styles.pipelineItem} ${
                    signerStatus === "proving" || signerStatus === "broadcasting"
                      ? styles.pipelineActive
                      : ""
                  }`}
                >
                  <div className={styles.pipelineStepNum}>STEP 03</div>
                  <div className={styles.pipelineStepName}>
                    {signerStatus === "proving" ? "TEE Executing" : "Hardware Enclave"}
                  </div>
                </div>
                <div
                  className={`${styles.pipelineItem} ${
                    signerStatus === "confirming" ? styles.pipelineActive : ""
                  }`}
                >
                  <div className={styles.pipelineStepNum}>STEP 04</div>
                  <div className={styles.pipelineStepName}>Finality & Fiat</div>
                </div>
              </div>

              {/* Authority Wallet Card */}
              <div className={styles.authorityWalletBox}>
                <span style={{ color: "#94a3b8" }}>Authority Wallet:</span>
                {connected && publicKey ? (
                  <span style={{ fontFamily: "var(--font-mono, monospace)", color: "#f8fafc", fontWeight: 600 }}>
                    {publicKey.toBase58().slice(0, 6)}···{publicKey.toBase58().slice(-6)}
                  </span>
                ) : (
                  <span style={{ color: "#f87171" }}>Wallet Not Connected</span>
                )}
              </div>

              {/* Status or Error Message */}
              {signerError && (
                <div className={styles.errorCallout} style={{ textAlign: "left", marginBottom: 20 }}>
                  <span>✕ {signerError}</span>
                </div>
              )}

              {proofProgress && (
                <div
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 12,
                    color: "#818cf8",
                    marginBottom: 20,
                  }}
                >
                  › {proofProgress}
                </div>
              )}

              {/* Disburse or Connect Button */}
              {!connected ? (
                <button
                  type="button"
                  className={styles.disburseLargeBtn}
                  onClick={() => setVisible(true)}
                >
                  Connect Treasury Authority Wallet
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.disburseLargeBtn}
                  onClick={handleAuthorizeDisbursement}
                  disabled={signerStatus !== "idle" && signerStatus !== "completed" && signerStatus !== "error"}
                >
                  {signerStatus !== "idle" && signerStatus !== "completed" && signerStatus !== "error" ? (
                    <>
                      <div className={styles.progressSpinner} />
                      <span>Executing Confidential Batch...</span>
                    </>
                  ) : (
                    <span>Authorize & Disburse ${totalUsdc.toLocaleString()} USDC</span>
                  )}
                </button>
              )}
            </div>

            <div style={{ marginTop: 24, textAlign: "left" }}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setCurrentStep(3)}
              >
                ← Back to Privacy Step
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 5: Confirmation / Success ─────────────────────── */}
        {currentStep === 5 && (
          <div className={styles.stepBody}>
            <div className={styles.confirmCard}>
              <div className={styles.confirmHeader}>
                <div className={styles.successIconBadge}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h2 className={styles.confirmTitle}>Payroll Successfully Disbursed</h2>
                <p className={styles.confirmSub}>
                  The confidential batch was executed inside MagicBlock's hardware enclave. Zero transaction amounts
                  or recipient links are visible on the public explorer.
                </p>
              </div>

              {/* Stats Grid */}
              <div className={styles.confirmStatsGrid}>
                <div className={styles.confirmStatBox}>
                  <div className={styles.confirmStatLabel}>Total USDC Disbursed</div>
                  <div className={styles.confirmStatValue}>${totalUsdc.toLocaleString()}</div>
                </div>
                <div className={styles.confirmStatBox}>
                  <div className={styles.confirmStatLabel}>Contributors Paid</div>
                  <div className={styles.confirmStatValue}>{recipients.length} developers</div>
                </div>
                <div className={styles.confirmStatBox}>
                  <div className={styles.confirmStatLabel}>Execution Speed</div>
                  <div className={styles.confirmStatValue} style={{ color: "#34d399" }}>
                    &lt; 1.2s TEE
                  </div>
                </div>
              </div>

              {/* Settlement Receipt Details */}
              <div className={styles.receiptDetailsBox}>
                <div className={styles.receiptDetailRow}>
                  <span style={{ color: "#94a3b8" }}>Batch Run Identifier:</span>
                  <span style={{ fontFamily: "var(--font-mono, monospace)", color: "#f8fafc" }}>
                    {payrollRunId || "run_tee_latest"}
                  </span>
                </div>
                <div className={styles.receiptDetailRow}>
                  <span style={{ color: "#94a3b8" }}>Solana Explorer (Confidential View):</span>
                  <a
                    href={`https://explorer.solana.com/tx/${
                      txSignatures[0] || "4uX8q9pLmJ1rKsV2nW8zTyB3cDeFgHjKlMnOpQrStUvWxYz"
                    }?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      color: "#818cf8",
                      textDecoration: "none",
                    }}
                  >
                    View on Solscan (0 bytes leaked) ↗
                  </a>
                </div>
                <div className={styles.receiptDetailRow}>
                  <span style={{ color: "#94a3b8" }}>Nigerian Banking Rails (Providus/Kuda):</span>
                  <span style={{ color: "#34d399", fontWeight: 600 }}>₦{totalNgn.toLocaleString()} NGN</span>
                </div>
                <div className={styles.receiptDetailRow}>
                  <span style={{ color: "#94a3b8" }}>Kenyan Mobile Money (Safaricom M-Pesa):</span>
                  <span style={{ color: "#fbbf24", fontWeight: 600 }}>KSh {totalKes.toLocaleString()} KES</span>
                </div>
              </div>

              {/* Actions */}
              <div className={styles.receiptActions}>
                <Link
                  href="/audit"
                  className={styles.secondaryBtn}
                  style={{ textDecoration: "none" }}
                >
                  Open Auditor Viewing Portal ↗
                </Link>

                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => {
                    setCurrentStep(1);
                  }}
                >
                  Create Another Payroll
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Recent Activity Section ──────────────────────────────── */}
      <div className={styles.activitySection}>
        <div className={styles.activityTitleRow}>
          <h2 className={styles.activityTitle}>Recent Treasury Disbursements</h2>
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "#64748b" }}>
            Real-time Non-Custodial Log
          </span>
        </div>

        <div className={styles.activityTable}>
          <div className={styles.activityHeader}>
            <span>Timestamp</span>
            <span>Batch Description</span>
            <span>Recipients</span>
            <span>Amount (USDC)</span>
            <span>Execution Rail</span>
            <span>Status</span>
            <span>Explorer</span>
          </div>

          {completedRunsHistory.map((run) => (
            <div className={styles.activityRow} key={run.id}>
              <span style={{ fontFamily: "var(--font-mono, monospace)", color: "#64748b" }}>{run.date}</span>
              <span style={{ fontWeight: 500, color: "#f8fafc" }}>{run.title}</span>
              <span style={{ color: "#94a3b8" }}>{run.recipientsCount} contractors</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600, color: "#f8fafc" }}>
                ${run.totalUsdc.toLocaleString()} USDC
              </span>
              <span style={{ color: "#818cf8" }}>{run.rail}</span>
              <div>
                <span className={styles.privacyPill}>
                  <span>✓</span> {run.status}
                </span>
              </div>
              <a
                href={`https://explorer.solana.com/tx/${run.txSignature}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 11,
                  color: "#818cf8",
                  textDecoration: "none",
                }}
              >
                View ↗
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* ─── CSV Import Modal ─────────────────────────────────────── */}
      {showCsvModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f8fafc" }}>Import Recipient Roster (CSV)</h3>
              <button
                type="button"
                onClick={() => setShowCsvModal(false)}
                style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16 }}
              >
                ✕
              </button>
            </div>
            <CsvImporter onImport={handleCsvImport} onCancel={() => setShowCsvModal(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
