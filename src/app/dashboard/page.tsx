"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

const PayrollTerminal = dynamic(() => import("@/components/PayrollTerminal"), { ssr: false });
const EmployeeScanner = dynamic(() => import("@/components/EmployeeScanner"), { ssr: false });
const AuditGraph = dynamic(() => import("@/components/AuditGraph"), { ssr: false });

// ─── Global wallet connect trigger ─────────────────────────────
function useExplicitWalletConnect() {
  const { wallet, connect, connected, connecting } = useWallet();
  useEffect(() => {
    if (wallet && !connected && !connecting) {
      connect().catch((err) => {
        console.error("[Aegis] Wallet connect failed:", err);
      });
    }
  }, [wallet, connected, connecting, connect]);
}

// ─── Role banners ──────────────────────────────────────────────
const ROLE_BANNERS: Record<string, { label: string; desc: string; color: string; bg: string; border: string }> = {
  admin: {
    label: "Treasury Admin",
    desc: "You are acting as the treasury operator. Full access to confidential payroll, emerging-market rails, and shielded balance.",
    color: "#0066ff",
    bg: "rgba(0,102,255,0.04)",
    border: "rgba(0,102,255,0.12)",
  },
  employee: {
    label: "Employee / Contractor",
    desc: "You are acting as a payroll recipient. Connect your wallet to scan the pool for notes addressed to you.",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.04)",
    border: "rgba(34,197,94,0.12)",
  },
  auditor: {
    label: "Compliance Auditor",
    desc: "You are acting as an auditor with a scoped viewing key. You can see decrypted flows without accessing spending keys.",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.04)",
    border: "rgba(245,158,11,0.12)",
  },
};

import styles from "./dashboard.module.css";

function RoleBanner({ view }: { view: string }) {
  const r = ROLE_BANNERS[view];
  if (!r) return null;
  return (
    <div className={styles.roleBannerContainer}>
      <div
        className={styles.roleBannerInner}
        style={{
          background: r.bg,
          border: `1px solid ${r.border}`,
          borderTop: "none",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: r.color,
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: r.color, fontWeight: 600 }}>
          {r.label}
        </span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "#64707f" }}>
          — {r.desc}
        </span>
      </div>
    </div>
  );
}

// ─── Clean White NavBar ─────────────────────────────────────────
const NavBar = ({ view, setView }: { view: string; setView: (v: string) => void }) => {
  const { connected, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const tabs = [
    { id: "admin", label: "Treasury", icon: "🏛" },
    { id: "employee", label: "My Payslips", icon: "👤" },
    { id: "auditor", label: "Audit Portal", icon: "🔍" },
  ];

  const handleWalletClick = () => {
    if (connected) {
      disconnect();
    } else {
      setVisible(true);
    }
  };

  const shortAddr = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}···${publicKey.toBase58().slice(-4)}`
    : null;

  const roleLabel = view === "admin"
    ? "TREASURY"
    : view === "employee"
      ? "EMPLOYEE"
      : "AUDITOR";

  return (
    <nav className={styles.nav}>
      {/* Logo */}
      <div className={styles.brandGroup}>
        <a href="/" className={styles.brandLink}>
          <img src="/logo.svg" alt="Aegis Logo" className={styles.brandLogo} />
          <span className={styles.brandName}>Aegis Ledger</span>
        </a>
        <div className={styles.magicBadge}>
          <span className={styles.badgeDot} />
          MAGICBLOCK PER
        </div>
      </div>

      {/* Tab switcher */}
      <div className={styles.tabSwitcher}>
        <span className={styles.demoLabel}>Demo: View as →</span>
        <div className={styles.tabsList}>
          {tabs.map(t => (
            <button key={t.id}
              onClick={() => setView(t.id)}
              className={styles.tabBtn}
              style={{
                border: view === t.id ? "1.5px solid #0066ff" : "1.5px solid transparent",
                background: view === t.id ? "#ffffff" : "none",
                color: view === t.id ? "#08090b" : "#64707f",
              }}>
              <span style={{ fontSize: 13 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Live wallet status */}
      <div className={styles.walletGroup}>
        {connected && shortAddr ? (
          <div className={styles.walletInfo}>
            <div className={styles.walletRole}>{roleLabel} WALLET</div>
            <div className={styles.walletAddress}>{shortAddr}</div>
          </div>
        ) : (
          <div className={styles.walletInfo}>
            <div className={styles.walletRole}>WALLET</div>
            <div className={styles.walletAddress} style={{ color: "#bdc4ce" }}>Not connected</div>
          </div>
        )}
        <button
          onClick={handleWalletClick}
          title={connected ? `Connected: ${shortAddr} — click to disconnect` : "Click to connect wallet"}
          className={styles.walletToggleBtn}
          style={{
            background: connected ? "#08090b" : "#f4f5f7",
            color: connected ? "#ffffff" : "#64707f",
            border: connected ? "none" : "1px solid #e8ebee",
          }}>
          {connected ? "◆" : "◇"}
        </button>
      </div>
    </nav>
  );
};

// Root page 
export default function DashboardPage() {
  useExplicitWalletConnect();

  const [view, setView] = useState("admin");

  return (
    <>
      <NavBar view={view} setView={setView} />
      <RoleBanner view={view} />
      {view === "admin" && <PayrollTerminal />}
      {view === "employee" && <EmployeeScanner />}
      {view === "auditor" && <AuditGraph />}
    </>
  );
}
