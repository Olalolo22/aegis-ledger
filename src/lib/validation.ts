import { z } from "zod";

/**
 * Validation schemas for all API inputs.
 *
 * Security invariants:
 * 1. Every route validates request bodies through `.strict()` schemas.
 * 2. Caller-supplied `org_id` is REMOVED from all organization-scoped schemas;
 *    routes derive `org_id` strictly from the verified wallet session cookie.
 * 3. Blind payroll schemas reject individual salaries, employee wallets, leaf
 *    salts, Merkle sum-tree proofs, and per-employee ER transfer signatures.
 * 4. Key-vault mutations require per-action Ed25519 wallet signatures (`auth_nonce`
 *    + `wallet_signature`) bound to `(org_id, action, target_fingerprint)`.
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

const walletMessageSignatureSchema = z
  .string()
  .min(64, "Wallet Ed25519 signature too short")
  .max(128, "Wallet Ed25519 signature too long");

const authNonceSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{32,64}$/, "auth_nonce must be a 32-64 char hex nonce");

const hexSha256Schema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "Must be a 64-character hex SHA-256 digest");

const keyFingerprintSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{16}$/, "Must be a 16-character hex public key fingerprint");

const supportedTokenSymbols = ["USDC", "USDT", "SOL"] as const;

// ═══════════════════════════════════════════════════════════════
// WALLET AUTHENTICATION Schemas (SIWS + Per-Mutation Nonces)
// ═══════════════════════════════════════════════════════════════

export const authChallengeRequestSchema = z
  .object({
    purpose: z.enum(["session_login", "vault_register", "vault_rotate"]),
    wallet_pubkey: solanaPubkeySchema,
    target_fingerprint: keyFingerprintSchema.optional(),
  })
  .strict();

export const authVerifyRequestSchema = z
  .object({
    wallet_pubkey: solanaPubkeySchema,
    nonce: authNonceSchema,
    signature: walletMessageSignatureSchema,
  })
  .strict();

// ═══════════════════════════════════════════════════════════════
// BLIND PAYROLL INITIATION Schema
// (org_id derived from session; Aggregate Totals Only — ZERO Per-Recipient Data)
// ═══════════════════════════════════════════════════════════════

export const payrollRequestSchema = z
  .object({
    token_symbol: z.enum(supportedTokenSymbols, {
      message: `token_symbol must be one of: ${supportedTokenSymbols.join(", ")}`,
    }),
    token_mint: solanaPubkeySchema,
    initiated_by: solanaPubkeySchema,
    /** Number of recipients in the batch (1..50); individual identities stay client-side */
    recipient_count: z
      .number()
      .int()
      .min(1, "Must have at least one recipient")
      .max(50, "Maximum 50 recipients per batch"),
    /** Aggregate batch total in base units (never per-employee salary) */
    total_amount_base_units: z
      .string()
      .regex(/^\d+$/, "total_amount_base_units must be a non-negative integer string")
      .refine((val) => BigInt(val) > 0n, "Total amount must be greater than zero"),
    /** Aggregate on-chain shielded portion in base units (for ephemeral deposit preflight) */
    onchain_total_base_units: z
      .string()
      .regex(/^\d+$/, "onchain_total_base_units must be a non-negative integer string")
      .optional()
      .default("0"),
    rail: z.literal("tee").optional().default("tee"),
  })
  .strict();

export type PayrollRequest = z.infer<typeof payrollRequestSchema>;

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
// AUDIT API Schemas (org_id derived from verified admin session)
// ═══════════════════════════════════════════════════════════════

export const generateKeyRequestSchema = z
  .object({
    auditor_identity: z
      .string()
      .min(3, "Auditor identity must be at least 3 characters")
      .max(256, "Auditor identity too long"),
    /** Base64 SPKI RSA-OAEP-256 public key held exclusively by the auditor */
    auditor_public_key: z
      .string()
      .min(128, "auditor_public_key must be a valid Base64 SPKI public key")
      .max(2048, "auditor_public_key too long"),
    /** Per-batch DEKs re-wrapped client-side by an org admin to auditor_public_key */
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
// BLIND PAYROLL CONFIRM Schema (L1 Anchor + Blinded Leaf Hashes + E2EE Envelope ONLY)
// ═══════════════════════════════════════════════════════════════

export const e2eeEnvelopeSchema = z
  .object({
    version: z.literal(2),
    scheme: z.literal("RSA-OAEP-256+AES-256-GCM"),
    orgPublicKeyFingerprint: keyFingerprintSchema,
    encryptedManifest: z.string().min(40),
    orgWrappedDek: z.string().min(64).max(2048),
    orgWrappedDeks: z
      .record(keyFingerprintSchema, z.string().min(64).max(2048))
      .optional(),
    aad: z.string().min(10).max(512),
  })
  .strict();

export const payrollConfirmSchema = z
  .object({
    payroll_run_id: z.string().uuid("payroll_run_id must be a valid UUID"),
    /** Solana L1 transaction signature carrying `aegis:merkle:v1:<root>:<count>` */
    anchor_tx_signature: solanaSignatureSchema,
    /** Optional treasury L1 -> PER funding deposit signatures (aggregate only; zero employee ER tx sigs) */
    deposit_tx_signatures: z
      .array(solanaSignatureSchema)
      .max(10, "Maximum 10 treasury deposit signatures")
      .optional()
      .default([]),
    /** Ordered blinded 64-hex SHA-256 leaf commitment hashes (zero amounts, wallets, or salts) */
    commitment_hashes: z
      .array(hexSha256Schema)
      .min(1, "Must have at least one commitment hash")
      .max(50, "Maximum 50 commitment hashes per batch"),
    /** L1-anchored Binary Merkle Sum Tree root */
    merkle_root: hexSha256Schema,
    /** Client-side RSA-OAEP-256 + AES-256-GCM encrypted manifest (undecryptable by server) */
    e2ee_envelope: e2eeEnvelopeSchema,
  })
  .strict();

export type PayrollConfirmRequest = z.infer<typeof payrollConfirmSchema>;

// ═══════════════════════════════════════════════════════════════
// ORG KEY VAULT Schemas
// (org_id derived strictly from session; per-mutation Ed25519 signature required)
// ═══════════════════════════════════════════════════════════════

export const orgAdminRoleSchema = z.enum([
  "primary",
  "backup_controller",
  "recovery",
]);

export const encryptedPrivateKeyVaultSchema = z
  .object({
    version: z.literal(1),
    kdf: z.literal("PBKDF2-SHA256"),
    iterations: z.number().int().min(100_000).max(2_000_000),
    cipher: z.literal("AES-256-GCM"),
    orgId: z.string().uuid(),
    adminLabel: z.string().min(2).max(128),
    role: orgAdminRoleSchema,
    publicKeySpkiBase64: z.string().min(128).max(2048),
    fingerprint: keyFingerprintSchema,
    saltBase64: z.string().min(16).max(128),
    ivBase64: z.string().min(12).max(64),
    ciphertextBase64: z.string().min(100).max(8192),
    aad: z.string().min(10).max(512),
    createdAt: z.string().datetime(),
  })
  .strict();

export const registerOrgKeyVaultSchema = z
  .object({
    admin_label: z.string().min(2).max(128),
    role: orgAdminRoleSchema,
    public_key_spki: z.string().min(128).max(2048),
    fingerprint: keyFingerprintSchema,
    /** Optional passphrase-encrypted vault blob (server NEVER sees passphrase or plaintext key) */
    encrypted_vault: encryptedPrivateKeyVaultSchema.nullable().optional(),
    /** Single-use nonce from POST /api/auth/challenge (purpose: vault_register) */
    auth_nonce: authNonceSchema,
    /** Ed25519 signature from already-registered admin wallet authorizing this registration */
    wallet_signature: walletMessageSignatureSchema,
  })
  .strict();

export const rotateOrgKeyVaultSchema = z
  .object({
    revoke_fingerprint: keyFingerprintSchema,
    new_admin_fingerprint: keyFingerprintSchema.optional(),
    /** Client-side re-wrapped DEKs keyed by payroll_run_id for the newly added admin */
    rewrapped_batch_deks: z
      .record(z.string().uuid(), z.string().min(64).max(2048))
      .optional()
      .default({}),
    /** Single-use nonce from POST /api/auth/challenge (purpose: vault_rotate) */
    auth_nonce: authNonceSchema,
    /** Ed25519 signature from already-registered admin wallet authorizing this rotation/revocation */
    wallet_signature: walletMessageSignatureSchema,
  })
  .strict();

// ═══════════════════════════════════════════════════════════════
// TREASURY SWAP Schemas (org_id derived strictly from session)
// ═══════════════════════════════════════════════════════════════

export const swapQuoteRequestSchema = z
  .object({
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
