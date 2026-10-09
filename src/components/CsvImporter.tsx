"use client";

import { useState, useRef, useCallback } from "react";
import { PublicKey } from "@solana/web3.js";
import styles from "./CsvImporter.module.css";
import { denominate } from "@/lib/denominate";
import { IconBolt, IconCheck } from "./Icons";

export interface ParsedRecipient {
  addr: string;
  amount: string;
  token: "USDC" | "USDT" | "SOL";
  memo: string;
  settlementRail?: "onchain_shielded" | "ngn_bank" | "kes_mpesa";
  destinationAccount?: string;
}

interface CsvImporterProps {
  onImport: (recipients: ParsedRecipient[]) => void;
  onCancel?: () => void;
}

// Preset: 8-person Superteam Nigeria / East Africa Devshop Payroll with valid Base58 Solana addresses
const SUPERTEAM_SAMPLE_CSV = `wallet,amount,token,memo,rail,destination
6bq9QqzvjNbQE4sJs4fLsGUpqHe4hPcJVc6oJQyq6RzC,4850,USDC,Lead Anchor Core Dev · Lagos,ngn_bank,Providus 0128943312
8uE6pQnHLAqLkNhMfVjC9yFeEqx3qkPx4x6VGWjE2FmH,3200,USDC,Frontend Lead · Nairobi,kes_mpesa,+254 712 901844
3oLd7mJQ7cVRP4qUKoynTkMfVvFjUeBjG3aJXcgGxGZr,2500,USDC,Security Auditor · Abuja,ngn_bank,Kuda 2049182390
GxK6sHpqmF9qZVzRqFJc4Tbj9aWMGHakBjVkoXvRaTKT,2100,USDC,UI/UX Product Designer,onchain_shielded,Shielded UTXO
7ZchxRLHUZNLF5oxsvSoqeCUTzUF8etadYKDNd9W4xiZ,1800,USDC,DevRel & Ecosystem Lead · Lagos,ngn_bank,Zenith 1014892211
Ac3BVmSyd7KmZbih1seeBP4FSsFpbVcdMcFQUQH8GZhi,1500,USDC,Fullstack Apprentice · Mombasa,kes_mpesa,+254 722 411890
8c4ARfpuqCakKTxBuj854BNMdnREPfECVHx65FM6DNns,1250,USDC,Technical Writer / Docs,onchain_shielded,Shielded UTXO
G2MUCSPRifi78UycVeivjd6kgtC8ojDf1vKRqVo5S2xD,950,USDC,Community Ops Manager · Lagos,ngn_bank,Access 0041289941`;

export default function CsvImporter({ onImport, onCancel }: CsvImporterProps) {
  const [activeTab, setActiveTab] = useState<"upload" | "paste">("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRecipient[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validate single Solana base58 address
  const isValidSolanaAddress = (addr: string): boolean => {
    try {
      const pubkey = new PublicKey(addr);
      return PublicKey.isOnCurve(pubkey.toBuffer());
    } catch {
      return false;
    }
  };

  const processCsvContent = useCallback((content: string, name?: string) => {
    if (name) setFileName(name);
    setRawText(content);

    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      setParsed([]);
      setErrors(["Uploaded file is empty."]);
      return;
    }

    const newErrors: string[] = [];
    const newParsed: ParsedRecipient[] = [];

    // Detect if first line is a header
    let startIndex = 0;
    const firstLineLower = lines[0].toLowerCase();
    if (
      firstLineLower.includes("wallet") ||
      firstLineLower.includes("address") ||
      firstLineLower.includes("amount") ||
      firstLineLower.includes("recipient")
    ) {
      startIndex = 1;
    }

    for (let i = startIndex; i < lines.length; i++) {
      const lineNum = i + 1;
      const rawLine = lines[i];

      // Split by comma, tab, or semicolon
      const parts = rawLine.split(/[,;\t]/).map(p => p.trim().replace(/^["']|["']$/g, ""));

      if (parts.length < 2) {
        newErrors.push(`Line ${lineNum}: Expected at least 'address, amount' (received '${rawLine}')`);
        continue;
      }

      let addr = "";
      let amountStr = "";
      let token: "USDC" | "USDT" | "SOL" = "USDC";
      let memo = "";

      // Check if first column is name or address
      if (isValidSolanaAddress(parts[0])) {
        addr = parts[0];
        amountStr = parts[1];
        if (parts.length >= 3 && ["USDC", "USDT", "SOL"].includes(parts[2].toUpperCase())) {
          token = parts[2].toUpperCase() as "USDC" | "USDT" | "SOL";
          memo = parts.slice(3).join(" ");
        } else {
          memo = parts.slice(2).join(" ");
        }
      } else if (parts.length >= 3 && isValidSolanaAddress(parts[1])) {
        // Format: Name, Address, Amount, [Token], [Memo]
        addr = parts[1];
        amountStr = parts[2];
        const namePrefix = parts[0];
        if (parts.length >= 4 && ["USDC", "USDT", "SOL"].includes(parts[3].toUpperCase())) {
          token = parts[3].toUpperCase() as "USDC" | "USDT" | "SOL";
          memo = `${namePrefix} · ${parts.slice(4).join(" ")}`.trim();
        } else {
          memo = `${namePrefix} · ${parts.slice(3).join(" ")}`.trim();
        }
      } else {
        newErrors.push(`Line ${lineNum}: Invalid Solana address format '${parts[0].slice(0, 10)}...'`);
        continue;
      }

      // Clean amount (strip $, commas)
      const cleanAmount = amountStr.replace(/[\$,]/g, "").trim();
      const numAmount = parseFloat(cleanAmount);

      if (isNaN(numAmount) || numAmount <= 0) {
        newErrors.push(`Line ${lineNum}: Invalid payment amount '${amountStr}'`);
        continue;
      }

      let settlementRail: "onchain_shielded" | "ngn_bank" | "kes_mpesa" = "onchain_shielded";
      let destinationAccount: string | undefined = undefined;

      if (parts.length >= 5) {
        const rawRail = parts[4].toLowerCase();
        if (rawRail.includes("ngn") || rawRail.includes("naira") || rawRail.includes("bank")) {
          settlementRail = "ngn_bank";
        } else if (rawRail.includes("kes") || rawRail.includes("mpesa") || rawRail.includes("shilling")) {
          settlementRail = "kes_mpesa";
        }
      } else if (memo.toLowerCase().includes("lagos") || memo.toLowerCase().includes("abuja")) {
        settlementRail = "ngn_bank";
        destinationAccount = "Local Nigerian Bank";
      } else if (memo.toLowerCase().includes("nairobi") || memo.toLowerCase().includes("mombasa")) {
        settlementRail = "kes_mpesa";
        destinationAccount = "Safaricom M-Pesa";
      }

      if (parts.length >= 6) {
        destinationAccount = parts[5];
      }

      newParsed.push({
        addr,
        amount: numAmount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
        token,
        memo: memo || "Contributor Retainer",
        settlementRail,
        destinationAccount,
      });
    }

    setParsed(newParsed);
    setErrors(newErrors);
  }, []);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      processCsvContent(text, file.name);
    };
    reader.readAsText(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      processCsvContent(text, file.name);
    };
    reader.readAsText(file);
  };

  const handleLoadPreset = () => {
    processCsvContent(SUPERTEAM_SAMPLE_CSV, "superteam_devshop_payroll.csv");
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([SUPERTEAM_SAMPLE_CSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "aegis_payroll_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Calculations for Preflight Summary
  const totalAmount = parsed.reduce((sum, r) => {
    const val = parseFloat(r.amount.replace(/,/g, ""));
    return sum + (isNaN(val) ? 0 : val);
  }, 0);

  // Compute breakdown of uniform notes
  const notesBreakdown: Record<number, number> = {};
  let totalNotesCount = 0;

  parsed.forEach(r => {
    const val = parseFloat(r.amount.replace(/,/g, ""));
    const notes = denominate(val, [1000, 500, 250, 100, 50, 25, 10, 5, 1]);
    totalNotesCount += notes.length;
    notes.forEach(n => {
      notesBreakdown[n] = (notesBreakdown[n] || 0) + 1;
    });
  });

  const sortedDenoms = Object.keys(notesBreakdown)
    .map(Number)
    .sort((a, b) => b - a);

  return (
    <div className={styles.importerContainer}>
      <div className={styles.headerRow}>
        <div className={styles.titleGroup}>
          <span className={styles.eyebrow}>Batch Payroll Ingestion</span>
          <h3 className={styles.title}>Import Contributor Spreadsheet</h3>
        </div>
        <div className={styles.actionsGroup}>
          <button className={styles.templateBtn} onClick={handleDownloadTemplate} title="Download CSV template">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1.5v6M3.5 5.5L6 8l2.5-2.5M1.5 9.5v1h9v-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Template CSV
          </button>
          <button className={styles.samplePresetBtn} onClick={handleLoadPreset}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <IconBolt size={11} /> Load Superteam Sample Run (8 Devs)
            </span>
          </button>
        </div>
      </div>

      <div className={styles.tabsBar}>
        <button
          className={`${styles.tabBtn} ${activeTab === "upload" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveTab("upload")}
        >
          Drag & Drop File
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === "paste" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveTab("paste")}
        >
          Paste Raw Text
        </button>
      </div>

      {activeTab === "upload" ? (
        <div
          className={`${styles.dropZone} ${isDragging ? styles.dropZoneHover : ""}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            accept=".csv,.txt"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
          <div className={styles.dropIcon}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 2.5v9M5.5 8L9 11.5 12.5 8M3 14.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className={styles.dropMainText}>
            {fileName ? `Loaded: ${fileName}` : "Click to browse or drop your .csv file here"}
          </span>
          <span className={styles.dropSubText}>
            Supported format: wallet_address, amount, [token], [memo]
          </span>
        </div>
      ) : (
        <textarea
          className={styles.pasteArea}
          placeholder="Paste rows:&#10;6bq9QqzvjNbQE4sJs4fLsGUpqHe4hPcJVc6oJQyq6RzC, 4850, Lead Core Dev&#10;8uE6pQnHLAqLkNhMfVjC9yFeEqx3qkPx4x6VGWjE2FmH, 3200, Frontend Lead"
          value={rawText}
          onChange={(e) => processCsvContent(e.target.value)}
        />
      )}

      {/* Errors list */}
      {errors.length > 0 && (
        <div className={styles.errorBox} style={{ marginTop: 14 }}>
          <span className={styles.errorTitle}>Found {errors.length} formatting issues:</span>
          {errors.slice(0, 3).map((err, idx) => (
            <span key={idx} className={styles.errorItem}>• {err}</span>
          ))}
          {errors.length > 3 && (
            <span className={styles.errorItem}>...and {errors.length - 3} more issues.</span>
          )}
        </div>
      )}

      {/* Preflight Summary Card */}
      {parsed.length > 0 && (
        <div className={styles.preflightCard}>
          <div className={styles.preflightGrid}>
            <div className={styles.metricBox}>
              <span className={styles.metricLabel}>Recipients</span>
              <span className={styles.metricVal}>{parsed.length}</span>
              <span className={styles.metricSub}>Valid addresses</span>
            </div>
            <div className={styles.metricBox}>
              <span className={styles.metricLabel}>Total Payroll</span>
              <span className={styles.metricVal}>${totalAmount.toLocaleString()} USDC</span>
              <span className={styles.metricSub}>Gross disbursement</span>
            </div>
            <div className={styles.metricBox}>
              <span className={styles.metricLabel}>Uniform Notes</span>
              <span className={styles.metricVal}>{totalNotesCount} notes</span>
              <span className={styles.metricSub}>Anti-clustering defense</span>
            </div>
            <div className={styles.metricBox}>
              <span className={styles.metricLabel}>Settlement Speed</span>
              <span className={styles.metricVal} style={{ color: "var(--green)" }}>~1.2 sec</span>
              <span className={styles.metricSub}>MagicBlock TEE Batch</span>
            </div>
          </div>

          {/* Denominations breakdown */}
          <div className={styles.denomsRow}>
            <span className={styles.denomsLabel}>Note Partitioning:</span>
            {sortedDenoms.map(denom => (
              <span key={denom} className={styles.denomPill}>
                ${denom.toLocaleString()}: <span className={styles.denomCount}>{notesBreakdown[denom]}x</span>
              </span>
            ))}
          </div>

          <div className={styles.footerRow}>
            {onCancel && (
              <button className={styles.clearBtn} onClick={onCancel}>
                Cancel
              </button>
            )}
            <button
              className={styles.applyBtn}
              onClick={() => onImport(parsed)}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <IconCheck size={13} /> Load {parsed.length} Recipients into Batch
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
