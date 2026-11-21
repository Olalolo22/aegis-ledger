import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  hkdfSync,
} from "crypto";

/**
 * Server-side AES-256-GCM scope attestation & JWT key derivation utilities.
 *
 * Zero-Knowledge Separation:
 * - Payroll manifest encryption/decryption NEVER uses `AEGIS_MASTER_SECRET`.
 *   Batch manifests are encrypted strictly client-side via RSA-OAEP-256 +
 *   AES-256-GCM (`src/lib/e2ee.ts`) so Aegis servers cannot read customer payroll.
 * - `AEGIS_MASTER_SECRET` is used exclusively for:
 *     1. Authenticating viewing-key scope metadata with GCM AAD (`aegis-viewing-key`)
 *     2. Deriving a domain-separated HS256 JWT signing key (`aegis-audit-jwt-v1`)
 */

const HKDF_INFO = "aegis-viewing-key";
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
 * Derives a dedicated domain-separated 32-byte key for signing auditor JWTs,
 * avoiding direct reuse of AEGIS_MASTER_SECRET across cryptographic domains.
 */
export function deriveJwtSigningKey(): Uint8Array {
  const masterSecret = getMasterSecret();
  const derived = hkdfSync(
    "sha256",
    masterSecret,
    Buffer.from("jwt", "utf-8"),
    HKDF_JWT_INFO,
    KEY_LENGTH
  );
  return new Uint8Array(derived);
}

/**
 * Builds canonical Additional Authenticated Data (AAD) binding a viewing key
 * record to its organization, temporal window, and allowed tokens.
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
 * Encrypts a viewing-key scope attestation with AES-256-GCM (with optional AAD).
 *
 * @param plaintext - Bytes to seal
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
 * Verifies & decrypts a viewing-key scope attestation from the packed blob.
 *
 * @param packed - The stored blob: iv (12) || authTag (16) || ciphertext (N)
 * @param keyId - Unique key identifier (for HKDF derivation)
 * @param aad - Optional Additional Authenticated Data (must match encryption AAD)
 * @returns The decrypted bytes
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
 * Hashes an auditor identity with a unique, per-key cryptographic salt.
 * Used to store `auditor_identity_hash` in the viewing_keys table
 * without revealing the auditor's email or wallet address.
 */
export function hashAuditorIdentity(identity: string, salt: string): string {
  return createHash("sha256")
    .update(salt)
    .update(identity)
    .digest("hex");
}

/**
 * Generates a cryptographically secure random salt for auditor identity hashing.
 */
export function generateAuditorSalt(): string {
  return randomBytes(32).toString("hex");
}
