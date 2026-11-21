import { z } from "zod";

/**
 * Validation schemas for all API inputs.
 * Every route MUST validate request bodies through these schemas
 * before processing — no raw user input reaches business logic.
 */

const solanaPubkeySchema = z
  .string()
  .min(32)
  .max(48)
  .regex(
    /^[1-9A-HJ-NP-Za-km-z]+$/,
    "Invalid Solana public key (must be base58)"
  );

const solanaSignatureSchema = z
  .string()
  .min(80, "Transaction signature too short")
  .max(100, "Transaction signature too long")
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, "Transaction signature must be base58");

const hexSha256Schema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "Must be a 64-character hex SHA-256 digest");

const supportedTokenSymbols = ["USDC", "USDT", "SOL"] as const;
const settlementRailSchema = z.enum(["onchain_shielded", "ngn_bank", "kes_mpesa"]);

const payrollRecipientSchema = z.object({
  wallet: solanaPubkeySchema,
  amount: z
    .string()
    .regex(/^\d+$/, "Amount must be a non-negative integer string")
    .refine((val) => BigInt(val) > 0n, "Amount must be greater than zero"),
  token: z.enum(supportedTokenSymbols).optional(),
  settlementRail: settlementRailSchema.optional().default("onchain_shielded"),
  destinationAccount: z.string().max(128).optional(),
});

export const payrollRequestSchema = z.object({
  org_id: z.string().uuid("org_id must be a valid UUID"),
  token_symbol: z.enum(supportedTokenSymbols, {
    message: `token_symbol must be one of: ${supportedTokenSymbols.join(", ")}`,
  }),
  token_mint: solanaPubkeySchema,
  initiated_by: solanaPubkeySchema,
  recipients: z
    .array(payrollRecipientSchema)
    .min(1, "Must have at least one recipient")
    .max(50, "Maximum 50 recipients per batch"),
  rail: z.literal("tee").optional().default("tee"),
});

export type PayrollRequest = z.infer<typeof payrollRequestSchema>;
export type PayrollRecipientInput = z.infer<typeof payrollRecipientSchema>;

export const TOKEN_MINTS: Record<string, string> = {
  USDC: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  SOL: "So11111111111111111111111111111111111111112",
};

export const ALLOWED_TOKEN_MINTS: Record<string, string[]> = {
  USDC: [
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  ],
  USDT: ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"],
  SOL: ["So11111111111111111111111111111111111111112"],
};

// ═══════════════════════════════════════════════════════════════
// AUDIT API Schemas (Client-Side Zero-Knowledge Public-Key Wrapping)
// ═══════════════════════════════════════════════════════════════

export const generateKeyRequestSchema = z
  .object({
    org_id: z.string().uuid("org_id must be a valid UUID"),
    auditor_identity: z
      .string()
      .min(3, "Auditor identity must be at least 3 characters")
      .max(256, "Auditor identity too long"),
    /** Base64 SPKI RSA-OAEP-256 public key held exclusively by the auditor */
    auditor_public_key: z
      .string()
      .min(128, "auditor_public_key must be a valid Base64 SPKI public key")
      .max(2048, "auditor_public_key too long"),
    /** Per-batch DEKs re-wrapped client-side by the org admin to auditor_public_key */
    wrapped_batch_keys: z
      .record(z.string().uuid(), z.string().min(64).max(2048))
      .optional()
      .default({}),
    valid_from: z.string().datetime({ message: "valid_from must be ISO 8601 datetime" }),
    valid_until: z.string().datetime({ message: "valid_until must be ISO 8601 datetime" }),
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

export const magicLinkRequestSchema = z
  .object({
    viewing_key_id: z.string().uuid("viewing_key_id must be a valid UUID"),
    auditor_identity: z.string().min(3).max(256),
  })
  .strict();

export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

export const decryptRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(1000).optional().default(250),
  })
  .strict();

export type DecryptRequest = z.infer<typeof decryptRequestSchema>;

// ═══════════════════════════════════════════════════════════════
// PAYROLL CONFIRM Schema (L1 Anchor + On-Chain Transfer Proofs + E2EE Envelope)
// ═══════════════════════════════════════════════════════════════

const merkleSiblingSchema = z.object({
  hash: hexSha256Schema,
  sum: z.string().regex(/^\d+$/),
  count: z.number().int().min(0),
  position: z.enum(["left", "right"]),
});

export const merkleProofSchema = z.object({
  leafIndex: z.number().int().min(0),
  leafHash: hexSha256Schema,
  amountBaseUnits: z.string().regex(/^\d+$/),
  siblings: z.array(merkleSiblingSchema),
  root: hexSha256Schema,
  totalSum: z.string().regex(/^\d+$/),
  leafCount: z.number().int().min(1),
});

export const e2eeEnvelopeSchema = z
  .object({
    version: z.literal(2),
    scheme: z.literal("RSA-OAEP-256+AES-256-GCM"),
    orgPublicKeyFingerprint: z.string().regex(/^[0-9a-fA-F]{16}$/),
    encryptedManifest: z.string().min(40),
    orgWrappedDek: z.string().min(64).max(2048),
    aad: z.string().min(10).max(512),
  })
  .strict();

export const onChainSettlementSchema = z
  .object({
    leafIndex: z.number().int().min(0),
    signature: solanaSignatureSchema,
    saltHex: z.string().regex(/^[0-9a-fA-F]{32,64}$/),
  })
  .strict();

export const payrollConfirmSchema = z
  .object({
    payroll_run_id: z.string().uuid("payroll_run_id must be a valid UUID"),
    /** Solana L1 transaction signature carrying `aegis:merkle:v1:<root>:<count>` */
    anchor_tx_signature: solanaSignatureSchema,
    /** All on-chain transaction signatures for this batch (deposits, transfers, anchor) */
    tx_signatures: z
      .array(solanaSignatureSchema)
      .min(1, "Must have at least one transaction signature")
      .max(100, "Maximum 100 transaction signatures per batch"),
    /** Ordered Binary Merkle Sum Tree leaf commitment hashes */
    commitment_hashes: z
      .array(hexSha256Schema)
      .min(1, "Must have at least one commitment hash")
      .max(50, "Maximum 50 commitment hashes per batch"),
    /** L1-anchored Binary Merkle Sum Tree root */
    merkle_root: hexSha256Schema,
    /** Per-leaf O(log N) Merkle Sum Tree inclusion proofs (no plaintext wallets/salts) */
    leaf_proofs: z
      .array(merkleProofSchema)
      .min(1, "Must include inclusion proof for every leaf")
      .max(50, "Maximum 50 leaf proofs per batch"),
    /** Exact on-chain MagicBlock Private SPL transfer signatures verified against leaves */
    onchain_settlements: z
      .array(onChainSettlementSchema)
      .max(50, "Maximum 50 on-chain settlements per batch"),
    /** Client-side RSA-OAEP-256 + AES-256-GCM encrypted manifest (undecryptable by server) */
    e2ee_envelope: e2eeEnvelopeSchema,
  })
  .strict();

export type PayrollConfirmRequest = z.infer<typeof payrollConfirmSchema>;

// ═══════════════════════════════════════════════════════════════
// TREASURY SWAP Schemas
// ═══════════════════════════════════════════════════════════════

export const swapQuoteRequestSchema = z
  .object({
    org_id: z.string().uuid("org_id must be a valid UUID"),
    amount_lamports: z
      .string()
      .regex(/^\d+$/, "amount_lamports must be a non-negative integer string")
      .refine((val) => BigInt(val) > 0n, "Amount must be greater than zero"),
    slippage_bps: z
      .number()
      .int()
      .min(1, "Slippage must be at least 1 bps")
      .max(5000, "Slippage must not exceed 50%")
      .optional()
      .default(100),
    initiated_by: solanaPubkeySchema,
  })
  .strict();

export type SwapQuoteRequest = z.infer<typeof swapQuoteRequestSchema>;

export const swapConfirmSchema = z
  .object({
    swap_id: z.string().uuid("swap_id must be a valid UUID"),
    tx_signature: solanaSignatureSchema,
    commitment_hash: hexSha256Schema,
    output_amount: z
      .string()
      .regex(/^\d+$/, "output_amount must be a non-negative integer string"),
  })
  .strict();

export type SwapConfirmRequest = z.infer<typeof swapConfirmSchema>;
