import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  hkdfSync,
} from "crypto";

/**
 * AES-256-GCM encryption utilities for viewing keys.
 *
 * Architecture:
 * - Master secret lives ONLY in AEGIS_MASTER_SECRET env var.
 * - Each viewing key gets a unique `key_id` (UUID).
 * - The per-key encryption key is derived via HKDF-SHA256:
 *     HKDF(ikm=master_secret, salt=key_id, info="aegis-viewing-key", length=32)
 * - Ciphertext is stored as a single blob: iv (12 bytes) || authTag (16 bytes) || encrypted data
 * - The database NEVER sees the master secret or the derived key.
 */

const HKDF_INFO = "aegis-viewing-key";
const HKDF_ORG_AUDIT_INFO = "aegis-org-audit-vk-v1";
const HKDF_MANIFEST_INFO = "aegis-batch-manifest-v1";
const HKDF_JWT_INFO = "aegis-audit-jwt-v1";
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16; // GCM auth tag length
const KEY_LENGTH = 32; // AES-256

/**
 * Returns the master secret from the environment.
 * Throws if not set or malformed.
 */
function getMasterSecret(): Buffer {
  const hex = process.env.AEGIS_MASTER_SECRET;
  if (!hex || hex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "AEGIS_MASTER_SECRET must be a 64-character hex string (32 bytes). " +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Derives a per-key AES-256 encryption key using HKDF-SHA256.
 *
 * @param keyId - Unique identifier for this viewing key (used as HKDF salt)
 * @returns 32-byte derived key
 */
export function deriveKey(keyId: string): Buffer {
  const masterSecret = getMasterSecret();
  const salt = Buffer.from(keyId, "utf-8");
  const derived = hkdfSync("sha256", masterSecret, salt, HKDF_INFO, KEY_LENGTH);
  return Buffer.from(derived);
}

/**
 * Derives a domain-separated 32-byte audit viewing key for an organization.
 * Used to encrypt payroll batch audit manifests at rest and wrapped inside
 * scoped auditor viewing keys upon issuance.
 */
export function deriveOrgAuditKey(orgId: string): Buffer {
  const masterSecret = getMasterSecret();
  const salt = Buffer.from(orgId, "utf-8");
  const derived = hkdfSync("sha256", masterSecret, salt, HKDF_ORG_AUDIT_INFO, KEY_LENGTH);
  return Buffer.from(derived);
}

/**
 * Derives a dedicated domain-separated 32-byte key for signing auditor JWTs,
 * avoiding direct reuse of AEGIS_MASTER_SECRET across cryptographic domains.
 */
export function deriveJwtSigningKey(): Uint8Array {
  const masterSecret = getMasterSecret();
  const derived = hkdfSync("sha256", masterSecret, Buffer.from("jwt", "utf-8"), HKDF_JWT_INFO, KEY_LENGTH);
  return new Uint8Array(derived);
}

/**
 * Builds canonical Additional Authenticated Data (AAD) binding a viewing key
 * ciphertext to its organization, temporal window, and allowed tokens.
 */
export function buildViewingKeyScopeAad(scope: {
  orgId: string;
  validFrom: string;
  validUntil: string;
  allowedTokens: string[];
}): Buffer {
  const normalizedTokens = [...scope.allowedTokens].sort().join(",");
  return Buffer.from(
    `aegis:vk-scope:v1|${scope.orgId}|${new Date(scope.validFrom).toISOString()}|${new Date(scope.validUntil).toISOString()}|${normalizedTokens}`,
    "utf-8"
  );
}

/**
 * Builds canonical AAD binding an encrypted batch manifest to its org, run ID,
 * anchored Merkle root, and token symbol.
 */
export function buildManifestAad(params: {
  orgId: string;
  payrollRunId: string;
  merkleRoot: string;
  tokenSymbol: string;
}): Buffer {
  return Buffer.from(
    `aegis:manifest:v1|${params.orgId}|${params.payrollRunId}|${params.merkleRoot}|${params.tokenSymbol}`,
    "utf-8"
  );
}

/**
 * Encrypts a viewing key with AES-256-GCM (optional GCM AAD for scope binding).
 *
 * @param plaintext - The raw viewing key bytes to encrypt
 * @param keyId - Unique key identifier (for HKDF derivation)
 * @param aad - Optional Additional Authenticated Data binding scope metadata
 * @returns A single Buffer: iv (12) || authTag (16) || ciphertext (N)
 */
export function encryptViewingKey(
  plaintext: Buffer,
  keyId: string,
  aad?: Buffer
): Buffer {
  const derivedKey = deriveKey(keyId);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
  if (aad) {
    cipher.setAAD(aad);
  }
  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack as: iv || authTag || ciphertext
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypts a viewing key from the packed ciphertext blob.
 *
 * @param packed - The stored blob: iv (12) || authTag (16) || ciphertext (N)
 * @param keyId - Unique key identifier (for HKDF derivation)
 * @param aad - Optional Additional Authenticated Data (must match encryption AAD)
 * @returns The decrypted viewing key bytes
 * @throws If authentication fails (tampered ciphertext, altered scope AAD, or wrong key)
 */
export function decryptViewingKey(
  packed: Buffer,
  keyId: string,
  aad?: Buffer
): Buffer {
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Ciphertext blob is too short to contain iv + authTag + data.");
  }

  const derivedKey = deriveKey(keyId);
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", derivedKey, iv);
  if (aad) {
    decipher.setAAD(aad);
  }
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypts a batch payroll audit manifest using a per-run subkey derived from
 * the organization's audit viewing key. Stored as base64(iv || authTag || ciphertext).
 */
export function encryptBatchManifest(
  manifestJson: string,
  orgAuditKey: Buffer,
  payrollRunId: string,
  aad: Buffer
): string {
  const runKey = Buffer.from(
    hkdfSync("sha256", orgAuditKey, Buffer.from(payrollRunId, "utf-8"), HKDF_MANIFEST_INFO, KEY_LENGTH)
  );
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", runKey, iv);
  cipher.setAAD(aad);

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(manifestJson, "utf-8")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/**
 * Decrypts a batch payroll audit manifest using an authorized orgAuditKey
 * unwrapped from an auditor's scoped viewing key.
 */
export function decryptBatchManifest(
  encryptedBase64: string,
  orgAuditKey: Buffer,
  payrollRunId: string,
  aad: Buffer
): string {
  const packed = Buffer.from(encryptedBase64, "base64");
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Encrypted manifest blob is too short.");
  }

  const runKey = Buffer.from(
    hkdfSync("sha256", orgAuditKey, Buffer.from(payrollRunId, "utf-8"), HKDF_MANIFEST_INFO, KEY_LENGTH)
  );
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", runKey, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

/**
 * Hashes an auditor identity with a unique, per-key cryptographic salt.
 * Used to store `auditor_identity_hash` in the viewing_keys table
 * without revealing the auditor's email or wallet address.
 *
 * @param identity - The auditor's email or wallet address (plaintext)
 * @param salt - A unique, cryptographically random salt for this auditor/key pair
 * @returns Hex-encoded SHA-256 hash of (salt || identity)
 */
export function hashAuditorIdentity(identity: string, salt: string): string {
  return createHash("sha256")
    .update(salt)
    .update(identity)
    .digest("hex");
}

/**
 * Generates a cryptographically secure random salt for auditor identity hashing.
 * Each auditor viewing key MUST use a unique salt.
 *
 * @returns 32-byte hex-encoded salt string
 */
export function generateAuditorSalt(): string {
  return randomBytes(32).toString("hex");
}
