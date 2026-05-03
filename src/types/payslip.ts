/**
 * Structured payslip data returned from client-side note decryption.
 *
 * This represents a single successfully decrypted UTXO note
 * from the Cloak shielded pool, parsed into a human-readable format.
 *
 * ⚠ This data exists ONLY in the browser — it is never sent to the server.
 */

/** Known token decimals for formatting base-unit amounts */
export const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  SOL: 9,
};

/** Known token mint addresses → symbols */
export const MINT_TO_SYMBOL: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  So11111111111111111111111111111111111111112: "SOL",
};

export interface DecryptedPayslip {
  /** Unique identifier — the UTXO commitment hash */
  id: string;

  /** Human-readable amount (e.g., "1,250.00") */
  amountFormatted: string;

  /** Raw amount in token base units (e.g., "1250000000" for 1250 USDC) */
  amountRaw: string;

  /** Token symbol (USDC, USDT, SOL) */
  tokenSymbol: string;

  /** Token mint address (base58) */
  tokenMint: string;

  /** Transaction timestamp (ISO 8601) or null if unavailable */
  date: string | null;

  /** Memo/note attached to the transaction (if any) */
  memo: string | null;

  /** On-chain transaction signature */
  txSignature: string | null;

  /** UTXO commitment hash for cross-referencing */
  commitmentHash: string;

  /** Leaf index in the Merkle tree */
  leafIndex: number;
}

/** Status of a note decryption attempt */
export type NoteDecryptionStatus =
  | "decrypted"
  | "failed_wrong_key"
  | "failed_corrupted"
  | "failed_unknown";

export interface NoteDecryptionResult {
  status: NoteDecryptionStatus;
  payslip: DecryptedPayslip | null;
  error: string | null;
  /** The raw commitment for debugging */
  commitment: string;
}

/** Summary statistics for a scan session */
export interface ScanSummary {
  totalCommitments: number;
  decryptedCount: number;
  failedCount: number;
  totalAmountByToken: Record<string, string>;
  scanDurationMs: number;
}
