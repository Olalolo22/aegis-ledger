import { z } from "zod";

/**
 * Validation schemas for all API inputs.
 * Every route MUST validate request bodies through these schemas
 * before processing — no raw user input reaches business logic.
 */

// ─── Solana Pubkey Validation ───────────────────────────────────
// Base58-encoded Solana public key: 32–44 characters, no 0/O/I/l
const solanaPubkeySchema = z
  .string()
  .min(32)
  .max(44)
  .regex(
    /^[1-9A-HJ-NP-Za-km-z]+$/,
    "Invalid Solana public key (must be base58)"
  );

// ─── Payroll Recipient ─────────────────────────────────────────
const payrollRecipientSchema = z.object({
  /** Recipient's Solana wallet public key (base58) */
  wallet: solanaPubkeySchema,
  /** Amount in token base units (e.g., USDC has 6 decimals: 1 USDC = 1_000_000) */
  amount: z
    .string()
    .regex(/^\d+$/, "Amount must be a non-negative integer string")
    .refine((val) => BigInt(val) > 0n, "Amount must be greater than zero"),
});

// ─── Supported Token Symbols ───────────────────────────────────
const supportedTokenSymbols = ["USDC", "USDT", "SOL"] as const;

// ─── Payroll Request Schema ────────────────────────────────────
export const payrollRequestSchema = z
  .object({
    /** Organization ID (UUID) */
    org_id: z.string().uuid("org_id must be a valid UUID"),

    /** Token symbol for this payroll run */
    token_symbol: z.enum(supportedTokenSymbols, {
      message: `token_symbol must be one of: ${supportedTokenSymbols.join(", ")}`,
    }),

    /** SPL token mint address (base58 Solana pubkey) */
    token_mint: solanaPubkeySchema,

    /** Wallet pubkey of the user initiating the payroll */
    initiated_by: solanaPubkeySchema,

    /** Array of recipients with wallet addresses and amounts */
    recipients: z
      .array(payrollRecipientSchema)
      .min(1, "Must have at least one recipient")
      .max(50, "Maximum 50 recipients per batch"),
  })
  .strict(); // reject unknown fields

export type PayrollRequest = z.infer<typeof payrollRequestSchema>;
export type PayrollRecipientInput = z.infer<typeof payrollRecipientSchema>;

// ─── Token Mint Map ────────────────────────────────────────────
/** Known token mints for validation cross-referencing */
export const TOKEN_MINTS: Record<string, string> = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  SOL: "So11111111111111111111111111111111111111112", // wrapped SOL mint
};

// ═══════════════════════════════════════════════════════════════
// AUDIT API Schemas
// ═══════════════════════════════════════════════════════════════

// ─── Generate Viewing Key Request ──────────────────────────────
export const generateKeyRequestSchema = z
  .object({
    /** Organization ID (UUID) */
    org_id: z.string().uuid("org_id must be a valid UUID"),

    /** Auditor identity (email or wallet) — will be hashed, never stored plain */
    auditor_identity: z
      .string()
      .min(3, "Auditor identity must be at least 3 characters")
      .max(256, "Auditor identity too long"),

    /** Start of audit window (ISO 8601 timestamp) */
    valid_from: z.string().datetime({ message: "valid_from must be ISO 8601 datetime" }),

    /** End of audit window (ISO 8601 timestamp) */
    valid_until: z.string().datetime({ message: "valid_until must be ISO 8601 datetime" }),

    /** Token symbols the key may decrypt */
    allowed_tokens: z
      .array(
        z.enum(supportedTokenSymbols, {
          message: `Each token must be one of: ${supportedTokenSymbols.join(", ")}`,
        })
      )
      .min(1, "Must allow at least one token")
      .max(10, "Maximum 10 tokens"),
  })
  .strict()
  .refine(
    (data) => new Date(data.valid_until) > new Date(data.valid_from),
    { message: "valid_until must be after valid_from", path: ["valid_until"] }
  );

export type GenerateKeyRequest = z.infer<typeof generateKeyRequestSchema>;

// ─── Magic Link Request ────────────────────────────────────────
export const magicLinkRequestSchema = z
  .object({
    /** The viewing key ID to generate a magic link for */
    viewing_key_id: z.string().uuid("viewing_key_id must be a valid UUID"),

    /** Auditor identity for verification (will be hashed and compared) */
    auditor_identity: z
      .string()
      .min(3)
      .max(256),
  })
  .strict();

export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

// ─── Decrypt Request ───────────────────────────────────────────
export const decryptRequestSchema = z
  .object({
    /** Maximum number of transactions to scan */
    limit: z.number().int().min(1).max(1000).optional().default(250),
  })
  .strict();

export type DecryptRequest = z.infer<typeof decryptRequestSchema>;
