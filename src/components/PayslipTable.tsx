"use client";

import type { DecryptedPayslip, ScanSummary } from "@/types/payslip";
import type { ScanProgress } from "@/lib/noteScanner";
import type { NoteScannerStatus } from "@/hooks/useNoteScanner";

/**
 * Payslip results table component.
 *
 * Displays decrypted payslip notes in a premium glass-morphism table
 * with scan progress indicator, summary statistics, and empty states.
 *
 * ⚠ All displayed data is client-side only — never transmitted to any server.
 */

interface PayslipTableProps {
  payslips: DecryptedPayslip[];
  summary: ScanSummary | null;
  progress: ScanProgress | null;
  status: NoteScannerStatus;
  error: string | null;
  onCancel?: () => void;
}

export default function PayslipTable({
  payslips,
  summary,
  progress,
  status,
  error,
  onCancel,
}: PayslipTableProps) {
  // ─── Error State ──────────────────────────────────────────
  if (status === "error" && error) {
    return (
      <div
        className="glass-card"
        style={{
          padding: 24,
          borderColor: "rgba(239, 68, 68, 0.3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>❌</span>
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--accent-red)",
                marginBottom: 4,
              }}
            >
              Scan Failed
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {error}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Scanning Progress ────────────────────────────────────
  if (status === "scanning" && progress) {
    const pct =
      progress.total > 0
        ? Math.round((progress.current / progress.total) * 100)
        : 0;

    return (
      <div className="glass-card" style={{ padding: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="spinner" />
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {progress.phase === "fetching"
                ? "Fetching Commitments..."
                : "Decrypting Notes..."}
            </span>
          </div>
          {onCancel && (
            <button
              className="btn-ghost"
              onClick={onCancel}
              style={{ padding: "6px 14px", fontSize: 12 }}
            >
              ✕ Cancel
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div
          style={{
            width: "100%",
            height: 6,
            background: "rgba(255, 255, 255, 0.05)",
            borderRadius: 3,
            overflow: "hidden",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "var(--gradient-primary)",
              borderRadius: 3,
              transition: "width 0.3s ease",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <span>{progress.message}</span>
          <span>
            {progress.decryptedSoFar > 0 && (
              <span style={{ color: "var(--accent-green)" }}>
                {progress.decryptedSoFar} found
              </span>
            )}
          </span>
        </div>
      </div>
    );
  }

  // ─── Cancelled State ──────────────────────────────────────
  if (status === "cancelled") {
    return (
      <div className="glass-card" style={{ padding: 24, textAlign: "center" }}>
        <span style={{ fontSize: 24, marginBottom: 8, display: "block" }}>
          ⏹
        </span>
        <div
          style={{
            fontSize: 14,
            color: "var(--text-secondary)",
            fontWeight: 500,
          }}
        >
          Scan cancelled.
        </div>
      </div>
    );
  }

  // ─── Idle State ───────────────────────────────────────────
  if (status === "idle" || status === "parsing_key") {
    return null; // Don't show anything before first scan
  }

  // ─── Results ──────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ─── Summary Cards ─────────────────────────────────── */}
      {summary && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <div className="glass-card" style={{ padding: 16 }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginBottom: 4,
                fontWeight: 600,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
              }}
            >
              Commitments Scanned
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: "var(--text-primary)",
              }}
            >
              {summary.totalCommitments.toLocaleString()}
            </div>
          </div>

          <div className="glass-card" style={{ padding: 16 }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginBottom: 4,
                fontWeight: 600,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
              }}
            >
              Payslips Found
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: "var(--accent-green)",
              }}
            >
              {summary.decryptedCount}
            </div>
          </div>

          <div className="glass-card" style={{ padding: 16 }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginBottom: 4,
                fontWeight: 600,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
              }}
            >
              Scan Duration
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: "var(--accent-primary)",
              }}
            >
              {(summary.scanDurationMs / 1000).toFixed(1)}s
            </div>
          </div>

          {/* Per-token totals */}
          {Object.entries(summary.totalAmountByToken).map(
            ([token, amount]) => (
              <div className="glass-card" style={{ padding: 16 }} key={token}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginBottom: 4,
                    fontWeight: 600,
                    letterSpacing: "0.5px",
                    textTransform: "uppercase",
                  }}
                >
                  Total {token}
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: "var(--accent-cyan)",
                  }}
                >
                  {amount}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* ─── Empty State ───────────────────────────────────── */}
      {payslips.length === 0 && status === "complete" && (
        <div
          className="glass-card"
          style={{ padding: 32, textAlign: "center" }}
        >
          <span style={{ fontSize: 40, display: "block", marginBottom: 12 }}>
            🔒
          </span>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            No Payslips Found
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              maxWidth: 400,
              margin: "0 auto",
              lineHeight: 1.6,
            }}
          >
            No notes in the shielded pool could be decrypted with this viewing
            key. This may mean the key is scoped to a different time period, or
            no payments have been made to the associated stealth address yet.
          </div>
        </div>
      )}

      {/* ─── Payslip Table ─────────────────────────────────── */}
      {payslips.length > 0 && (
        <div className="glass-card" style={{ overflow: "hidden" }}>
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--border-glass)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              📄 Decrypted Payslips
            </div>
            <span className="badge badge-green" style={{ fontSize: 11 }}>
              🔐 Client-side only
            </span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--border-glass)",
                  }}
                >
                  {["#", "Amount", "Token", "Date", "Memo", "Commitment"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          padding: "12px 16px",
                          textAlign: "left",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--text-muted)",
                          letterSpacing: "0.5px",
                          textTransform: "uppercase",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {payslips.map((p, i) => (
                  <tr
                    key={p.id}
                    style={{
                      borderBottom: "1px solid var(--border-glass)",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLElement).style.background =
                        "rgba(99, 102, 241, 0.03)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLElement).style.background =
                        "transparent")
                    }
                  >
                    <td
                      style={{
                        padding: "12px 16px",
                        color: "var(--text-muted)",
                        fontFamily:
                          "var(--font-geist-mono), monospace",
                      }}
                    >
                      {i + 1}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        fontWeight: 700,
                        color: "var(--accent-green)",
                        fontFamily:
                          "var(--font-geist-mono), monospace",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.amountFormatted}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className="badge badge-indigo" style={{ fontSize: 11, padding: "2px 8px" }}>
                        {p.tokenSymbol}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        color: "var(--text-secondary)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.date
                        ? new Date(p.date).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        color: "var(--text-secondary)",
                        maxWidth: 200,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={p.memo || undefined}
                    >
                      {p.memo || "—"}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        color: "var(--text-muted)",
                        fontFamily:
                          "var(--font-geist-mono), monospace",
                        fontSize: 11,
                        maxWidth: 160,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={p.commitmentHash}
                    >
                      {p.commitmentHash.length > 16
                        ? `${p.commitmentHash.slice(0, 8)}...${p.commitmentHash.slice(-6)}`
                        : p.commitmentHash}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
