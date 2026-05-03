"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

// Dynamic imports (no SSR — require DOM / wallet context / WASM)
const PrivateSwapPanel = dynamic(
  () => import("@/components/PrivateSwapPanel"),
  { ssr: false }
);
const WalletButton = dynamic(
  () => import("@/components/WalletButton"),
  { ssr: false }
);

/**
 * /swap — Private Swap Page
 *
 * Allows DAO admins to swap SOL → USDC privately through
 * the Cloak shielded pool, routed via Orca DEX.
 *
 * All ZK proving and signing happens client-side.
 */
export default function SwapPage() {
  // Using a placeholder org_id for the demo — in production,
  // this would come from the authenticated admin's session context.
  const demoOrgId = "00000000-0000-0000-0000-000000000001";

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
            <Link href="/verify" className="btn-ghost">
              📄 Verify Payslip
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
            Private Treasury Swap
          </h1>
          <p
            className="section-subtitle"
            style={{ maxWidth: 640, fontSize: 14 }}
          >
            Convert SOL to USDC privately through Cloak&apos;s shielded pool,
            routed natively via Orca DEX. The swap amounts, routing, and
            balances remain cryptographically hidden on-chain.
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
              borderColor: "rgba(99, 102, 241, 0.2)",
              background: "rgba(99, 102, 241, 0.03)",
            }}
          >
            <span style={{ fontSize: 18 }}>⚡</span>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--accent-primary)",
                  marginBottom: 2,
                }}
              >
                CLIENT-SIDE ZK PROVING
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                The Groth16 proof is generated entirely in your browser using WASM.
                The swap transaction is signed by your connected wallet.
                The server acts only as a data coordinator — it never holds keys.
              </div>
            </div>
          </div>
        </div>

        {/* ─── Swap Panel ─────────────────────────────────── */}
        <div
          className="animate-fade-in animate-fade-in-delay-2"
          style={{ maxWidth: 480 }}
        >
          <PrivateSwapPanel orgId={demoOrgId} />
        </div>

        {/* ─── How It Works ───────────────────────────────── */}
        <div
          className="animate-fade-in animate-fade-in-delay-3"
          style={{ marginTop: 40 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
            }}
          >
            <div className="glass-card" style={{ padding: 20 }}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>📊</div>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                1. Get Quote
              </h3>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                Server fetches the Orca/Jupiter DEX quote and locks
                your shielded SOL UTXOs via Redis mutex.
              </p>
            </div>

            <div className="glass-card" style={{ padding: 20 }}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>🔐</div>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                2. ZK Proof
              </h3>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                Your browser generates a Groth16 ZK proof (WASM),
                proving ownership of the shielded SOL notes.
              </p>
            </div>

            <div className="glass-card" style={{ padding: 20 }}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>🔄</div>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                3. Shielded Swap
              </h3>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                SOL exits the pool, routes through Orca, and USDC
                arrives in your wallet — all in one atomic TX.
              </p>
            </div>

            <div className="glass-card" style={{ padding: 20 }}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>✅</div>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                4. Confirm
              </h3>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                Transaction signature is recorded on the server for
                audit compliance — no amount or routing data exposed.
              </p>
            </div>
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
