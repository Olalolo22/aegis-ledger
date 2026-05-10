"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

const PayrollTerminal = dynamic(() => import("@/components/PayrollTerminal"), { ssr: false });
const EmployeeScanner = dynamic(() => import("@/components/EmployeeScanner"), { ssr: false });
const AuditGraph = dynamic(() => import("@/components/AuditGraph"), { ssr: false });

// ─── FIX: Global wallet connect trigger ────────────────────────
// Moved here from EmployeeScanner so it fires regardless of which
// tab is active when the user selects a wallet from the modal.
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
    desc: "You are acting as the DAO treasurer. Full access to payroll, swaps, and shielded balance.",
    color: "#0066ff",
    bg: "rgba(0,102,255,0.04)",
    border: "rgba(0,102,255,0.12)",
  },
  employee: {
    label: "Employee",
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

function RoleBanner({ view }: { view: string }) {
  const r = ROLE_BANNERS[view];
  if (!r) return null;
  return (
    <div style={{
      maxWidth: 1200, margin: "0 auto", padding: "0 32px",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "9px 16px", marginBottom: 0,
        background: r.bg, border: `1px solid ${r.border}`,
        borderRadius: "0 0 10px 10px", borderTop: "none",
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: r.color, display: "inline-block", flexShrink: 0,
        }} />
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

// ─── NavBar ────────────────────────────────────────────────────
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
    <nav style={{
      position: "sticky", top: 0, zIndex: 100,
      height: 60, display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 32px", background: "rgba(255,255,255,0.97)",
      backdropFilter: "blur(20px)", borderBottom: "1px solid #e8ebee",
    }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img src="/logo.svg" alt="Aegis Logo" style={{ width: 30, height: 30 }} />
        <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: "-0.3px", color: "#08090b" }}>Aegis Ledger</span>
        <div style={{
          marginLeft: 8, fontFamily: "Geist Mono, monospace", fontSize: 9.5, color: "#0066ff",
          background: "rgba(0,102,255,0.07)", border: "1px solid rgba(0,102,255,0.20)",
          padding: "3px 9px", borderRadius: 100, display: "flex", alignItems: "center", gap: 5,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#0066ff", display: "inline-block" }} />
          CLOAK SHIELD
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "Geist Mono, monospace", fontSize: 9.5, color: "#bdc4ce", letterSpacing: 0.4, textTransform: "uppercase" }}>Demo: View as →</span>
        <div style={{ display: "flex", gap: 4, background: "#f4f5f7", borderRadius: 10, padding: 4, border: "1px solid #e8ebee" }}>
          {tabs.map(t => (
            <button key={t.id}
              onClick={() => setView(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
                borderRadius: 7,
                border: view === t.id ? "1.5px solid #0066ff" : "1.5px solid transparent",
                background: view === t.id ? "#ffffff" : "none",
                fontSize: 12.5, fontWeight: 500,
                color: view === t.id ? "#08090b" : "#64707f",
                cursor: "pointer", transition: "all 0.15s",
              }}>
              <span style={{ fontSize: 13 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Live wallet status */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {connected && shortAddr ? (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "Geist Mono, monospace", fontSize: 9.5, color: "#8e98a6" }}>{roleLabel} WALLET</div>
            <div style={{ fontFamily: "Geist Mono, monospace", fontSize: 11, color: "#08090b", fontWeight: 500 }}>{shortAddr}</div>
          </div>
        ) : (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "Geist Mono, monospace", fontSize: 9.5, color: "#8e98a6" }}>WALLET</div>
            <div style={{ fontFamily: "Geist Mono, monospace", fontSize: 11, color: "#bdc4ce", fontWeight: 500 }}>Not connected</div>
          </div>
        )}
        <button
          onClick={handleWalletClick}
          title={connected ? `Connected: ${shortAddr} — click to disconnect` : "Click to connect wallet"}
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: connected ? "#08090b" : "#f4f5f7",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: connected ? "#ffffff" : "#64707f", fontSize: 14,
            border: connected ? "none" : "1px solid #e8ebee",
            cursor: "pointer", transition: "all 0.15s",
          }}>
          {connected ? "◆" : "◇"}
        </button>
      </div>
    </nav>
  );
};

// ─── Root page ─────────────────────────────────────────────────
export default function DashboardPage() {
  useExplicitWalletConnect(); // ← fires for ALL tabs now, not just Employee

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
