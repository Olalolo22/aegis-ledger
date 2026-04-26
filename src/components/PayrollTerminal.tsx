"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/**
 * Hacker-style terminal UI component that streams payroll execution logs
 * via Server-Sent Events from /api/payroll/stream.
 *
 * Visually proves that amounts and recipient addresses are never exposed —
 * only commitment hashes and transaction signatures.
 */
export default function PayrollTerminal() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const initTerminal = useCallback(() => {
    if (!terminalRef.current || termRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#0b0e14",
        foreground: "#a8b2c0",
        cursor: "#6366f1",
        cursorAccent: "#0b0e14",
        selectionBackground: "rgba(99, 102, 241, 0.3)",
        black: "#0b0e14",
        red: "#ef4444",
        green: "#10b981",
        yellow: "#f59e0b",
        blue: "#6366f1",
        magenta: "#8b5cf6",
        cyan: "#06b6d4",
        white: "#f0f6fc",
        brightBlack: "#484f58",
        brightRed: "#ff6b6b",
        brightGreen: "#34d399",
        brightYellow: "#fbbf24",
        brightBlue: "#818cf8",
        brightMagenta: "#a78bfa",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
      fontSize: 13,
      fontFamily: "var(--font-geist-mono), 'JetBrains Mono', 'Fira Code', monospace",
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 1000,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);

    // Small delay for DOM to settle
    setTimeout(() => fitAddon.fit(), 50);

    // Handle resize
    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    // Welcome message
    term.writeln("\x1b[38;5;245m Aegis Ledger — Zero-Knowledge Payroll Terminal\x1b[0m");
    term.writeln("\x1b[38;5;245m Press \"Execute Payroll\" to stream a simulated batch run.\x1b[0m");
    term.writeln("");

    termRef.current = term;

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const cleanup = initTerminal();
    return () => {
      cleanup?.();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [initTerminal]);

  const executePayroll = useCallback(() => {
    const term = termRef.current;
    if (!term || isRunning) return;

    setIsRunning(true);
    setIsDone(false);
    term.clear();

    const eventSource = new EventSource("/api/payroll/stream");

    eventSource.onmessage = (event) => {
      const line = JSON.parse(event.data) as string;
      if (line === "__DONE__") {
        eventSource.close();
        setIsRunning(false);
        setIsDone(true);
        return;
      }
      term.writeln(line);
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsRunning(false);
      setIsDone(true);
      term.writeln(
        "\x1b[38;5;196m[ERROR] Stream connection lost.\x1b[0m"
      );
    };
  }, [isRunning]);

  return (
    <div>
      <div className="terminal-container scanlines" style={{ position: "relative" }}>
        <div className="terminal-header">
          <div className="terminal-dot red" />
          <div className="terminal-dot yellow" />
          <div className="terminal-dot green" />
          <span className="terminal-title">
            aegis-ledger — solana payroll engine
          </span>
          <div style={{ flex: 1 }} />
          {isRunning && (
            <span className="badge badge-amber">
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span>
              STREAMING
            </span>
          )}
          {isDone && !isRunning && (
            <span className="badge badge-green">✓ COMPLETE</span>
          )}
        </div>
        <div className="terminal-body" ref={terminalRef} />
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        <button
          className="btn-primary"
          onClick={executePayroll}
          disabled={isRunning}
        >
          {isRunning ? (
            <>
              <span className="spinner" />
              Executing...
            </>
          ) : (
            <>
              ▶ Execute Payroll
            </>
          )}
        </button>

        {isDone && (
          <a href="/audit" className="btn-ghost">
            🔑 Open Audit Portal →
          </a>
        )}
      </div>
    </div>
  );
}
