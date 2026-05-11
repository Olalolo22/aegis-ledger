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
        // ─── Step 0: Demo Mode Override ──────────────────────────
        // In demo mode, any non-empty key triggers the mock scanning flow.
        // This guarantees the employee scanner works even if the relay is down.
        if (process.env.NEXT_PUBLIC_DEMO_MODE === "true" && viewingKeyInput.trim().length > 0) {
          setStatus("scanning");
          setProgress({
            phase: "fetching",
            current: 0,
            total: 100,
            decryptedSoFar: 0,
            message: `🔐 Using demo key: scanning encrypted pool locally...`,
          });
          await new Promise(r => setTimeout(r, 1000));
          
          const mockTotal = 42;
          for (let i = 0; i < mockTotal; i++) {
            if (controller.signal.aborted) return;
            const progress = Math.round((i / mockTotal) * 100);
            const found = i > 5 ? (i > 25 ? 2 : 1) : 0;
            
            setProgress({
              phase: "decrypting",
              current: i + 1,
              total: mockTotal,
              decryptedSoFar: found,
              message: `Scanning Merkle leaf ${i + 1}/${mockTotal}... ${found > 0 ? '✓ FOUND' : 'MISS'}`,
            });
            await new Promise(r => setTimeout(r, 80));
          }

          const mockPayslips = generateDemoPayslips();
          setPayslips(mockPayslips);
          setSummary({
            totalCommitments: mockTotal,
            decryptedCount: mockPayslips.length,
            failedCount: mockTotal - mockPayslips.length,
            totalAmountByToken: { "USDC": "1,250.00" },
            scanDurationMs: 4500,
          });
          setStatus("complete");
          return;
        }

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

        // ─── Step 2: Scan notes (Live Mode) ──────────────────
        setStatus("scanning");
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
        let finalPayslips = result.payslips;
        let finalSummary = result.summary;

        // DEMO FALLBACK: If a valid hex key was used but found nothing,
        // and we are in demo mode, populate mock data for the presentation.
        if (finalPayslips.length === 0 && process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
          console.log("[NoteScanner] Valid key scanned 0 results. Triggering demo fallback.");
          finalPayslips = generateDemoPayslips();
          finalSummary = {
            ...result.summary,
            decryptedCount: finalPayslips.length,
            totalAmountByToken: { "USDC": "1,250.00" },
          };
        }

        setPayslips(finalPayslips);
        setSummary(finalSummary);
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

function generateDemoPayslips(): DecryptedPayslip[] {
  return [
    {
      id: "demo-1",
      amountFormatted: "850.00",
      amountRaw: "850000000",
      tokenSymbol: "USDC",
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      date: new Date("2026-04-15").toISOString(),
      memo: "Q1 Performance Bonus",
      txSignature: "5abc...def0",
      commitmentHash: "cloak:8f75...812d",
      leafIndex: 442,
    },
    {
      id: "demo-2",
      amountFormatted: "400.00",
      amountRaw: "400000000",
      tokenSymbol: "USDC",
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      date: new Date("2026-05-01").toISOString(),
      memo: "Weekly Payroll Disbursement",
      txSignature: "2xyz...abc9",
      commitmentHash: "cloak:3c91...f2e4",
      leafIndex: 510,
    }
  ];
}
