"use client";

import { useState, useCallback, useRef } from "react";
import type { DecryptedPayslip, ScanSummary } from "@/types/payslip";
import {
  parseViewingKey,
  scanNotes,
  type ScanProgress,
} from "@/lib/noteScanner";

/**
 * React hook for the Employee Note Scanner.
 *
 * ⚠ ALL DECRYPTION IS CLIENT-SIDE. The viewing key and decrypted
 * payslip data NEVER leave the browser. The hook only communicates
 * with the public Solana RPC to fetch encrypted commitments.
 *
 * Usage:
 * ```tsx
 * const { scan, cancel, status, progress, payslips, summary, error } = useNoteScanner();
 *
 * // Trigger a scan with a viewing key
 * await scan("base64_or_hex_viewing_key");
 *
 * // Cancel an in-progress scan
 * cancel();
 * ```
 */

export type NoteScannerStatus =
  | "idle"
  | "parsing_key"
  | "scanning"
  | "complete"
  | "cancelled"
  | "error";

export interface NoteScannerResult {
  /** Start a scan with the given viewing key string */
  scan: (viewingKeyInput: string) => Promise<void>;

  /** Cancel an in-progress scan */
  cancel: () => void;

  /** Current scanner status */
  status: NoteScannerStatus;

  /** Granular progress info during scanning */
  progress: ScanProgress | null;

  /** Successfully decrypted payslips */
  payslips: DecryptedPayslip[];

  /** Scan summary statistics */
  summary: ScanSummary | null;

  /** Error message if scan failed */
  error: string | null;
}

export function useNoteScanner(): NoteScannerResult {
  const [status, setStatus] = useState<NoteScannerStatus>("idle");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [payslips, setPayslips] = useState<DecryptedPayslip[]>([]);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // AbortController for cancellation
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStatus("cancelled");
    setProgress(null);
  }, []);

  const scan = useCallback(
    async (viewingKeyInput: string) => {
      // Cancel any existing scan
      if (abortRef.current) {
        abortRef.current.abort();
      }

      // Reset state
      setError(null);
      setPayslips([]);
      setSummary(null);
      setProgress(null);

      // Create new AbortController
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // ─── Step 1: Parse the viewing key ────────────────────
        setStatus("parsing_key");

        let viewingKeyNk: Uint8Array;
        try {
          viewingKeyNk = parseViewingKey(viewingKeyInput);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Invalid viewing key";
          setError(msg);
          setStatus("error");
          return;
        }

        // ─── Step 2: Scan notes ──────────────────────────────
        setStatus("scanning");

        // The scanner fetches encrypted notes from the Cloak relay,
        // not the Solana RPC directly — the relay indexes the shielded pool
        const relayUrl =
          process.env.NEXT_PUBLIC_CLOAK_RELAY_URL ||
          "https://api.cloak.ag";

        const result = await scanNotes(
          viewingKeyNk,
          relayUrl,
          (p) => setProgress(p),
          controller.signal
        );

        // Check if cancelled during scan
        if (controller.signal.aborted) {
          setStatus("cancelled");
          return;
        }

        // ─── Step 3: Store results ───────────────────────────
        setPayslips(result.payslips);
        setSummary(result.summary);
        setStatus("complete");
      } catch (err) {
        if (controller.signal.aborted) {
          setStatus("cancelled");
          return;
        }

        const msg = err instanceof Error ? err.message : "Scan failed";
        setError(msg);
        setStatus("error");
        console.error("[NoteScanner] Scan failed:", err);
      } finally {
        // Clean up controller if it's still the active one
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    []
  );

  return {
    scan,
    cancel,
    status,
    progress,
    payslips,
    summary,
    error,
  };
}
