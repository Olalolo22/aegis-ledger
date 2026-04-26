"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

// Dynamic import for xterm.js (no SSR — requires DOM)
const PayrollTerminal = dynamic(
  () => import("@/components/PayrollTerminal"),
  { ssr: false }
);

export default function DashboardPage() {
  return (
    <div className="page-container">
      <div className="page-content">
        {/* ─── Navigation ─────────────────────────────────── */}
        <nav className="nav-bar">
          <div className="nav-logo">
            <div className="nav-logo-icon">⟐</div>
            <span className="nav-logo-text">Aegis Ledger</span>
          </div>
          <div className="nav-links">
            <span className="badge badge-green">● Mainnet</span>
            <Link href="/audit" className="btn-ghost">
              🔑 Audit Portal
            </Link>
          </div>
        </nav>

        {/* ─── Hero ───────────────────────────────────────── */}
        <div className="animate-fade-in" style={{ marginBottom: 40 }}>
          <h1 className="section-title" style={{ fontSize: 36, marginBottom: 8 }}>
            Zero-Knowledge Payroll Engine
          </h1>
          <p className="section-subtitle" style={{ maxWidth: 600, fontSize: 15 }}>
            Execute batch USDC payrolls where amounts and recipient addresses are
            cryptographically hidden inside Cloak&apos;s shielded pool. Only commitment
            hashes and transaction signatures are publicly visible.
          </p>
        </div>

        {/* ─── Terminal ───────────────────────────────────── */}
        <div className="animate-fade-in animate-fade-in-delay-1">
          <PayrollTerminal />
        </div>

        {/* ─── Feature Cards ──────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
            marginTop: 40,
          }}
        >
          <div className="glass-card animate-fade-in animate-fade-in-delay-1" style={{ padding: 24 }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🔐</div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              Shielded Transfers
            </h3>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Every payment passes through Cloak&apos;s ZK shielded pool. Amounts and
              destinations are hidden on-chain — only UTXO commitment hashes are public.
            </p>
          </div>

          <div className="glass-card animate-fade-in animate-fade-in-delay-2" style={{ padding: 24 }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⚡</div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              Atomic Mutex Locks
            </h3>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Redis SET NX with atomic Lua release prevents concurrent UTXO selection.
              No double-spending, no race conditions — enterprise-grade concurrency.
            </p>
          </div>

          <div className="glass-card animate-fade-in animate-fade-in-delay-3" style={{ padding: 24 }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🔑</div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              Dynamic Audit Portal
            </h3>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Time-scoped viewing keys let regulators selectively decrypt a subgraph
              of financial history — without exposing the entire ledger.
            </p>
          </div>
        </div>

        {/* ─── Footer ─────────────────────────────────────── */}
        <div
          style={{
            marginTop: 60,
            paddingTop: 24,
            borderTop: "1px solid var(--border-glass)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Aegis Ledger — Colosseum Frontier · Cloak Track
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Built with Cloak Protocol · Solana · Next.js
          </span>
        </div>
      </div>
    </div>
  );
}
