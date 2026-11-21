import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

/**
 * Client-Side Zero-Knowledge Audit Envelope Encryption & Passphrase-Protected
 * Multi-Admin Key Vault (WebCrypto).
 *
 * Security model ("Can Aegis servers read customer payroll?"):
 *   NO — cryptographically impossible for on-chain shielded payroll and stored
 *   audit manifests. Aegis servers never receive individual salaries, employee
 *   wallets, leaf blinding salts, Merkle sum proofs, or private decryption keys.
 *
 * Key Custody & Multi-Admin Lifecycle (see docs/KEY_MANAGEMENT_POLICY.md):
 * 1. Organization admin private keys are NEVER stored in plaintext in
 *    `window.localStorage` or `sessionStorage`.
 * 2. Each admin's RSA-OAEP-256 private key is encrypted client-side with a
 *    strong passphrase via PBKDF2-SHA256 (600,000 iterations) + AES-256-GCM
 *    (`EncryptedPrivateKeyVault`) before being backed up to `/api/org/key-vault`
 *    or exported as an offline Recovery Kit JSON.
 * 3. Unlocked keys live strictly in ephemeral JavaScript memory for the active
 *    session and are wiped when locked or when the tab closes.
 * 4. Every payroll batch's random 256-bit AES-GCM DEK is wrapped to ALL active
 *    organization admins (`orgWrappedDeks` — e.g., Primary Finance Admin +
 *    Backup Controller), preventing single-admin lockout and enabling clean
 *    offboarding rotation without server access to plaintext.
 */

const AES_IV_LENGTH = 12;
const PBKDF2_SALT_LENGTH = 16;
export const VAULT_PBKDF2_ITERATIONS = 600_000;
export const MIN_VAULT_PASSPHRASE_LENGTH = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type OrgAdminRole = "primary" | "backup_controller" | "recovery";

export interface AuditKeyPair {
  /** Base64-encoded SubjectPublicKeyInfo (SPKI) RSA-OAEP-256 public key */
  publicKeySpkiBase64: string;
  /** Base64-encoded PKCS#8 RSA-OAEP-256 private key (MEMORY-ONLY when unlocked) */
  privateKeyPkcs8Base64: string;
  /** SHA-256 hex fingerprint of SPKI public key bytes (first 16 hex chars) */
  fingerprint: string;
}

export interface EncryptedPrivateKeyVault {
  version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  cipher: "AES-256-GCM";
  orgId: string;
  adminLabel: string;
  role: OrgAdminRole;
  publicKeySpkiBase64: string;
  fingerprint: string;
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
  aad: string;
  createdAt: string;
}

export interface EncryptedAuditEnvelope {
  version: 2;
  scheme: "RSA-OAEP-256+AES-256-GCM";
  /** First 16 hex chars of SHA-256(primary org admin SPKI public key) */
  orgPublicKeyFingerprint: string;
  /** Base64(iv(12) || ciphertext || authTag(16)) encrypted under random 256-bit DEK */
  encryptedManifest: string;
  /** Primary admin's Base64 RSA-OAEP-256 wrapped 32-byte DEK */
  orgWrappedDek: string;
  /**
   * Multi-admin map: `adminFingerprint -> Base64 RSA-OAEP-256 wrapped 32-byte DEK`.
   * Allows Primary Finance Admin + Backup Controller (2+ admins) to unwrap and
   * rotate keys independently without single-person lockout.
   */
  orgWrappedDeks?: Record<string, string>;
  /** Canonical GCM AAD string binding org, run, Merkle root, and token */
  aad: string;
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto subtle API is unavailable in this runtime.");
  }
  return subtle;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Computes a deterministic 16-hex-char fingerprint for a Base64 SPKI public key.
 */
export function getPublicKeyFingerprint(publicKeySpkiBase64: string): string {
  const spkiBytes = base64ToBytes(publicKeySpkiBase64);
  return bytesToHex(sha256(spkiBytes)).slice(0, 16);
}

/**
 * Builds canonical GCM AAD binding an E2EE manifest ciphertext to its org,
 * payroll run ID, L1-anchored Merkle root, and token symbol.
 */
export function buildEnvelopeAad(params: {
  orgId: string;
  payrollRunId: string;
  merkleRoot: string;
  tokenSymbol: string;
}): string {
  return `aegis:e2ee:v2|${params.orgId}|${params.payrollRunId}|${params.merkleRoot}|${params.tokenSymbol}`;
}

/**
 * Builds canonical GCM AAD binding a passphrase-encrypted private key vault
 * to its organization, admin role, and public-key fingerprint.
 */
export function buildKeyVaultAad(params: {
  orgId: string;
  role: OrgAdminRole;
  fingerprint: string;
}): string {
  return `aegis:vault:v1|${params.orgId}|${params.role}|${params.fingerprint}`;
}

/**
 * Generates an RSA-OAEP-256 (2048-bit) keypair for an organization admin or auditor.
 * MUST be executed client-side; never transmit `privateKeyPkcs8Base64` in plaintext.
 */
export async function generateAuditKeyPair(): Promise<AuditKeyPair> {
  const subtle = getSubtle();
  const keyPair = await subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );

  const spki = new Uint8Array(await subtle.exportKey("spki", keyPair.publicKey));
  const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", keyPair.privateKey));

  const publicKeySpkiBase64 = bytesToBase64(spki);
  const privateKeyPkcs8Base64 = bytesToBase64(pkcs8);

  return {
    publicKeySpkiBase64,
    privateKeyPkcs8Base64,
    fingerprint: getPublicKeyFingerprint(publicKeySpkiBase64),
  };
}

async function importPublicKey(spkiBase64: string): Promise<CryptoKey> {
  const subtle = getSubtle();
  const spkiBytes = base64ToBytes(spkiBase64);
  return subtle.importKey(
    "spki",
    toArrayBuffer(spkiBytes),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
}

async function importPrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
  const subtle = getSubtle();
  const pkcs8Bytes = base64ToBytes(pkcs8Base64);
  return subtle.importKey(
    "pkcs8",
    toArrayBuffer(pkcs8Bytes),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );
}

async function deriveVaultWrappingKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const baseKey = await subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(passphrase)),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts an organization admin's RSA-OAEP private key client-side under a
 * strong passphrase using PBKDF2-SHA256 (600,000 iterations) + AES-256-GCM.
 *
 * The resulting `EncryptedPrivateKeyVault` is safe to persist in Postgres
 * (`/api/org/key-vault`) or export as an offline Recovery Kit JSON.
 */
export async function encryptPrivateKeyWithPassphrase(
  keyPair: AuditKeyPair,
  passphrase: string,
  meta: {
    orgId: string;
    adminLabel: string;
    role: OrgAdminRole;
    iterations?: number;
  }
): Promise<EncryptedPrivateKeyVault> {
  if (!passphrase || passphrase.length < MIN_VAULT_PASSPHRASE_LENGTH) {
    throw new Error(
      `Vault passphrase must be at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters.`
    );
  }

  const iterations = meta.iterations ?? VAULT_PBKDF2_ITERATIONS;
  if (iterations < 100_000) {
    throw new Error("PBKDF2 iterations must be at least 100,000.");
  }

  const subtle = getSubtle();
  const salt = new Uint8Array(PBKDF2_SALT_LENGTH);
  const iv = new Uint8Array(AES_IV_LENGTH);
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);

  const aad = buildKeyVaultAad({
    orgId: meta.orgId,
    role: meta.role,
    fingerprint: keyPair.fingerprint,
  });

  const wrappingKey = await deriveVaultWrappingKey(passphrase, salt, iterations);
  const ciphertext = new Uint8Array(
    await subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(encoder.encode(aad)),
      },
      wrappingKey,
      toArrayBuffer(encoder.encode(keyPair.privateKeyPkcs8Base64))
    )
  );

  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    cipher: "AES-256-GCM",
    orgId: meta.orgId,
    adminLabel: meta.adminLabel,
    role: meta.role,
    publicKeySpkiBase64: keyPair.publicKeySpkiBase64,
    fingerprint: keyPair.fingerprint,
    saltBase64: bytesToBase64(salt),
    ivBase64: bytesToBase64(iv),
    ciphertextBase64: bytesToBase64(ciphertext),
    aad,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Unlocks a passphrase-encrypted admin key vault strictly in client memory.
 * Fails loudly on wrong passphrase, tampered ciphertext, or tampered vault metadata.
 */
export async function decryptPrivateKeyWithPassphrase(
  vault: EncryptedPrivateKeyVault,
  passphrase: string
): Promise<AuditKeyPair> {
  const expectedAad = buildKeyVaultAad({
    orgId: vault.orgId,
    role: vault.role,
    fingerprint: vault.fingerprint,
  });
  if (vault.aad !== expectedAad) {
    throw new Error("Key vault AAD does not match vault org/role/fingerprint metadata.");
  }

  const expectedFp = getPublicKeyFingerprint(vault.publicKeySpkiBase64);
  if (expectedFp !== vault.fingerprint) {
    throw new Error("Key vault fingerprint does not match stored SPKI public key.");
  }

  const subtle = getSubtle();
  const salt = base64ToBytes(vault.saltBase64);
  const iv = base64ToBytes(vault.ivBase64);
  const ciphertext = base64ToBytes(vault.ciphertextBase64);

  const wrappingKey = await deriveVaultWrappingKey(passphrase, salt, vault.iterations);

  let plaintextBytes: ArrayBuffer;
  try {
    plaintextBytes = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(encoder.encode(vault.aad)),
      },
      wrappingKey,
      toArrayBuffer(ciphertext)
    );
  } catch {
    throw new Error("Incorrect vault passphrase or corrupted key vault.");
  }

  const privateKeyPkcs8Base64 = decoder.decode(plaintextBytes);
  // Sanity-check key parses cleanly as PKCS#8 RSA-OAEP-256
  await importPrivateKey(privateKeyPkcs8Base64);

  return {
    publicKeySpkiBase64: vault.publicKeySpkiBase64,
    privateKeyPkcs8Base64,
    fingerprint: vault.fingerprint,
  };
}

/**
 * Exports a passphrase-encrypted vault as a portable offline Recovery Kit JSON.
 */
export function serializeRecoveryKit(vault: EncryptedPrivateKeyVault): string {
  return JSON.stringify(
    {
      format: "aegis-key-recovery-kit-v1",
      warning:
        "This file contains your passphrase-encrypted Aegis organization audit private key. Store offline in a corporate password manager or hardware vault. Aegis cannot recover your passphrase.",
      vault,
    },
    null,
    2
  );
}

/**
 * Parses an exported offline Recovery Kit JSON file back into an EncryptedPrivateKeyVault.
 */
export function parseRecoveryKit(jsonText: string): EncryptedPrivateKeyVault {
  const parsed = JSON.parse(jsonText) as {
    format?: string;
    vault?: EncryptedPrivateKeyVault;
  };
  if (parsed?.format !== "aegis-key-recovery-kit-v1" || !parsed.vault) {
    throw new Error("Invalid Aegis Recovery Kit file format.");
  }
  const v = parsed.vault;
  if (
    v.version !== 1 ||
    v.kdf !== "PBKDF2-SHA256" ||
    v.cipher !== "AES-256-GCM" ||
    !v.ciphertextBase64 ||
    !v.saltBase64 ||
    !v.ivBase64 ||
    !v.publicKeySpkiBase64
  ) {
    throw new Error("Recovery Kit vault payload is incomplete or corrupted.");
  }
  return v;
}

// ═══════════════════════════════════════════════════════════════
// Ephemeral In-Memory Session Cache (ZERO localStorage private keys)
// ═══════════════════════════════════════════════════════════════

const unlockedOrgKeyMemory = new Map<string, AuditKeyPair>();

/**
 * Holds an unlocked organization keypair strictly in volatile JS memory for
 * the current tab session. Never persisted in plaintext to `localStorage`.
 */
export function cacheUnlockedOrgKeyInMemory(orgId: string, keyPair: AuditKeyPair): void {
  unlockedOrgKeyMemory.set(orgId, keyPair);
}

/**
 * Retrieves the currently unlocked organization keypair from volatile memory,
 * or `null` if the vault is locked.
 */
export function getUnlockedOrgKeyFromMemory(orgId: string): AuditKeyPair | null {
  return unlockedOrgKeyMemory.get(orgId) ?? null;
}

/**
 * Immediately wipes the unlocked organization keypair from volatile memory.
 */
export function lockOrgKeyInMemory(orgId: string): void {
  unlockedOrgKeyMemory.delete(orgId);
}

/**
 * Encrypts a batch payroll manifest client-side using a fresh random 256-bit
 * AES-GCM DEK wrapped to ALL active organization admin public keys
 * (e.g. Primary Finance Admin + Backup Controller).
 *
 * Aegis servers receive ONLY the returned `envelope` and can never decrypt it.
 */
export async function encryptManifestClientSide(
  manifestJson: string,
  orgPublicKeysSpki: string | string[],
  aadParams: {
    orgId: string;
    payrollRunId: string;
    merkleRoot: string;
    tokenSymbol: string;
  }
): Promise<{ envelope: EncryptedAuditEnvelope; rawDekBytes: Uint8Array }> {
  const pubKeyList = Array.isArray(orgPublicKeysSpki)
    ? orgPublicKeysSpki.filter(Boolean)
    : [orgPublicKeysSpki].filter(Boolean);

  if (pubKeyList.length === 0) {
    throw new Error("At least one active organization admin public key is required.");
  }

  const subtle = getSubtle();
  const aad = buildEnvelopeAad(aadParams);

  // 1. Fresh random 256-bit DEK and 96-bit GCM IV
  const rawDekBytes = new Uint8Array(32);
  const iv = new Uint8Array(AES_IV_LENGTH);
  globalThis.crypto.getRandomValues(rawDekBytes);
  globalThis.crypto.getRandomValues(iv);

  const aesKey = await subtle.importKey(
    "raw",
    toArrayBuffer(rawDekBytes),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  // 2. Encrypt manifest with AES-256-GCM + canonical AAD
  const ciphertextWithTag = new Uint8Array(
    await subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(encoder.encode(aad)),
      },
      aesKey,
      toArrayBuffer(encoder.encode(manifestJson))
    )
  );

  const packed = new Uint8Array(iv.length + ciphertextWithTag.length);
  packed.set(iv, 0);
  packed.set(ciphertextWithTag, iv.length);

  // 3. Wrap the same 32-byte DEK to every active admin's RSA-OAEP-256 public key
  const orgWrappedDeks: Record<string, string> = {};
  let primaryFingerprint = "";
  let primaryWrappedDek = "";

  for (let i = 0; i < pubKeyList.length; i++) {
    const spki = pubKeyList[i];
    const fp = getPublicKeyFingerprint(spki);
    const pubKey = await importPublicKey(spki);
    const wrappedBytes = new Uint8Array(
      await subtle.encrypt({ name: "RSA-OAEP" }, pubKey, toArrayBuffer(rawDekBytes))
    );
    const wrappedB64 = bytesToBase64(wrappedBytes);
    orgWrappedDeks[fp] = wrappedB64;
    if (i === 0) {
      primaryFingerprint = fp;
      primaryWrappedDek = wrappedB64;
    }
  }

  const envelope: EncryptedAuditEnvelope = {
    version: 2,
    scheme: "RSA-OAEP-256+AES-256-GCM",
    orgPublicKeyFingerprint: primaryFingerprint,
    encryptedManifest: bytesToBase64(packed),
    orgWrappedDek: primaryWrappedDek,
    orgWrappedDeks,
    aad,
  };

  return { envelope, rawDekBytes };
}

/**
 * Resolves the wrapped DEK for a given admin fingerprint from an envelope
 * (supports both multi-admin `orgWrappedDeks` and legacy single `orgWrappedDek`).
 */
export function resolveAdminWrappedDek(
  envelope: Pick<EncryptedAuditEnvelope, "orgWrappedDek" | "orgWrappedDeks" | "orgPublicKeyFingerprint">,
  adminFingerprint: string
): string | null {
  if (envelope.orgWrappedDeks && envelope.orgWrappedDeks[adminFingerprint]) {
    return envelope.orgWrappedDeks[adminFingerprint];
  }
  if (envelope.orgPublicKeyFingerprint === adminFingerprint && envelope.orgWrappedDek) {
    return envelope.orgWrappedDek;
  }
  return null;
}

/**
 * Unwraps a batch DEK using an active organization admin's private key
 * (client-side only) and re-wraps it to a target RSA-OAEP-256 public key
 * (either an authorized auditor OR a newly onboarded admin during key rotation).
 */
export async function reWrapDekForRecipientPublicKey(
  existingWrappedDekBase64: string,
  activeAdminPrivateKeyPkcs8Base64: string,
  targetPublicKeySpkiBase64: string
): Promise<string> {
  const subtle = getSubtle();
  const activePrivKey = await importPrivateKey(activeAdminPrivateKeyPkcs8Base64);
  const targetPubKey = await importPublicKey(targetPublicKeySpkiBase64);

  const rawDekBytes = new Uint8Array(
    await subtle.decrypt(
      { name: "RSA-OAEP" },
      activePrivKey,
      toArrayBuffer(base64ToBytes(existingWrappedDekBase64))
    )
  );

  if (rawDekBytes.length !== 32) {
    throw new Error("Unwrapped DEK has invalid length.");
  }

  const reWrapped = new Uint8Array(
    await subtle.encrypt(
      { name: "RSA-OAEP" },
      targetPubKey,
      toArrayBuffer(rawDekBytes)
    )
  );

  return bytesToBase64(reWrapped);
}

/**
 * Unwraps a batch DEK using an org admin's private key (client-side only)
 * and re-wraps it to an authorized auditor's RSA-OAEP-256 public key.
 * Only in-scope batches are re-wrapped, cryptographically enforcing scope.
 */
export async function reWrapDekForAuditor(
  orgWrappedDekBase64: string,
  orgPrivateKeyPkcs8Base64: string,
  auditorPublicKeySpkiBase64: string
): Promise<string> {
  return reWrapDekForRecipientPublicKey(
    orgWrappedDekBase64,
    orgPrivateKeyPkcs8Base64,
    auditorPublicKeySpkiBase64
  );
}

/**
 * Rotates admin access on a batch DEK client-side (e.g., when Primary Admin
 * departs and Backup Controller onboards a replacement admin).
 */
export async function reWrapDekForNewAdmin(
  existingWrappedDekBase64: string,
  activeAdminPrivateKeyPkcs8Base64: string,
  newAdminPublicKeySpkiBase64: string
): Promise<string> {
  return reWrapDekForRecipientPublicKey(
    existingWrappedDekBase64,
    activeAdminPrivateKeyPkcs8Base64,
    newAdminPublicKeySpkiBase64
  );
}

/**
 * Decrypts an `EncryptedAuditEnvelope` locally on the client using either an
 * organization admin's private key (via `adminFingerprint` or `orgWrappedDek`)
 * OR an auditor's private key (via `wrappedDekBase64`).
 */
export async function decryptManifestClientSide(
  envelope: EncryptedAuditEnvelope,
  privateKeyPkcs8Base64: string,
  options?: {
    wrappedDekBase64?: string;
    adminFingerprint?: string;
    expectedAad?: string;
  }
): Promise<string> {
  if (options?.expectedAad && envelope.aad !== options.expectedAad) {
    throw new Error(
      "Envelope AAD does not match expected batch metadata / on-chain Merkle root."
    );
  }

  const subtle = getSubtle();
  const privKey = await importPrivateKey(privateKeyPkcs8Base64);

  let wrappedDekB64 = options?.wrappedDekBase64;
  if (!wrappedDekB64 && options?.adminFingerprint) {
    wrappedDekB64 =
      resolveAdminWrappedDek(envelope, options.adminFingerprint) ?? undefined;
  }
  if (!wrappedDekB64) {
    wrappedDekB64 = envelope.orgWrappedDek;
  }

  const rawDekBytes = new Uint8Array(
    await subtle.decrypt(
      { name: "RSA-OAEP" },
      privKey,
      toArrayBuffer(base64ToBytes(wrappedDekB64))
    )
  );

  const aesKey = await subtle.importKey(
    "raw",
    toArrayBuffer(rawDekBytes),
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const packed = base64ToBytes(envelope.encryptedManifest);
  if (packed.length < AES_IV_LENGTH + 17) {
    throw new Error("Encrypted manifest payload is truncated.");
  }

  const iv = packed.subarray(0, AES_IV_LENGTH);
  const ciphertextWithTag = packed.subarray(AES_IV_LENGTH);

  const plaintext = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(encoder.encode(envelope.aad)),
    },
    aesKey,
    toArrayBuffer(ciphertextWithTag)
  );

  return decoder.decode(plaintext);
}
