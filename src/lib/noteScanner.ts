/**
 * Client-side Note Scanner — STRICT BROWSER-ONLY MODULE.
 *
 * ⚠ SECURITY INVARIANT: This module runs EXCLUSIVELY in the browser.
 * Decryption keys, plaintext amounts, memos, and all derived data
 * NEVER leave the client. Nothing is transmitted back to the server.
 *
 * Architecture:
 * 1. User inputs their "Scoped Viewing Key" (hex-encoded nk bytes)
 * 2. We derive an x25519 ViewKey from the nk using deriveViewingKeyFromNk()
 * 3. We fetch encrypted note commitments from the Cloak relay/indexer
 * 4. For each encrypted output, we attempt local decryption using
 *    tryDecryptNote() with the derived ViewKey
 * 5. Successfully decrypted notes are parsed into structured DecryptedPayslip objects
 * 6. The results are displayed in the UI — never sent to any server
 *
 * Error Handling:
 * - RPC rate limiting: exponential backoff with jitter
 * - Wrong key: silently skipped (not all commitments belong to the user)
 * - Corrupted notes: logged locally, skipped
 * - Network failures: retries with abort controller
 */

import {
  fetchCommitments,
  tryDecryptNote,
  scanNotesForWallet,
  deriveViewKey,
  bigintToHex,
} from "@cloak.dev/sdk-devnet";
import type { DecryptedPayslip, ScanSummary } from "@/types/payslip";
import { MINT_TO_SYMBOL, TOKEN_DECIMALS } from "@/types/payslip";

// ─── Configuration ──────────────────────────────────────────────

/** Max commitments to scan in a single session */
const MAX_SCAN_COMMITMENTS = 2000;

/** RPC retry config */
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

/** Batch size for processing (prevents main thread blocking) */
const PROCESS_BATCH_SIZE = 50;

/** Delay between batches to avoid locking the UI */
const BATCH_DELAY_MS = 50;

// ─── RPC Helpers ────────────────────────────────────────────────

/**
 * Exponential backoff with jitter for rate-limited RPC calls.
 */
async function sleepWithJitter(attempt: number): Promise<void> {
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * delay * 0.3;
  await new Promise((r) => setTimeout(r, delay + jitter));
}

/**
 * Wraps a fetch operation with retry logic for RPC rate limiting.
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  label: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isRetriable =
        lastError.message.includes("429") ||
        lastError.message.includes("rate") ||
        lastError.message.includes("Too Many Requests") ||
        lastError.message.includes("ECONNRESET") ||
        lastError.message.includes("fetch failed");

      if (isRetriable && attempt < MAX_RETRIES) {
        console.warn(
          `[NoteScanner] ${label}: retriable error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying...`
        );
        await sleepWithJitter(attempt);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error(`${label}: max retries exhausted`);
}

// ─── Viewing Key Parsing ────────────────────────────────────────

/**
 * Parses a user-provided viewing key string into the raw nk bytes.
 *
 * Accepts two formats:
 * 1. Hex-encoded: 64-character hex string → Uint8Array (32 bytes)
 * 2. Base64-encoded: standard base64 string → Uint8Array (32 bytes)
 *
 * @param input - The raw viewing key string from the user
 * @returns 32-byte Uint8Array (nk)
 * @throws If the input is not a valid viewing key format
 */
export function parseViewingKey(input: any): Uint8Array {
  // Ensure we are working with a string to prevent .trim() errors
  const trimmed = String(input || "").trim();

  if (!trimmed) {
    throw new Error("Viewing key cannot be empty");
  }

  // Try hex first (64 hex chars = 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  // Try base64
  try {
    const decoded = atob(trimmed);
    if (decoded.length !== 32) {
      throw new Error(
        `Viewing key must be exactly 32 bytes. Got ${decoded.length} bytes.`
      );
    }
    const bytes = new Uint8Array(32);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    if (e instanceof Error && e.message.includes("32 bytes")) {
      throw e;
    }
    throw new Error(
      "Invalid viewing key format. Expected a 64-character hex string or a base64-encoded 32-byte key."
    );
  }
}

//  Note Formatting 

/**
 * Formats a raw token amount from base units to human-readable string.
 */
function formatTokenAmount(rawAmount: bigint, tokenSymbol: string): string {
  const decimals = TOKEN_DECIMALS[tokenSymbol] ?? 6;
  const divisor = BigInt(10 ** decimals);
  const wholePart = rawAmount / divisor;
  const fractionalPart = rawAmount % divisor;
  const absWhole = wholePart < 0n ? -wholePart : wholePart;
  const absFrac = fractionalPart < 0n ? -fractionalPart : fractionalPart;
  const fracStr = absFrac.toString().padStart(decimals, "0").slice(0, 2);
  return `${absWhole.toLocaleString()}.${fracStr}`;
}

/**
 * Resolves a token mint address to its symbol.
 */
function resolveTokenSymbol(mint: string): string {
  return MINT_TO_SYMBOL[mint] || "UNKNOWN";
}

//  Core Scanner

/**
 * Progress callback for the scan operation.
 */
export interface ScanProgress {
  phase: "fetching" | "decrypting" | "complete" | "error";
  current: number;
  total: number;
  decryptedSoFar: number;
  message: string;
}

export type ScanProgressCallback = (progress: ScanProgress) => void;

/**
 * Scans the Cloak shielded pool for notes decryptable with the given viewing key.
 *
 * ⚠ ALL DECRYPTION HAPPENS LOCALLY. Nothing leaves the browser.
 *
 * Flow:
 * 1. Derive x25519 ViewKey from the raw nk bytes using deriveViewingKeyFromNk()
 * 2. Fetch encrypted note commitments from the Cloak relay
 * 3. For each encrypted output, attempt tryDecryptNote() with the ViewKey
 * 4. Parse decrypted notes into DecryptedPayslip format
 *
 * @param viewingKeyNk - The 32-byte nullifier key (from parseViewingKey)
 * @param relayUrl - The Cloak relay URL (e.g., https://api.cloak.ag)
 * @param onProgress - Optional callback for progress updates
 * @param abortSignal - Optional AbortSignal for cancellation
 * @returns Array of successfully decrypted payslips + scan summary
 */
export async function scanNotes(
  viewingKeyNk: Uint8Array,
  relayUrl: string,
  onProgress?: ScanProgressCallback,
  abortSignal?: AbortSignal
): Promise<{ payslips: DecryptedPayslip[]; summary: ScanSummary }> {
  const startTime = Date.now();

  // ─── Step 1: Derive ViewKey from nk ───────────────────────
  onProgress?.({
    phase: "fetching",
    current: 0,
    total: 0,
    decryptedSoFar: 0,
    message: "Deriving viewing key...",
  });

  let viewKey: ReturnType<typeof deriveViewKey>;
  try {
    // deriveViewKey(nk) → { vk_secret, pvk, vk_secret_hex, pvk_hex }
    // This is the x25519 keypair format that tryDecryptNote expects.
    viewKey = deriveViewKey(viewingKeyNk);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Key derivation failed";
    throw new Error(`Failed to derive viewing key: ${msg}`);
  }

  if (abortSignal?.aborted) throw new Error("Scan cancelled");

  // ─── Step 2: Fetch encrypted commitments from relay ───────
  onProgress?.({
    phase: "fetching",
    current: 0,
    total: 0,
    decryptedSoFar: 0,
    message: "Fetching encrypted notes from Cloak relay...",
  });

  // fetchCommitments(relayUrl, options) → returns an array of
  // encrypted outputs (base64-encoded JSON strings)
  let rawCommitments: unknown;
  try {
    rawCommitments = await withRetry(
      () => fetchCommitments(relayUrl, { limit: MAX_SCAN_COMMITMENTS }),
      "fetchCommitments"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    onProgress?.({
      phase: "error",
      current: 0,
      total: 0,
      decryptedSoFar: 0,
      message: `Failed to fetch commitments: ${msg}`,
    });
    throw new Error(`Failed to fetch note commitments: ${msg}`);
  }

  // The relay returns either an array directly or an object with
  // a nested array — handle both shapes defensively
  const encryptedOutputs: string[] = (() => {
    if (Array.isArray(rawCommitments)) return rawCommitments;
    if (rawCommitments && typeof rawCommitments === "object") {
      const obj = rawCommitments as Record<string, unknown>;
      if (Array.isArray(obj.notes)) return obj.notes as string[];
      if (Array.isArray(obj.commitments)) return obj.commitments as string[];
      if (Array.isArray(obj.encrypted_outputs))
        return obj.encrypted_outputs as string[];
      if (Array.isArray(obj.data)) return obj.data as string[];
    }
    return [];
  })();

  const totalNotes = encryptedOutputs.length;

  if (totalNotes === 0) {
    const summary: ScanSummary = {
      totalCommitments: 0,
      decryptedCount: 0,
      failedCount: 0,
      totalAmountByToken: {},
      scanDurationMs: Date.now() - startTime,
    };
    onProgress?.({
      phase: "complete",
      current: 0,
      total: 0,
      decryptedSoFar: 0,
      message: "No encrypted notes found on the relay.",
    });
    return { payslips: [], summary };
  }

  onProgress?.({
    phase: "fetching",
    current: totalNotes,
    total: totalNotes,
    decryptedSoFar: 0,
    message: `Found ${totalNotes} encrypted notes. Starting decryption...`,
  });

  if (abortSignal?.aborted) throw new Error("Scan cancelled");

  // ─── Step 3: Attempt decryption on each note ─────────────
  // The SDK's scanNotesForWallet does this in a loop internally,
  // but we replicate it manually for progress tracking + cancellation.

  const payslips: DecryptedPayslip[] = [];
  let failedCount = 0;
  const amountAccumulator: Record<string, bigint> = {};

  for (let i = 0; i < totalNotes; i++) {
    if (abortSignal?.aborted) throw new Error("Scan cancelled by user");

    // Progress update every 10 notes
    if (i % 10 === 0 || i === totalNotes - 1) {
      onProgress?.({
        phase: "decrypting",
        current: i + 1,
        total: totalNotes,
        decryptedSoFar: payslips.length,
        message: `Decrypting note ${i + 1}/${totalNotes}... (${payslips.length} found)`,
      });
    }

    try {
      // Decode the base64 encrypted output into a note object
      const decoded = atob(encryptedOutputs[i]);
      const encryptedNote = JSON.parse(decoded);

      // Attempt decryption with the derived ViewKey
      // tryDecryptNote returns null if the key doesn't match (wrong recipient)
      const noteData = tryDecryptNote(encryptedNote, viewKey);

      if (!noteData) {
        failedCount++;
        continue;
      }

      // Successfully decrypted — parse the note data
      // noteData is a NoteData object with: amount, commitment, blinding, etc.
      const noteObj = typeof noteData === "object" ? noteData : {};
      const noteAny = noteObj as Record<string, unknown>;

      const rawAmount = BigInt(
        noteAny.amount?.toString() || noteAny.value?.toString() || "0"
      );

      const mintStr = String(
        noteAny.token_mint ||
        noteAny.mint ||
        noteAny.asset ||
        ""
      );

      const tokenSymbol = resolveTokenSymbol(mintStr);

      // Accumulate totals per token
      if (!amountAccumulator[tokenSymbol]) {
        amountAccumulator[tokenSymbol] = 0n;
      }
      amountAccumulator[tokenSymbol] += rawAmount;

      // Build commitment hash for cross-referencing
      const commitmentHash = String(
        noteAny.commitment ||
        noteAny.commitment_hash ||
        `note-${i}`
      );

      const payslip: DecryptedPayslip = {
        id: `${commitmentHash}-${i}`,
        amountFormatted: formatTokenAmount(rawAmount, tokenSymbol),
        amountRaw: rawAmount.toString(),
        tokenSymbol,
        tokenMint: mintStr,
        date: noteAny.timestamp
          ? new Date(
            typeof noteAny.timestamp === "number"
              ? (noteAny.timestamp as number) * 1000
              : noteAny.timestamp as string
          ).toISOString()
          : null,
        memo:
          typeof noteAny.memo === "string"
            ? noteAny.memo
            : typeof noteAny.message === "string"
              ? noteAny.message
              : null,
        txSignature:
          typeof noteAny.tx_signature === "string"
            ? noteAny.tx_signature
            : typeof noteAny.signature === "string"
              ? noteAny.signature
              : null,
        commitmentHash,
        leafIndex:
          typeof noteAny.leaf_index === "number"
            ? noteAny.leaf_index
            : typeof noteAny.index === "number"
              ? noteAny.index
              : i,
      };

      payslips.push(payslip);
    } catch (err) {
      // Decryption or parsing error — skip silently
      console.debug(
        `[NoteScanner] Failed to process note ${i}:`,
        err instanceof Error ? err.message : err
      );
      failedCount++;
    }

    // Yield to the main thread periodically
    if (i > 0 && i % PROCESS_BATCH_SIZE === 0) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // Step 4: Build summary 
  const totalAmountByToken: Record<string, string> = {};
  for (const [token, amount] of Object.entries(amountAccumulator)) {
    totalAmountByToken[token] = formatTokenAmount(amount, token);
  }

  const summary: ScanSummary = {
    totalCommitments: totalNotes,
    decryptedCount: payslips.length,
    failedCount,
    totalAmountByToken,
    scanDurationMs: Date.now() - startTime,
  };

  onProgress?.({
    phase: "complete",
    current: totalNotes,
    total: totalNotes,
    decryptedSoFar: payslips.length,
    message: `Scan complete. Found ${payslips.length} payslips in ${(summary.scanDurationMs / 1000).toFixed(1)}s.`,
  });

  return { payslips, summary };
}
