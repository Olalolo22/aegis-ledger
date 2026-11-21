import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

/**
 * Client-Side Zero-Knowledge Audit Envelope Encryption (WebCrypto).
 *
 * Security model ("Can Aegis servers read customer payroll?"):
 *   NO — cryptographically impossible.
 *
 * How it works:
 * 1. Each organization holds an RSA-OAEP-256 (2048-bit) keypair client-side.
 *    Only the SPKI public key is registered; the private key never leaves the
 *    organization's browser/vault.
 * 2. On every payroll batch, the browser generates a fresh random 256-bit
 *    AES-GCM Data Encryption Key (DEK), encrypts the batch manifest with a
 *    random 12-byte IV and canonical AAD (`orgId|payrollRunId|merkleRoot|tokenSymbol`),
 *    and wraps the DEK to the organization's public key (`orgWrappedDek`).
 * 3. Aegis servers and Postgres store ONLY the ciphertext (`EncryptedAuditEnvelope`).
 *    Compromising both Postgres AND `AEGIS_MASTER_SECRET` still cannot decrypt
 *    any payroll manifest.
 * 4. To grant scoped auditor access, the organization's browser unwraps ONLY
 *    the DEKs for batches inside `[valid_from, valid_until]` and `allowed_tokens`,
 *    re-wraps those DEKs to the auditor's public key (`auditorWrappedDek`), and
 *    submits ONLY the wrapped ciphertexts. The auditor decrypts manifests locally
 *    in their browser using their own private key.
 *
 * Cryptographic vs. Policy boundaries:
 * - Confidentiality from Aegis servers: CRYPTOGRAPHIC (server never holds private keys).
 * - Batch & token scope isolation: CRYPTOGRAPHIC (out-of-scope DEKs are never wrapped
 *   for the auditor's public key).
 * - Time-window expiry & key revocation: API DELIVERY POLICY (revoking a key or passing
 *   `valid_until` blocks further ciphertext delivery from `/api/audit/decrypt`; like all
 *   E2EE systems, it cannot retroactively erase plaintext already decrypted locally).
 */

const AES_IV_LENGTH = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface AuditKeyPair {
  /** Base64-encoded SubjectPublicKeyInfo (SPKI) RSA-OAEP-256 public key */
  publicKeySpkiBase64: string;
  /** Base64-encoded PKCS#8 RSA-OAEP-256 private key (CLIENT-SIDE ONLY — never upload) */
  privateKeyPkcs8Base64: string;
  /** SHA-256 hex fingerprint of SPKI public key bytes (first 16 hex chars) */
  fingerprint: string;
}

export interface EncryptedAuditEnvelope {
  version: 2;
  scheme: "RSA-OAEP-256+AES-256-GCM";
  /** First 16 hex chars of SHA-256(org SPKI public key) */
  orgPublicKeyFingerprint: string;
  /** Base64(iv(12) || ciphertext || authTag(16)) encrypted under random 256-bit DEK */
  encryptedManifest: string;
  /** Base64 RSA-OAEP-256 wrapped 32-byte DEK for the organization's public key */
  orgWrappedDek: string;
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
 * Generates an RSA-OAEP-256 (2048-bit) keypair for an organization or auditor.
 * MUST be executed client-side; never transmit `privateKeyPkcs8Base64` to the server.
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

/**
 * Encrypts a batch payroll manifest client-side using a fresh random 256-bit
 * AES-GCM DEK wrapped to the organization's RSA-OAEP-256 public key.
 *
 * Aegis servers receive ONLY the returned `envelope` and can never decrypt it.
 */
export async function encryptManifestClientSide(
  manifestJson: string,
  orgPublicKeySpkiBase64: string,
  aadParams: {
    orgId: string;
    payrollRunId: string;
    merkleRoot: string;
    tokenSymbol: string;
  }
): Promise<{ envelope: EncryptedAuditEnvelope; rawDekBytes: Uint8Array }> {
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

  // 3. Wrap raw 32-byte DEK to organization's RSA-OAEP-256 public key
  const orgPubKey = await importPublicKey(orgPublicKeySpkiBase64);
  const wrappedDekBytes = new Uint8Array(
    await subtle.encrypt(
      { name: "RSA-OAEP" },
      orgPubKey,
      toArrayBuffer(rawDekBytes)
    )
  );

  const envelope: EncryptedAuditEnvelope = {
    version: 2,
    scheme: "RSA-OAEP-256+AES-256-GCM",
    orgPublicKeyFingerprint: getPublicKeyFingerprint(orgPublicKeySpkiBase64),
    encryptedManifest: bytesToBase64(packed),
    orgWrappedDek: bytesToBase64(wrappedDekBytes),
    aad,
  };

  return { envelope, rawDekBytes };
}

/**
 * Unwraps a batch DEK using the organization's private key (client-side only)
 * and re-wraps it to an authorized auditor's RSA-OAEP-256 public key.
 *
 * Only in-scope batches are re-wrapped, cryptographically enforcing scope.
 */
export async function reWrapDekForAuditor(
  orgWrappedDekBase64: string,
  orgPrivateKeyPkcs8Base64: string,
  auditorPublicKeySpkiBase64: string
): Promise<string> {
  const subtle = getSubtle();
  const orgPrivKey = await importPrivateKey(orgPrivateKeyPkcs8Base64);
  const auditorPubKey = await importPublicKey(auditorPublicKeySpkiBase64);

  const rawDekBytes = new Uint8Array(
    await subtle.decrypt(
      { name: "RSA-OAEP" },
      orgPrivKey,
      toArrayBuffer(base64ToBytes(orgWrappedDekBase64))
    )
  );

  if (rawDekBytes.length !== 32) {
    throw new Error("Unwrapped DEK has invalid length.");
  }

  const auditorWrapped = new Uint8Array(
    await subtle.encrypt(
      { name: "RSA-OAEP" },
      auditorPubKey,
      toArrayBuffer(rawDekBytes)
    )
  );

  return bytesToBase64(auditorWrapped);
}

/**
 * Decrypts an `EncryptedAuditEnvelope` locally on the client using either the
 * organization's private key (with `envelope.orgWrappedDek`) OR an auditor's
 * private key (with `auditorWrappedDekBase64`).
 *
 * Also verifies that `expectedAad` (if provided, reconstructed from on-chain
 * root + run metadata) matches `envelope.aad` before decrypting.
 */
export async function decryptManifestClientSide(
  envelope: EncryptedAuditEnvelope,
  privateKeyPkcs8Base64: string,
  options?: {
    wrappedDekBase64?: string;
    expectedAad?: string;
  }
): Promise<string> {
  if (options?.expectedAad && envelope.aad !== options.expectedAad) {
    throw new Error("Envelope AAD does not match expected batch metadata / on-chain Merkle root.");
  }

  const subtle = getSubtle();
  const privKey = await importPrivateKey(privateKeyPkcs8Base64);
  const wrappedDekB64 = options?.wrappedDekBase64 || envelope.orgWrappedDek;

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

/**
 * Browser-local helper to retrieve or generate the organization's E2EE audit
 * keypair in browser storage (private key stays strictly local to the browser).
 */
export async function getOrCreateLocalOrgAuditKeyPair(
  orgId: string
): Promise<AuditKeyPair> {
  const storageKey = `aegis:org-audit-keypair:v2:${orgId}`;
  if (typeof window !== "undefined" && window.localStorage) {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as AuditKeyPair;
        if (parsed.publicKeySpkiBase64 && parsed.privateKeyPkcs8Base64 && parsed.fingerprint) {
          return parsed;
        }
      } catch {
        // Re-generate below if corrupted
      }
    }
    const generated = await generateAuditKeyPair();
    window.localStorage.setItem(storageKey, JSON.stringify(generated));
    return generated;
  }
  return generateAuditKeyPair();
}
