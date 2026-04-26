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
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16; // GCM auth tag length
const KEY_LENGTH = 32; // AES-256

/**
 * Returns the master secret from the environment.
 * Throws if not set or malformed.
 */
function getMasterSecret(): Buffer {
  const hex = process.env.AEGIS_MASTER_SECRET;
  if (!hex || hex.length !== 64) {
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
 * Encrypts a viewing key with AES-256-GCM.
 *
 * @param plaintext - The raw viewing key bytes to encrypt
 * @param keyId - Unique key identifier (for HKDF derivation)
 * @returns A single Buffer: iv (12) || authTag (16) || ciphertext (N)
 */
export function encryptViewingKey(
  plaintext: Buffer,
  keyId: string
): Buffer {
  const derivedKey = deriveKey(keyId);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
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
 * @returns The decrypted viewing key bytes
 * @throws If authentication fails (tampered ciphertext or wrong key)
 */
export function decryptViewingKey(
  packed: Buffer,
  keyId: string
): Buffer {
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Ciphertext blob is too short to contain iv + authTag + data.");
  }

  const derivedKey = deriveKey(keyId);
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", derivedKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
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
