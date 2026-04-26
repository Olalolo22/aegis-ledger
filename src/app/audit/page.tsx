"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";

// Dynamic import for ReactFlow (no SSR)
const AuditGraph = dynamic(() => import("@/components/AuditGraph"), {
  ssr: false,
});

type VerifyState =
  | { status: "idle" }
  | { status: "verifying" }
  | { status: "verified"; token: string }
  | { status: "error"; message: string }
  | { status: "demo" };

function AuditPortalContent() {
  const searchParams = useSearchParams();
  const [verifyState, setVerifyState] = useState<VerifyState>({
    status: "idle",
  });

  // Consume magic link token from URL on mount
  const consumeToken = useCallback(async (token: string) => {
    setVerifyState({ status: "verifying" });

    try {
      const res = await fetch(`/api/audit/verify?token=${token}`);
      const data = await res.json();

      if (res.ok && data.access_token) {
        // Store JWT in memory only — never localStorage
        setVerifyState({ status: "verified", token: data.access_token });
      } else {
        setVerifyState({
          status: "error",
          message: data.error || "Verification failed",
        });
      }
    } catch {
      setVerifyState({
        status: "error",
        message: "Network error during verification",
      });
    }
  }, []);

  useEffect(() => {
    const token = searchParams.get("token");
    if (token) {
      consumeToken(token);
    }
  }, [searchParams, consumeToken]);

  const enterDemoMode = () => {
    setVerifyState({ status: "demo" });
  };

  const accessToken =
    verifyState.status === "verified"
      ? verifyState.token
      : verifyState.status === "demo"
        ? "demo-token"
        : null;

  return (
    <div className="page-container">
      <div className="page-content">
        {/* ─── Navigation ─────────────────────────────────── */}
        <nav className="nav-bar">
          <Link href="/" className="nav-logo" style={{ textDecoration: "none" }}>
            <div className="nav-logo-icon">⟐</div>
            <span className="nav-logo-text">Aegis Ledger</span>
          </Link>
          <div className="nav-links">
            <span className="badge badge-indigo">🔑 Audit Portal</span>
            <Link href="/" className="btn-ghost">
              ← Dashboard
            </Link>
          </div>
        </nav>

        {/* ─── Hero ───────────────────────────────────────── */}
        <div className="animate-fade-in" style={{ marginBottom: 32 }}>
          <h1 className="section-title">Dynamic Audit Portal</h1>
          <p className="section-subtitle" style={{ maxWidth: 600 }}>
            Selectively decrypt financial history using a time-scoped viewing key.
            Locked UTXO commitments transform into readable payroll data when the
            viewing key is applied.
          </p>
        </div>

        {/* ─── Verification Status ────────────────────────── */}
        <div
          className="glass-card animate-fade-in animate-fade-in-delay-1"
          style={{ padding: 20, marginBottom: 24 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 24 }}>
                {verifyState.status === "verified"
                  ? "✅"
                  : verifyState.status === "demo"
                    ? "🎮"
                    : verifyState.status === "verifying"
                      ? "⏳"
                      : verifyState.status === "error"
                        ? "❌"
                        : "🔒"}
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {verifyState.status === "verified"
                    ? "Viewing Key Authenticated"
                    : verifyState.status === "demo"
                      ? "Demo Mode — Simulated Data"
                      : verifyState.status === "verifying"
                        ? "Verifying Magic Link..."
                        : verifyState.status === "error"
                          ? "Verification Failed"
                          : "No Magic Link Detected"}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    marginTop: 2,
                  }}
                >
                  {verifyState.status === "verified"
                    ? "JWT stored in memory. Ready to decrypt UTXO commitments."
                    : verifyState.status === "demo"
                      ? "Using simulated payroll data to demonstrate the UI flow."
                      : verifyState.status === "verifying"
                        ? "Consuming single-use magic link token..."
                        : verifyState.status === "error"
                          ? (verifyState as { status: "error"; message: string }).message
                          : "Enter a magic link URL or use demo mode to explore."}
                </div>
              </div>
            </div>

            {verifyState.status === "idle" && (
              <button className="btn-primary" onClick={enterDemoMode}>
                🎮 Enter Demo Mode
              </button>
            )}

            {verifyState.status === "error" && (
              <button className="btn-primary" onClick={enterDemoMode}>
                🎮 Try Demo Mode
              </button>
            )}

            {(verifyState.status === "verified" ||
              verifyState.status === "demo") && (
              <span className="badge badge-green">● Active Session</span>
            )}
          </div>
        </div>

        {/* ─── ReactFlow Graph ────────────────────────────── */}
        <div className="animate-fade-in animate-fade-in-delay-2">
          <AuditGraph accessToken={accessToken} />
        </div>

        {/* ─── Info Panel ─────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
            marginTop: 32,
          }}
        >
          <div
            className="glass-card animate-fade-in animate-fade-in-delay-2"
            style={{ padding: 20 }}
          >
            <div style={{ fontSize: 20, marginBottom: 8 }}>🧬</div>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
              How It Works
            </h3>
            <ol
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                lineHeight: 1.8,
                paddingLeft: 16,
                margin: 0,
              }}
            >
              <li>Org admin generates a time-scoped viewing key</li>
              <li>Key is encrypted with AES-256-GCM at rest</li>
              <li>Auditor receives a single-use magic link</li>
              <li>Magic link returns a signed JWT (stateless)</li>
              <li>JWT authorizes decryption + Cloak chain scan</li>
            </ol>
          </div>

          <div
            className="glass-card animate-fade-in animate-fade-in-delay-3"
            style={{ padding: 20 }}
          >
            <div style={{ fontSize: 20, marginBottom: 8 }}>🛡️</div>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
              Security Guarantees
            </h3>
            <ul
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                lineHeight: 1.8,
                paddingLeft: 16,
                margin: 0,
              }}
            >
              <li>Raw viewing key never leaves the server</li>
              <li>JWT stored in memory only (not localStorage)</li>
              <li>Magic link is single-use (Redis DEL after read)</li>
              <li>Temporal scope enforced at DB + JWT + runtime</li>
              <li>Per-auditor unique identity salt (no global pepper)</li>
            </ul>
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

export default function AuditPage() {
  return (
    <Suspense
      fallback={
        <div className="page-container">
          <div className="page-content" style={{ textAlign: "center", paddingTop: 200 }}>
            <div className="spinner" style={{ margin: "0 auto 16px" }} />
            <p style={{ color: "var(--text-secondary)" }}>
              Loading Audit Portal...
            </p>
          </div>
        </div>
      }
    >
      <AuditPortalContent />
    </Suspense>
  );
}
