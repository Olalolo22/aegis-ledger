"use client";

import { useState, useCallback, useRef, useEffect } from "react";

/**
 * Scoped Viewing Key input component.
 *
 * Provides a secure input field for employees to paste their viewing key.
 * The key is held exclusively in React state — never sent to the server.
 *
 * Supports:
 * - Hex (64 chars) and Base64 formats
 * - Show/hide toggle for the key
 * - Paste button for clipboard
 * - Format auto-detection badge
 * - Clear button
 */

interface ViewingKeyInputProps {
  onSubmit: (viewingKey: string) => void;
  disabled?: boolean;
  isScanning?: boolean;
}

export default function ViewingKeyInput({
  onSubmit,
  disabled = false,
  isScanning = false,
}: ViewingKeyInputProps) {
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-detect key format
  const keyFormat = (() => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return "hex";
    try {
      if (atob(trimmed).length === 32) return "base64";
    } catch {
      /* not base64 */
    }
    if (trimmed.length > 0) return "invalid";
    return null;
  })();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (value.trim() && keyFormat !== "invalid") {
        onSubmit(value.trim());
      }
    },
    [value, keyFormat, onSubmit]
  );

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setValue(text.trim());
      inputRef.current?.focus();
    } catch {
      // Clipboard access denied — user can paste manually
    }
  }, []);

  const handleClear = useCallback(() => {
    setValue("");
    setRevealed(false);
    inputRef.current?.focus();
  }, []);

  // Mask the key unless revealed
  const displayValue = revealed ? value : value ? "•".repeat(Math.min(value.length, 48)) : "";

  return (
    <form onSubmit={handleSubmit} style={{ width: "100%" }}>
      <div
        className="glass-card"
        style={{
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Label Row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <label
            htmlFor="viewing-key-input"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-secondary)",
              letterSpacing: "0.3px",
            }}
          >
            🔑 Scoped Viewing Key
          </label>
          {keyFormat && (
            <span
              className={`badge ${keyFormat === "invalid" ? "badge-red" : "badge-green"}`}
              style={{ fontSize: 10, padding: "2px 8px" }}
            >
              {keyFormat === "hex"
                ? "HEX-64"
                : keyFormat === "base64"
                  ? "BASE64"
                  : "INVALID FORMAT"}
            </span>
          )}
        </div>

        {/* Input Row */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div
            style={{
              flex: 1,
              position: "relative",
              display: "flex",
              alignItems: "center",
            }}
          >
            <input
              id="viewing-key-input"
              ref={inputRef}
              type={revealed ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste your hex or base64 viewing key..."
              disabled={disabled || isScanning}
              autoComplete="off"
              spellCheck={false}
              style={{
                width: "100%",
                padding: "12px 80px 12px 16px",
                background: "rgba(7, 8, 15, 0.6)",
                border: `1px solid ${
                  keyFormat === "invalid"
                    ? "rgba(239, 68, 68, 0.4)"
                    : value
                      ? "rgba(99, 102, 241, 0.3)"
                      : "var(--border-glass)"
                }`,
                borderRadius: 10,
                color: "var(--text-primary)",
                fontSize: 13,
                fontFamily:
                  "var(--font-geist-mono), 'JetBrains Mono', monospace",
                outline: "none",
                transition: "border-color 0.2s",
              }}
            />

            {/* Inline controls */}
            <div
              style={{
                position: "absolute",
                right: 8,
                display: "flex",
                gap: 4,
                alignItems: "center",
              }}
            >
              {value && (
                <button
                  type="button"
                  onClick={() => setRevealed(!revealed)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 14,
                    padding: "4px",
                  }}
                  title={revealed ? "Hide key" : "Show key"}
                >
                  {revealed ? "🙈" : "👁"}
                </button>
              )}
              {value && (
                <button
                  type="button"
                  onClick={handleClear}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    padding: "4px",
                  }}
                  title="Clear"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Paste button */}
          <button
            type="button"
            onClick={handlePaste}
            className="btn-ghost"
            disabled={disabled || isScanning}
            style={{ padding: "10px 14px", fontSize: 13, whiteSpace: "nowrap" }}
          >
            📋 Paste
          </button>
        </div>

        {/* Submit Row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="submit"
            className="btn-primary"
            disabled={disabled || isScanning || !value.trim() || keyFormat === "invalid"}
            style={{ flex: "none" }}
          >
            {isScanning ? (
              <>
                <span className="spinner" />
                Scanning...
              </>
            ) : (
              <>🔍 Scan My Payslips</>
            )}
          </button>

          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              lineHeight: 1.4,
            }}
          >
            Your key is processed entirely in your browser. It is never sent to any server.
          </span>
        </div>
      </div>
    </form>
  );
}
