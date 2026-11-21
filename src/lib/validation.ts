import { z } from "zod";

/**
 * Validation schemas for all API inputs.
 * Every route MUST validate request bodies through these schemas
 * before processing — no raw user input reaches business logic.
 */

// ─── Solana Pubkey Validation ───────────────────────────────────
// Base58-encoded Solana public key: 32–48 characters, no 0/O/I/l
const solanaPubkeySchema = z
  .string()
  .min(32)
  .max(48)
  .regex(
    /^[1-9A-HJ-NP-Za-km-z]+$/,
    "Invalid Solana public key (must be base58)"
  );

const hexSha256Schema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "Must be a 64-character hex SHA-256 digest");

// ─── Supported Token Symbols & Settlement Rails ────────────────
const supportedTokenSymbols = ["USDC", "USDT", "SOL"] as const;
const settlementRailSchema = z.enum(["onchain_shielded", "ngn_bank", "kes_mpesa"]);

// ─── Payroll Recipient ─────────────────────────────────────────
const payrollRecipientSchema = z.object({
  /** Recipient's Solana wallet public key (base58) */
  wallet: solanaPubkeySchema,
  /** Amount in token base units (e.g., USDC has 6 decimals: 1 USDC = 1_000_000) */
  amount: z
    .string()
    .regex(/^\d+$/, "Amount must be a non-negative integer string")
    .refine((val) => BigInt(val) > 0n, "Amount must be greater than zero"),
  /** Optional per-recipient token override */
  token: z.enum(supportedTokenSymbols).optional(),
  /** Preferred settlement rail */
  settlementRail: settlementRailSchema.optional().default("onchain_shielded"),
  /** Optional masked bank/M-Pesa account label (for off-ramp dispatch only) */
  destinationAccount: z.string().max(128).optional(),
});

// ─── Payroll Request Schema ────────────────────────────────────
export const payrollRequestSchema = z.object({
  /** Organization ID (UUID) */
  org_id: z.string().uuid("org_id must be a valid UUID"),

  /** Primary token symbol for this payroll run */
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

  /** Execution rail (canonical architecture: MagicBlock PER / TEE) */
  rail: z.literal("tee").optional().default("tee"),
});

export type PayrollRequest = z.infer<typeof payrollRequestSchema>;
export type PayrollRecipientInput = z.infer<typeof payrollRecipientSchema>;

// ─── Token Mint Map ────────────────────────────────────────────
/** Canonical devnet token mints */
export const TOKEN_MINTS: Record<string, string> = {
  USDC: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // Circle Devnet USDC
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  SOL: "So11111111111111111111111111111111111111112", // Wrapped SOL mint
};

/** All valid mint addresses (devnet + mainnet) accepted per symbol */
export const ALLOWED_TOKEN_MINTS: Record<string, string[]> = {
  USDC: [
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // Devnet USDC
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // Mainnet USDC
  ],
  USDT: ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"],
  SOL: ["So11111111111111111111111111111111111111112"],
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
    /** Maximum number of payroll runs to decrypt & verify */
    limit: z.number().int().min(1).max(1000).optional().default(250),
  })
  .strict();

export type DecryptRequest = z.infer<typeof decryptRequestSchema>;

// ═══════════════════════════════════════════════════════════════
// PAYROLL CONFIRM Schema (client-side signing callback)
// ═══════════════════════════════════════════════════════════════

const merkleSiblingSchema = z.object({
  hash: hexSha256Schema,
  sum: z.string().regex(/^\d+$/),
  count: z.number().int().min(0),
  position: z.enum(["left", "right"]),
});

const merkleProofSchema = z.object({
  leafIndex: z.number().int().min(0),
  leafHash: hexSha256Schema,
  amountBaseUnits: z.string().regex(/^\d+$/),
  siblings: z.array(merkleSiblingSchema),
  root: hexSha256Schema,
  totalSum: z.string().regex(/^\d+$/),
  leafCount: z.number().int().min(1),
});

export const manifestEntrySchema = z.object({
  index: z.number().int().min(0),
  recipient: solanaPubkeySchema,
  amountBaseUnits: z.string().regex(/^\d+$/).refine((v) => BigInt(v) > 0n),
  tokenSymbol: z.enum(supportedTokenSymbols),
  tokenMint: solanaPubkeySchema,
  settlementRail: settlementRailSchema,
  saltHex: z.string().regex(/^[0-9a-fA-F]{32,64}$/, "Salt must be 16–32 byte hex"),
  runNonce: z.string().min(1).max(128),
  commitmentHash: hexSha256Schema,
  merkleProof: merkleProofSchema,
});

// ─── Confirm Payroll Request ───────────────────────────────────
export const payrollConfirmSchema = z
  .object({
    /** The payroll run ID returned from the initial POST /api/payroll */
    payroll_run_id: z.string().uuid("payroll_run_id must be a valid UUID"),

    /** Real on-chain transaction signatures from MagicBlock PER / Solana L1 */
    tx_signatures: z
      .array(
        z
          .string()
          .min(80, "Transaction signature too short")
          .max(100, "Transaction signature too long")
          .regex(
            /^[1-9A-HJ-NP-Za-km-z]+$/,
            "Transaction signature must be base58"
          )
      )
      .min(1, "Must have at least one transaction signature")
      .max(100, "Maximum 100 transaction signatures per batch"),

    /** Binary Merkle Sum Tree leaf commitment hashes */
    commitment_hashes: z
      .array(hexSha256Schema)
      .min(1, "Must have at least one commitment hash")
      .max(50, "Maximum 50 commitment hashes per batch"),

    /** Anchored Binary Merkle Sum Tree root */
    merkle_root: hexSha256Schema,

    /** Full batch manifest verified against merkle_root then encrypted at rest */
    manifest: z
      .array(manifestEntrySchema)
      .min(1, "Manifest must contain at least one recipient entry")
      .max(50, "Maximum 50 manifest entries per batch"),
  })
  .strict();

export type PayrollConfirmRequest = z.infer<typeof payrollConfirmSchema>;

// ═══════════════════════════════════════════════════════════════
// TREASURY SWAP Schemas (Treasury SOL→USDC top-up)
// ═══════════════════════════════════════════════════════════════

export const swapQuoteRequestSchema = z
  .object({
    /** Organization ID (UUID) */
    org_id: z.string().uuid("org_id must be a valid UUID"),

    /** Amount of SOL to swap, in lamports (string to support large values) */
    amount_lamports: z
      .string()
      .regex(/^\d+$/, "amount_lamports must be a non-negative integer string")
      .refine((val) => BigInt(val) > 0n, "Amount must be greater than zero"),

    /** Slippage tolerance in basis points (1 bps = 0.01%) */
    slippage_bps: z
      .number()
      .int()
      .min(1, "Slippage must be at least 1 bps")
      .max(5000, "Slippage must not exceed 50%")
      .optional()
      .default(100),

    /** Wallet pubkey of the admin initiating the swap */
    initiated_by: solanaPubkeySchema,
  })
  .strict();

export type SwapQuoteRequest = z.infer<typeof swapQuoteRequestSchema>;

export const swapConfirmSchema = z
  .object({
    /** The swap ID returned from the initial POST /api/treasury/swap-quote */
    swap_id: z.string().uuid("swap_id must be a valid UUID"),

    /** On-chain base58 transaction signature */
    tx_signature: z
      .string()
      .min(80, "Transaction signature too short")
      .max(100, "Transaction signature too long")
      .regex(
        /^[1-9A-HJ-NP-Za-km-z]+$/,
        "Transaction signature must be valid base58"
      ),

    /** SHA-256 commitment hash for the treasury deposit */
    commitment_hash: hexSha256Schema,

    /** Output amount received (in USDC base units) */
    output_amount: z
      .string()
      .regex(/^\d+$/, "output_amount must be a non-negative integer string"),
  })
  .strict();

export type SwapConfirmRequest = z.infer<typeof swapConfirmSchema>;
