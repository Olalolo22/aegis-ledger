"use client";

import { useState, useCallback } from "react";
import { usePrivateSwap, type PrivateSwapStatus } from "@/hooks/usePrivateSwap";

/**
 * Private Swap Interface — SOL → USDC via Cloak shielded pool + Orca DEX.
 *
 * Provides inputs for "Amount to Swap" and "Slippage," displays the
 * Orca quote, and a button that triggers the ZK-proven private swap.
 *
 * While the WASM prover runs, displays precise loading states.
 *
 * ⚠ All ZK proving and signing happens in the browser.
 */

interface PrivateSwapPanelProps {
  orgId: string;
}

/** Human-readable status labels */
const STATUS_LABELS: Record<PrivateSwapStatus, string> = {
  idle: "Ready",
  quoting: "Fetching Orca quote...",
  initializing_wasm: "Loading ZK prover...",
  proving: "Executing Client-Side ZK Proof...",
  signing: "Approve in your wallet...",
  broadcasting: "Broadcasting to Solana...",
  confirming: "Confirming swap...",
  success: "Swap Complete ✓",
  error: "Swap Failed",
};

/** Status → accent color */
const STATUS_COLORS: Record<PrivateSwapStatus, string> = {
  idle: "var(--text-muted)",
  quoting: "var(--accent-cyan)",
  initializing_wasm: "var(--accent-cyan)",
  proving: "var(--accent-primary)",
  signing: "var(--accent-orange, #f59e0b)",
  broadcasting: "var(--accent-cyan)",
  confirming: "var(--accent-cyan)",
  success: "var(--accent-green)",
  error: "var(--accent-red)",
};

export default function PrivateSwapPanel({ orgId }: PrivateSwapPanelProps) {
  const [amountSol, setAmountSol] = useState("");
  const [slippageBps, setSlippageBps] = useState("100"); // default 1%

  const {
    execute,
    status,
    isProving,
    proofProgress,
    error,
    swapId,
    txSignature,
    quote,
  } = usePrivateSwap();

  const isActive =
    status !== "idle" && status !== "success" && status !== "error";

  const handleSwap = useCallback(() => {
    const lamports = Math.floor(parseFloat(amountSol || "0") * 1e9);
    if (lamports <= 0) return;

    execute({
      org_id: orgId,
      amount_lamports: lamports.toString(),
      slippage_bps: parseInt(slippageBps) || 100,
    });
  }, [amountSol, slippageBps, orgId, execute]);

  const estimatedUsdc = quote
    ? (Number(quote.estimatedOutputAmount) / 1e6).toFixed(2)
    : null;

  const minUsdc = quote
    ? (Number(quote.minOutputAmount) / 1e6).toFixed(2)
    : null;

  return (
    <div className="glass-card" style={{ overflow: "hidden" }}>
      {/* ─── Header ─────────────────────────────────── */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border-glass)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔄</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            Private Swap — SOL → USDC
          </span>
        </div>
        <span className="badge badge-indigo" style={{ fontSize: 10 }}>
          Orca + Cloak
        </span>
      </div>

      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* ─── Amount Input ──────────────────────────── */}
        <div>
          <label
            htmlFor="swap-amount"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-secondary)",
              marginBottom: 6,
              display: "block",
            }}
          >
            Amount (SOL)
          </label>
          <div style={{ position: "relative" }}>
            <input
              id="swap-amount"
              type="number"
              step="0.01"
              min="0.001"
              value={amountSol}
              onChange={(e) => setAmountSol(e.target.value)}
              placeholder="0.00"
              disabled={isActive}
              style={{
                width: "100%",
                padding: "12px 60px 12px 16px",
                background: "rgba(7, 8, 15, 0.6)",
                border: "1px solid var(--border-glass)",
                borderRadius: 10,
                color: "var(--text-primary)",
                fontSize: 16,
                fontFamily: "var(--font-geist-mono), monospace",
                fontWeight: 700,
                outline: "none",
                transition: "border-color 0.2s",
              }}
            />
            <span
              style={{
                position: "absolute",
                right: 16,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-muted)",
              }}
            >
              SOL
            </span>
          </div>
        </div>

        {/* ─── Slippage Input ────────────────────────── */}
        <div>
          <label
            htmlFor="swap-slippage"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-secondary)",
              marginBottom: 6,
              display: "block",
            }}
          >
            Slippage Tolerance
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            {["50", "100", "200", "500"].map((bps) => (
              <button
                key={bps}
                type="button"
                onClick={() => setSlippageBps(bps)}
                disabled={isActive}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: `1px solid ${
                    slippageBps === bps
                      ? "rgba(99, 102, 241, 0.5)"
                      : "var(--border-glass)"
                  }`,
                  background:
                    slippageBps === bps
                      ? "rgba(99, 102, 241, 0.1)"
                      : "rgba(7, 8, 15, 0.4)",
                  color:
                    slippageBps === bps
                      ? "var(--accent-primary)"
                      : "var(--text-secondary)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: isActive ? "not-allowed" : "pointer",
                  transition: "all 0.15s",
                }}
              >
                {(Number(bps) / 100).toFixed(1)}%
              </button>
            ))}
            <input
              id="swap-slippage"
              type="number"
              min="1"
              max="5000"
              value={slippageBps}
              onChange={(e) => setSlippageBps(e.target.value)}
              disabled={isActive}
              style={{
                width: 70,
                padding: "8px 10px",
                background: "rgba(7, 8, 15, 0.6)",
                border: "1px solid var(--border-glass)",
                borderRadius: 8,
                color: "var(--text-primary)",
                fontSize: 12,
                fontFamily: "var(--font-geist-mono), monospace",
                textAlign: "center",
                outline: "none",
              }}
            />
            <span
              style={{
                alignSelf: "center",
                fontSize: 11,
                color: "var(--text-muted)",
              }}
            >
              bps
            </span>
          </div>
        </div>

        {/* ─── Quote Display ─────────────────────────── */}
        {quote && (
          <div
            style={{
              padding: 14,
              background: "rgba(16, 185, 129, 0.04)",
              borderRadius: 10,
              border: "1px solid rgba(16, 185, 129, 0.15)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Estimated Output
              </span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--accent-green)",
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                ~{estimatedUsdc} USDC
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Minimum Output
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                ≥{minUsdc} USDC
              </span>
            </div>
            {quote.priceImpactPct > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  Price Impact
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color:
                      quote.priceImpactPct > 1
                        ? "var(--accent-red)"
                        : "var(--text-muted)",
                    fontFamily: "var(--font-geist-mono), monospace",
                  }}
                >
                  {quote.priceImpactPct.toFixed(4)}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* ─── Status / Progress ──────────────────────── */}
        {status !== "idle" && (
          <div
            style={{
              padding: 14,
              borderRadius: 10,
              background:
                status === "error"
                  ? "rgba(239, 68, 68, 0.05)"
                  : status === "success"
                    ? "rgba(16, 185, 129, 0.05)"
                    : "rgba(99, 102, 241, 0.05)",
              border: `1px solid ${
                status === "error"
                  ? "rgba(239, 68, 68, 0.2)"
                  : status === "success"
                    ? "rgba(16, 185, 129, 0.2)"
                    : "rgba(99, 102, 241, 0.15)"
              }`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: proofProgress ? 8 : 0,
              }}
            >
              {isActive && <span className="spinner" />}
              {status === "success" && <span style={{ fontSize: 16 }}>✓</span>}
              {status === "error" && <span style={{ fontSize: 16 }}>✕</span>}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: STATUS_COLORS[status],
                }}
              >
                {STATUS_LABELS[status]}
              </span>
            </div>

            {proofProgress && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  lineHeight: 1.5,
                }}
              >
                {proofProgress}
              </div>
            )}

            {error && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--accent-red)",
                  marginTop: 4,
                }}
              >
                {error}
              </div>
            )}

            {txSignature && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 6,
                  fontFamily: "var(--font-geist-mono), monospace",
                  wordBreak: "break-all",
                }}
              >
                TX:{" "}
                <a
                  href={`https://solscan.io/tx/${txSignature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent-cyan)", textDecoration: "none" }}
                >
                  {txSignature.slice(0, 20)}...{txSignature.slice(-8)}
                </a>
              </div>
            )}
          </div>
        )}

        {/* ─── Swap Button ────────────────────────────── */}
        <button
          onClick={handleSwap}
          disabled={isActive || !amountSol || parseFloat(amountSol) <= 0}
          className="btn-primary"
          style={{
            width: "100%",
            padding: "14px 20px",
            fontSize: 14,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {isProving ? (
            <>
              <span className="spinner" />
              Executing Client-Side ZK Proof...
            </>
          ) : isActive ? (
            <>
              <span className="spinner" />
              {STATUS_LABELS[status]}
            </>
          ) : status === "success" ? (
            <>🔄 Swap Again</>
          ) : (
            <>⚡ Execute Private Swap</>
          )}
        </button>

        {/* ─── Security note ──────────────────────────── */}
        <div
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          ZK proof generated in your browser via WASM. Transaction signed by
          your wallet. No keys or plaintext data leave your device.
        </div>
      </div>
    </div>
  );
}
