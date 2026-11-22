# Aegis — Confidential Payroll & Auditable Manifests for Solana Teams

> **Pay distributed teams in USDC without broadcasting salaries on public Solana L1 — with browser-direct zero-trust audit proofs.**  
> Finished core: MagicBlock Private Ephemeral Rollups (Private SPL / Intel TDX TEE), Solana L1-Anchored Binary Merkle Sum Trees, Blind-Server Multi-Admin E2EE Audit Envelopes, Wallet-Native SIWS Auth, and Direct Browser-to-L1 Completeness Verification.  
> In progress: Pluggable NGN/KES off-ramp adapter & partner-signed fiat disbursement receipts.

---

[![Solana](https://img.shields.io/badge/Solana-World's_Fair-9945FF?style=flat-square&logo=solana)](https://colosseum.com/worldsfair)
[![Superteam NG](https://img.shields.io/badge/Track-Superteam_Nigeria-green?style=flat-square)](https://superteam.fun/earn/listing/colosseum-crypto-worlds-fair-hackathon-superteam-nigeria-track)
[![MagicBlock](https://img.shields.io/badge/Execution-MagicBlock_PER_(TEE)-blue?style=flat-square)](https://magicblock.gg)
[![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)](LICENSE)

---

## Branch & Canonical Architecture

- **`feature/zero-trust-refactor` (active / canonical):** MagicBlock Private Ephemeral Rollups (Private SPL API + Intel TDX TEE), blind-server coordination & confirmation (zero individual salaries, wallets, salts, or sum-tree proofs ever touch `/api/payroll` or `/api/payroll/confirm`), unconditional Solana L1 Merkle Sum Tree anchoring, browser-direct L1 reconciliation, passphrase-encrypted multi-admin key vaults (`PBKDF2-SHA256 + AES-256-GCM`, zero raw `localStorage` keys), wallet-native SIWS org auth, and a pluggable NGN/KES off-ramp adapter (sandbox-tested; live partner rails & partner-signed receipts in progress).
- **`main` (legacy archive):** Earlier Cloak devnet integration retained for git history after Cloak retired devnet (`api.devnet.cloak.ag` offline; Cloak is now mainnet-only).

---

## Architecture & Settlement Flow

```
       1. CLIENT-SIDE PLAN             2. PER EXECUTION + L1 ANCHOR             3. VERIFIED SETTLEMENT
  ┌─────────────────────────┐    ┌────────────────────────────────────┐   ┌─────────────────────────────────┐
  │ Lead Dev (Lagos): $3,800│ ─► │ Binary SHA-256 Merkle Sum Tree     │ ─►│ MagicBlock Private SPL (LIVE)   │
  │ iOS Dev (Nairobi):$2,600│    │ MagicBlock Private SPL (ephemeral) │   │ (wire-decoded in auditor UI)    │
  │ Fellow (Global):  $3,500│    │ Memo: aegis:leaf:<64-hex> (strict) │ ─►│ NGN/KES Off-Ramp Adapter (WIP)  │
  │ (Never sent plaintext   │    │ L1 Memo: aegis:merkle:v1:root:cnt  │   │ (sandbox FX + signed-receipt    │
  │  to /api/payroll or     │    │ Multi-Admin E2EE Envelope          │   │  partner receipts in progress)  │
  │  /api/payroll/confirm)  │    └────────────────────────────────────┘   └─────────────────────────────────┘
  └─────────────────────────┘                      │
                                                   ▼
                                 4. ZERO-TRUST AUDITOR VERIFICATION (BROWSER)
                                 ┌──────────────────────────────────────────┐
                                 │ 1. Pull every anchor directly off L1 RPC │
                                 │ 2. Decrypt E2EE envelope locally         │
                                 │ 3. Rebuild full Binary Merkle Sum Tree   │
                                 │ 4. Decode ER 0x10 bytes & 64-hex memo    │
                                 │ 5. Enumerate declared treasury anchors   │
                                 └──────────────────────────────────────────┘
```

1. **Blind Batch Coordination (`POST /api/payroll`):** Strict `.strict()` schema accepts **only aggregate totals** (`recipient_count`, `total_amount_base_units`, `onchain_total_base_units`). Acquires a per-organization Redis mutex, verifies MagicBlock Private SPL health & treasury delegation (`GET /v1/spl/balance`), and fails closed with `503` if MagicBlock or Postgres is unavailable. Individual employee wallets, salaries, and bank accounts never hit `/api/payroll`.
2. **Binary SHA-256 Merkle Sum Tree (`src/lib/merkle.ts`):** Built client-side. Every recipient note gets a fresh 16-byte salt and domain-separated leaf commitment (`aegis:leaf:v1`). Every internal node commits to child hashes AND cumulative `(sum, count)` with empty-node padding (no leaf duplication).
3. **MagicBlock Private SPL Execution (`src/lib/magicblock.ts`, `src/hooks/usePayrollSigner.ts`):**
   - Never builds plaintext L1 `SPL Transfer` / `SystemProgram.transfer` instructions.
   - Delegates treasury funds into MagicBlock PER (`POST /v1/spl/deposit`, `private: true`) when ephemeral balance is below batch total.
   - Dispatches each on-chain payout via `POST /v1/spl/transfer` (`visibility: "private"`, `fromBalance: "ephemeral"`, randomized `split` + `minDelayMs`/`maxDelayMs` timing jitter) carrying the **full 64-hex leaf commitment** (`aegis:leaf:<64-hex>`), wire-verified client-side before signing, and broadcast strictly to MagicBlock's TEE RPC (`sendRpcEndpoint`).
4. **Unconditional Solana L1 Root Anchoring:** On **every** batch regardless of rail mix, the signer anchors `aegis:merkle:v1:<merkleRoot>:<leafCount>` permanently on Solana L1 (`anchor_tx_signature`). Zero salaries, zero recipient addresses, and zero burn-rate totals appear in the L1 memo.
5. **Blind Sealing (`POST /api/payroll/confirm`):**
   - `.strict()` schema **rejects** `leaf_proofs`, `amountBaseUnits`, `saltHex`, `onchain_settlements`, and per-employee ER transfer signatures.
   - Independently fetches `anchor_tx_signature` from Solana L1 RPC (`meta.err === null`, `signer === initiated_by`, `onChainRoot === merkle_root`, `onChainLeafCount === recipient_count`) and verifies `e2ee_envelope.aad`.
   - Returns truthful blind-server flags (`anchor_verified: true`, `aad_verified: true`, `auditor_verifiable: true`, `server_verified_completeness: false`, `server_verified_settlement_bytes: false`) — never claiming server-side completeness or settlement verification it cannot observe.
   - Stores ONLY `e2ee_envelope` ciphertext + blinded 64-hex `commitment_hash` index rows (`merkle_proof: null`).
6. **Passphrase-Encrypted Multi-Admin Key Vaults (`/api/org/key-vault`, `src/lib/e2ee.ts`, [`docs/KEY_MANAGEMENT_POLICY.md`](docs/KEY_MANAGEMENT_POLICY.md)):**
   - Zero raw private keys in `window.localStorage`. Each admin key is encrypted client-side via `PBKDF2-SHA256` (600,000 iterations) + `AES-256-GCM`, held in volatile memory only while unlocked, exportable as an offline Recovery Kit JSON, and wrapped across 2+ active admins (`orgWrappedDeks`: Primary Finance Admin + Backup Controller) with offboarding key rotation and last-admin protection.
7. **Zero-Trust Auditor Verification & Cross-Batch Completeness (`/api/audit/*`, `src/hooks/useAuditorEngine.ts`):**
   - **Zero-Trust L1 Anchor Pull (Auditor Browser Is the Trust Boundary):** `/api/audit/decrypt` acts strictly as an untrusted ciphertext courier. The auditor's browser connects directly to the auditor's own Solana L1 RPC endpoint, pulls every batch's `anchor_tx_signature` directly off Solana L1 itself, verifies fail-closed per batch that `manifest.initiatedBy` actually signed that L1 anchor, and ignores any server-advisory root assertions.
   - **Cross-Batch L1 Completeness (Requires Auditor-Declared Treasury Wallet):** When the auditor supplies the organization's declared Solana treasury wallet(s), the browser paginates every `aegis:merkle:v1` memo across `auditorEnteredPubkeys ∪ decryptedManifests.initiatedBy` directly on Solana L1 (1,000-sig pages, up to 5,000 sigs), renders a **Per-Wallet Solana L1 Scan Breakdown** (`perWalletStats`: wallet source, signatures scanned, anchors found, truncation), and flags any undisclosed anchor, server-omitted wallet, truncated scan, or auditor-declared wallet returning `0` lifetime L1 signatures (`zeroActivityDeclaredWallets`, catching typos/unfunded addresses/wrong cluster while still allowing funded dormant reserve wallets). A green `complete` verdict requires `totalL1AnchorsInWindow > 0` — zero anchors in the window returns a neutral `no_anchors_in_window` state (`completeZeroOmissions: null`), and omitting a declared treasury wallet altogether refuses any whole-org verdict (`not_evaluated`, `completeZeroOmissions: null`, per-batch view only).
   - **Client-Side E2EE Decryption & ER Wire Verification:** The auditor's browser decrypts `e2ee_envelope` locally (binding GCM AAD to its own L1-fetched root), rebuilds the Binary Merkle Sum Tree, and decodes every `onchain_shielded` MagicBlock `SPLxh1LVZz...` (`0x10`) transaction directly from ER RPC — requiring the full 64-hex leaf memo (fails if stripped or truncated) and recomputing the leaf strictly from settled on-chain `(recipient, amountBaseUnits, mint)` bytes so any `300`-vs-`3,800` underpayment fails loudly.
8. **Pluggable NGN/KES Off-Ramp Adapter — In Progress (`POST /api/payroll/dispatch-offramp`, `src/lib/fx.ts`, `src/lib/offramp/`):**
   - Adapter interface and sandbox execution path are implemented with mid-market reference benchmarks (`open.er-api.com`) and a 500 bps spread sanity guardrail (`validatePartnerAppliedRate`), stamping receipts with explicit `fxRateSource` (`"partner_applied"` vs `"sandbox_simulated_partner"`).
   - Live NGN/KES payout partner onboarding and partner-signed disbursement receipts (verified in the auditor's browser against the partner's published key) are the active integration work in progress.

---

## Threat Model & Cryptographic vs. Policy Boundaries

| Security Property | Enforcement Mechanism | Honest Scope & Limits |
| :--- | :--- | :--- |
| **Org API & Key-Vault Authorization** | **Solana Wallet-Native SIWS + Per-Mutation Ed25519 Signatures (`src/lib/auth.ts`).** Every org route requires a verified HttpOnly `aegis_admin_session` JWT + live `org_admins` DB check and derives `org_id` strictly from `session.orgId` (caller-supplied `org_id` is rejected by `.strict()` schemas). `POST`/`PATCH /api/org/key-vault` additionally require a fresh Ed25519 signature from an already-registered admin wallet over an atomic single-use Postgres nonce (`auth_challenges`, signature verified before consumption) bound to `(org_id, action, target_fingerprint)`. | All Postgres tables lock out `anon` via RLS (`service_role` only). Wallet-native SIWS is used rather than Web2 Supabase Auth `auth.users` so organization identity stays rooted in Solana treasury/admin wallets. |
| **Can Aegis servers read on-chain payroll or stored manifests?** | **Cryptographic (NO).** Blind `.strict()` schemas on `/api/payroll` and `/api/payroll/confirm` accept zero individual salaries, employee wallets, salts, Merkle sum proofs, or employee ER transfer signatures; all manifests & proofs stay inside multi-admin `RSA-OAEP-256 + AES-256-GCM` envelopes. | Applies end-to-end for on-chain shielded payroll and all persisted batch manifests. Optional fiat off-ramp dispatch (`/api/payroll/dispatch-offramp`) necessarily passes payout instructions to the fiat rail partner in transit and does not persist plaintext payroll in Postgres. |
| **Organization key custody & continuity** | **Passphrase-encrypted vault + 2+ admin wrapping.** `PBKDF2-SHA256` (600k iter) + `AES-256-GCM`, volatile memory-only unlock, offline Recovery Kit JSON, multi-admin `orgWrappedDeks`, and wallet-signed rotation API. | Full operational policy documented in [`docs/KEY_MANAGEMENT_POLICY.md`](docs/KEY_MANAGEMENT_POLICY.md). |
| **Cross-batch completeness (withheld batches)** | **Direct Auditor Solana L1 RPC enumeration (`src/lib/onchainVerify.ts`, `src/hooks/useAuditorEngine.ts`).** Derives the enumeration wallet set strictly from auditor-declared treasury wallet(s) plus each decrypted manifest's `initiatedBy` (verified fail-closed per batch against the L1 anchor tx signers), paginates Solana L1 directly (1,000-sig pages, up to 5,000 sigs), surfaces per-wallet scan stats (`perWalletStats`), blocks green on any undisclosed anchor, server-omitted wallet, truncated scan, or auditor-declared wallet with `0` lifetime L1 signatures (`zeroActivityDeclaredWallets`), and requires `totalL1AnchorsInWindow > 0` for a green `complete` verdict (returning neutral `no_anchors_in_window` with `completeZeroOmissions: null` on `0/0` windows). | **Inherent Residual Boundary:** A treasury wallet only enters the enumeration set via an auditor-declared address or a decrypted manifest. If an organization owns a secondary treasury wallet and withholds *every* batch anchored from it, no delivered manifest names that wallet. Completeness is therefore proven **relative to the wallets the auditor declared out-of-band plus the wallets proven by delivered manifests**. With no auditor-declared wallet, both library and UI refuse to compute a whole-org zero-omission verdict (`not_evaluated`, `completeZeroOmissions: null`) and show only the per-batch verified view. |
| **Settled on-chain amounts match manifest** | **Client-side MagicBlock ER `0x10` wire decoding + strict 64-hex leaf memo.** Auditor browser decodes settled bytes and recomputes each Merkle leaf against the browser-fetched L1 root. | Stripping or truncating the transfer memo or underpaying (`300` vs `3,800`) fails audit verification unconditionally. |
| **Fiat off-ramp adapter (`ngn_bank` / `kes_mpesa`)** | **Adapter Built (Sandbox) · Live Rails & Cryptographic Receipts In Progress.** Fiat leaves commit into the same L1-anchored Merkle Sum Tree and record partner-applied FX metadata + mid-market sanity checks, **but have no MagicBlock ER settlement transaction**. | Today, an auditor cryptographically proves the on-chain crypto half of a batch against Solana L1 + ER bytes; live NGN/KES partner rails and partner-signed receipts binding `(batchRoot, noteCommitment, appliedRate, fiatAmount, railReference)` verified directly against the payout partner's published signing key inside the auditor's browser are in progress. |
| **Auditor batch & token scope isolation** | **Cryptographic.** Only DEKs for batches inside `[valid_from, valid_until]` and `allowed_tokens` are wrapped to `auditor_public_key`. | Expiry/revocation is an API delivery policy that blocks future ciphertext fetches (cannot un-read plaintext already decrypted locally). |

---

## Verification & Quickstart

```bash
git checkout feature/zero-trust-refactor
npm ci

# Run cryptographic, blind-server schema, wallet-native SIWS & vault signature,
# multi-admin key vault, strict 64-hex memo, live MagicBlock SPL wire decoder,
# cross-batch L1 reconciliation, and partner FX checks
bun run scripts/verify-security-invariants.ts

# Apply migrations 001..006 in Supabase, populate .env.local, then run:
npm run dev
```

Apply SQL migrations in order:
1. `supabase/migrations/001_foundation.sql`
2. `supabase/migrations/002_treasury_swaps.sql`
3. `supabase/migrations/003_merkle_audit_manifests.sql`
4. `supabase/migrations/004_chain_anchor_and_e2ee_audits.sql`
5. `supabase/migrations/005_org_key_vaults_and_blind_confirm.sql`
6. `supabase/migrations/006_wallet_auth_and_org_admins.sql`

---

## License

MIT
