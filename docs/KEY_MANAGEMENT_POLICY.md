# Aegis Ledger — Organization Key Custody, Rotation & Recovery Policy

> **Scope:** Enterprise governance and operational policy for client-side E2EE organization audit keys (`RSA-OAEP-256 + AES-256-GCM`) protecting historical payroll manifests across statutory retention periods (typically 5–7+ years).

---

## 1. Key Hierarchy & Zero-Trust Boundary

| Key Layer | Algorithm | Generated Where | Stored Where | Server Visibility |
| :--- | :--- | :--- | :--- | :--- |
| **Batch DEK** | Random 256-bit AES-GCM key | Admin browser (fresh per payroll run) | Wrapped inside `payroll_runs.e2ee_envelope.orgWrappedDeks` | **None** (RSA-OAEP ciphertext only) |
| **Admin Keypair** | RSA-OAEP-256 (2048-bit) | Admin browser (`WebCrypto`) | Public SPKI in `org_key_vaults`; private key **encrypted** via PBKDF2-SHA256 + AES-256-GCM | **None** (never transmitted in plaintext) |
| **Vault Passphrase** | High-entropy secret (≥ 12 chars, recommended 20+ char diceware) | Corporate password manager (1Password / Bitwarden / Hardware Vault) | Organization custodian vault (never on Aegis servers) | **None** |
| **Auditor Keypair** | RSA-OAEP-256 (2048-bit) | Auditor or admin browser | Public SPKI in `viewing_keys`; private key delivered out-of-band to auditor | **None** |

**Explicit Prohibition:** Organization private keys are **never** stored in plaintext in `window.localStorage`, `window.sessionStorage`, cookies, or application databases. When unlocked, the admin private key resides exclusively in volatile browser memory (`src/lib/e2ee.ts`) and is wiped when locked or when the browser tab closes.

---

## 2. Passphrase-Encrypted Key Vault Specification

Each organization admin's private key is protected client-side before backup to `org_key_vaults` (`/api/org/key-vault`) or offline export:

- **KDF:** `PBKDF2-HMAC-SHA256` with **600,000 iterations** and a fresh random 16-byte salt per vault.
- **Cipher:** `AES-256-GCM` with a fresh random 12-byte IV.
- **Authenticated Additional Data (AAD):** `aegis:vault:v1|<orgId>|<role>|<fingerprint>` — cryptographically binds the encrypted private key to the organization, role, and public key fingerprint so cross-org or role-substitution tampering fails GCM authentication.
- **Offline Recovery Kit:** Immediately upon vault creation, admins download `aegis-recovery-kit-<fingerprint>.json` (`serializeRecoveryKit`) and store it in an offline corporate vault or enterprise password manager separate from Aegis.

---

## 3. Mandatory Multi-Admin Custody (2+ Custodians)

To eliminate single-person lockout and satisfy statutory payroll retention requirements:

1. **Primary Finance Admin (`role: "primary"`):** Day-to-day payroll coordinator (e.g., Head of Finance / Ops Lead).
2. **Backup Controller (`role: "backup_controller"`):** Required second custodian (e.g., Co-Founder / CFO / Legal Counsel) with an independent RSA-OAEP-256 keypair and independent passphrase.
3. **Optional Break-Glass Recovery Custodian (`role: "recovery"`):** Offline hardware-backed or escrow-held keypair stored in corporate safe / board vault.

**Multi-Admin DEK Wrapping:** Every payroll batch's random 256-bit DEK is wrapped client-side to **all active organization admin public keys** (`e2ee_envelope.orgWrappedDeks[fingerprint]`). Either the Primary Admin or Backup Controller can independently unwrap historical payroll runs, issue scoped auditor viewing keys, or onboard replacement admins.

---

## 4. Admin Offboarding & Scheduled Key Rotation

### Mandatory Triggers
- **Immediate (within 24 hours):** Departure, role change, or suspected device/passphrase compromise of any admin custodian.
- **Scheduled:** Annual key rotation across all active admin vaults.

### Zero-Trust Rotation Procedure (`PATCH /api/org/key-vault`)
1. **Onboard Replacement Custodian:** The incoming admin initializes a fresh RSA-OAEP-256 keypair + passphrase-encrypted vault (`POST /api/org/key-vault`) and exports their offline Recovery Kit.
2. **Client-Side DEK Re-Wrapping:** A remaining active admin (e.g., Backup Controller) unlocks their vault in memory, fetches historical `org_wrapped_deks` via `GET /api/payroll`, unwraps each batch DEK locally, and re-wraps it to the incoming admin's public key (`reWrapDekForNewAdmin`).
3. **Revoke Departing Key:** Submit `PATCH /api/org/key-vault` with `revoke_fingerprint`, `new_admin_fingerprint`, and `rewrapped_batch_deks`.
   - The API enforces a **last-admin protection guard** (`HTTP 409 LAST_ADMIN_KEY_PROTECTED`) so an organization can never accidentally revoke its final active custodian and orphan historical records.
   - The departing admin's key is marked `rotated`/`revoked`, their wrapped DEK slot is stripped from updated envelopes, and an immutable `org_admin_key_rotated` audit log event is recorded.

---

## 5. Break-Glass Recovery & Statutory Retention

- **Browser/Device Loss:** Because encrypted vaults are persisted in `org_key_vaults` (and backed up offline via Recovery Kit JSON), clearing browser cache or losing a laptop has **zero impact** on payroll history — the admin unlocks on any new device using their passphrase.
- **Forgotten Passphrase (Single Admin):** The Backup Controller unlocks their independent vault, generates a new vault for the affected admin, and re-wraps historical DEKs via the rotation procedure above.
- **Catastrophic Dual-Admin Loss:** Retrieve the offline Break-Glass Recovery Kit (`role: "recovery"`) + sealed passphrase from the corporate safe/escrow, unlock locally via `parseRecoveryKit` + `decryptPrivateKeyWithPassphrase`, and rotate in new Primary and Backup admins.
- **Retention Guarantee:** Solana L1 Merkle root anchors (`aegis:merkle:v1:<root>:<count>`) remain permanently verifiable on-chain, and organizations may periodically export encrypted batch archives alongside their Recovery Kits to independently satisfy 7-year tax and labor-law retention independent of Aegis infrastructure availability.
