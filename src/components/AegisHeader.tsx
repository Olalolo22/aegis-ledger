"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import styles from "./AegisHeader.module.css";

interface AegisHeaderProps {
  activeView?: "payroll" | "activity" | "audit";
  onViewChange?: (view: "payroll" | "activity") => void;
}

export default function AegisHeader({ activeView = "payroll", onViewChange }: AegisHeaderProps) {
  const { connected, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const shortAddr = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}···${publicKey.toBase58().slice(-4)}`
    : null;

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        {/* Brand */}
        <div className={styles.brandGroup}>
          <Link href="/" className={styles.brandLink}>
            <div className={styles.logoMark}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L3 7V12C3 17.5 7 21.5 12 22C17 21.5 21 17.5 21 12V7L12 2Z" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 7V17M8 11L12 7L16 11" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className={styles.brandText}>
              <span className={styles.brandName}>Aegis Ledger</span>
              <span className={styles.brandTag}>Private USDC Payroll</span>
            </div>
          </Link>

          <div className={styles.envBadge}>
            <span className={styles.statusDot} />
            <span>Solana Devnet</span>
          </div>

          <div className={styles.teeBadge}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <span>MagicBlock PER Enclave</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className={styles.nav}>
          <button
            type="button"
            className={`${styles.navItem} ${activeView === "payroll" ? styles.navItemActive : ""}`}
            onClick={() => onViewChange?.("payroll")}
          >
            Payroll
          </button>
          <button
            type="button"
            className={`${styles.navItem} ${activeView === "activity" ? styles.navItemActive : ""}`}
            onClick={() => onViewChange?.("activity")}
          >
            Recent Activity
          </button>
          <Link href="/audit" className={styles.navItem}>
            Auditor Portal
            <span className={styles.externalArrow}>↗</span>
          </Link>
        </nav>

        {/* Wallet Connection */}
        <div className={styles.walletGroup}>
          {connected && shortAddr ? (
            <div className={styles.walletConnectedCard}>
              <div className={styles.walletInfo}>
                <span className={styles.walletLabel}>Treasury Authority</span>
                <span className={styles.walletAddress}>{shortAddr}</span>
              </div>
              <button
                type="button"
                className={styles.disconnectBtn}
                onClick={() => disconnect()}
                title="Disconnect authority wallet"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.connectBtn}
              onClick={() => setVisible(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="3" />
                <path d="M16 12h.01M2 10h20" />
              </svg>
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
