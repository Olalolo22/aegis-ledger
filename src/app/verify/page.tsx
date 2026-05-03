"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useNoteScanner } from "@/hooks/useNoteScanner";

// Dynamic imports (no SSR — require DOM / wallet context / WASM)
const ViewingKeyInput = dynamic(
  () => import("@/components/ViewingKeyInput"),
  { ssr: false }
);
const PayslipTable = dynamic(
  () => import("@/components/PayslipTable"),
  { ssr: false }
);
const WalletButton = dynamic(
  () => import("@/components/WalletButton"),
  { ssr: false }
);

/**
 * /verify — Employee Payslip Verification Page
 *
 * Allows payroll recipients to trustlessly verify their payslips
 * by entering their scoped viewing key. All decryption happens
 * entirely in the browser — no data is sent to the server.
 *
 * Flow:
 * 1. Employee pastes their viewing key (hex or base64)
 * 2. Client fetches encrypted note commitments from Solana RPC
 * 3. Client attempts Poseidon-based decryption on each note
 * 4. Successfully decrypted notes are displayed in a formatted table
 */
export default function VerifyPage() {
  const {
    scan,
    cancel,
    status,
    progress,
    payslips,
    summary,
    error,
  } = useNoteScanner();

  const isScanning = status === "scanning" || status === "parsing_key";

  return (
    <div className="page-container">
      <div className="page-content">
        {/* ─── Navigation ─────────────────────────────────── */}
        <nav className="nav-bar">
          <div className="nav-logo">
            <Link
              href="/"
              style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}
            >
              <div className="nav-logo-icon">⟐</div>
              <span className="nav-logo-text">Aegis Ledger</span>
            </Link>
          </div>
          <div className="nav-links">
            <span className="badge badge-green">● Mainnet</span>
            <WalletButton />
            <Link href="/" className="btn-ghost">
              ← Dashboard
            </Link>
            <Link href="/audit" className="btn-ghost">
              🔑 Audit Portal
            </Link>
          </div>
        </nav>

        {/* ─── Hero ───────────────────────────────────────── */}
        <div className="animate-fade-in" style={{ marginBottom: 32 }}>
          <h1
            className="section-title"
            style={{ fontSize: 32, marginBottom: 8 }}
          >
            Employee Payslip Verification
          </h1>
          <p
            className="section-subtitle"
            style={{ maxWidth: 640, fontSize: 14 }}
          >
            Verify your payroll disbursements trustlessly. Paste your scoped
            viewing key below — your browser will decrypt matching notes
            directly from the Cloak shielded pool. No data leaves your device.
          </p>
        </div>

        {/* ─── Security Banner ────────────────────────────── */}
        <div
          className="animate-fade-in animate-fade-in-delay-1"
          style={{ marginBottom: 24 }}
        >
          <div
            className="glass-card"
            style={{
              padding: "14px 20px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              borderColor: "rgba(16, 185, 129, 0.2)",
              background: "rgba(16, 185, 129, 0.03)",
            }}
          >
            <span style={{ fontSize: 18 }}>🛡️</span>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--accent-green)",
                  marginBottom: 2,
                }}
              >
                CLIENT-SIDE DECRYPTION ONLY
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                Your viewing key and decrypted payslip data are processed
                entirely in your browser using Cloak&apos;s WASM cryptographic
                primitives. Nothing is transmitted to any server. The key
                never leaves JavaScript memory.
              </div>
            </div>
          </div>
        </div>

        {/* ─── Viewing Key Input ──────────────────────────── */}
        <div
          className="animate-fade-in animate-fade-in-delay-2"
          style={{ marginBottom: 24 }}
        >
          <ViewingKeyInput
            onSubmit={(key) => scan(key)}
            disabled={false}
            isScanning={isScanning}
          />
        </div>

        {/* ─── Cancel Button (during scan) ────────────────── */}
        {isScanning && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginBottom: 8,
            }}
          >
            <button
              className="btn-ghost"
              onClick={cancel}
              style={{ fontSize: 12, padding: "6px 14px" }}
            >
              ⏹ Cancel Scan
            </button>
          </div>
        )}

        {/* ─── Results ────────────────────────────────────── */}
        <div className="animate-fade-in animate-fade-in-delay-3">
          <PayslipTable
            payslips={payslips}
            summary={summary}
            progress={progress}
            status={status}
            error={error}
            onCancel={cancel}
          />
        </div>

        {/* ─── How It Works ───────────────────────────────── */}
        {status === "idle" && (
          <div
            className="animate-fade-in animate-fade-in-delay-3"
            style={{ marginTop: 40 }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 16,
              }}
            >
              <div
                className="glass-card"
                style={{ padding: 20 }}
              >
                <div style={{ fontSize: 24, marginBottom: 10 }}>📥</div>
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  1. Paste Your Key
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  Your employer provides a scoped viewing key (hex or base64)
                  that grants read-only access to your payment notes.
                </p>
              </div>

              <div
                className="glass-card"
                style={{ padding: 20 }}
              >
                <div style={{ fontSize: 24, marginBottom: 10 }}>🔐</div>
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  2. Local Decryption
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  Your browser fetches encrypted commitments from the blockchain
                  and attempts Poseidon-based decryption using WASM — locally.
                </p>
              </div>

              <div
                className="glass-card"
                style={{ padding: 20 }}
              >
                <div style={{ fontSize: 24, marginBottom: 10 }}>📊</div>
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  3. View Payslips
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  Decrypted notes show amounts, tokens, dates, and memos —
                  trustlessly verified without any server involvement.
                </p>
              </div>
            </div>
          </div>
        )}

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
