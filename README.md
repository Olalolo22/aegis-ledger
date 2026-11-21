# Aegis — Confidential Payroll & Local Settlement for Solana Teams

> **Pay distributed teams and emerging-market contributors in USDC without broadcasting salaries on public Solana L1.**  
> Powered by MagicBlock Private Ephemeral Rollups (Private SPL / Intel TDX TEE), Solana L1-Anchored Binary Merkle Sum Trees, Blind-Server Multi-Admin E2EE Audit Envelopes, Cross-Batch L1 Completeness Reconciliation, and Partner-Applied NGN/KES Off-Ramp Rails.

---

[![Solana](https://img.shields.io/badge/Solana-World's_Fair-9945FF?style=flat-square&logo=solana)](https://colosseum.com/worldsfair)
[![Superteam NG](https://img.shields.io/badge/Track-Superteam_Nigeria-green?style=flat-square)](https://superteam.fun/earn/listing/colosseum-crypto-worlds-fair-hackathon-superteam-nigeria-track)
[![MagicBlock](https://img.shields.io/badge/Execution-MagicBlock_PER_(TEE)-blue?style=flat-square)](https://magicblock.gg)
[![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)](LICENSE)

---

## Branch & Canonical Architecture

- **`feature/zero-trust-refactor` (active / canonical):** MagicBlock Private Ephemeral Rollups (Private SPL API + Intel TDX TEE), blind-server coordination & confirmation (zero individual salaries, wallets, salts, or sum-tree proofs ever touch `/api/payroll` or `/api/payroll/confirm`), unconditional Solana L1 Merkle Sum Tree anchoring, cross-batch L1 completeness reconciliation (*"proof nothing was withheld"*), passphrase-encrypted multi-admin key vaults (`PBKDF2-SHA256 + AES-256-GCM`, zero raw `localStorage` keys), and partner-applied FX receipts with mid-market sanity guardrails.
- **`main` (legacy archive):** Earlier Cloak devnet integration retained for git history after Cloak retired devnet (`api.devnet.cloak.ag` offline; Cloak is now mainnet-only).

---

## Architecture & Settlement Flow

```
       1. CLIENT-SIDE PLAN             2. PER EXECUTION + L1 ANCHOR             3. VERIFIED SETTLEMENT
  ┌─────────────────────────┐    ┌────────────────────────────────────┐   ┌───────────────────────────────┐
  │ Lead Dev (Lagos): $3,800│ ─► │ Binary SHA-256 Merkle Sum Tree     │ ─►│ NGN Bank / KES M-Pesa Rail    │
  │ iOS Dev (Nairobi):$2,600│    │ MagicBlock Private SPL (ephemeral) │   │ (Partner-applied FX + sanity) │
  │ Fellow (Global):  $3,500│    │ Memo: aegis:leaf:<64-hex> (strict) │ ─►│ MagicBlock Private SPL        │
  │ (Never sent plaintext   │    │ L1 Memo: aegis:merkle:v1:root:cnt  │   │ (wire-decoded in auditor UI)  │
  │  to /api/payroll or     │    │ Multi-Admin E2EE Envelope          │   └───────────────────────────────┘
  │  /api/payroll/confirm)  │    └────────────────────────────────────┘
  └─────────────────────────┘                      │
                                                   ▼
                                 4. ZERO-TRUST AUDITOR VERIFICATION (BROWSER)
                                 ┌──────────────────────────────────────────┐
                                 │ 1. Enumerate ALL L1 treasury anchors     │
                                 │    → flag any anchored-but-undisclosed   │
                                 │ 2. Decrypt E2EE envelope locally         │
                                 │ 3. Rebuild full Binary Merkle Sum Tree   │
                                 │ 4. Decode ER 0x10 bytes & 64-hex memo    │
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
   - **Zero-Trust L1 Anchor Pull (Auditor Browser Is the Trust Boundary):** `/api/audit/decrypt` acts strictly as an untrusted ciphertext courier. The auditor's browser connects directly to the auditor's own Solana L1 RPC endpoint, pulls every batch's `anchor_tx_signature` directly off Solana L1 itself, and ignores any server-advisory root assertions.
   - **Cross-Batch L1 Completeness (*"Proof Nothing Was Withheld"*):** Directly from the auditor's Solana L1 RPC, enumerates every `aegis:merkle:v1` memo signed by the organization's treasury wallet within `[valid_from, valid_until]` and reconciles against delivered batches — never falling back silently to Aegis server reports. Any anchored-but-undisclosed batch triggers an explicit `undisclosed_anchors` finding.
   - **Client-Side E2EE Decryption & ER Wire Verification:** The auditor's browser decrypts `e2ee_envelope` locally (binding GCM AAD to its own L1-fetched root), rebuilds the Binary Merkle Sum Tree, and decodes every `onchain_shielded` MagicBlock `SPLxh1LVZz...` (`0x10`) transaction directly from ER RPC — requiring the full 64-hex leaf memo (fails if stripped or truncated) and recomputing the leaf strictly from settled on-chain `(recipient, amountBaseUnits, mint)` bytes so any `300`-vs-`3,800` underpayment fails loudly.
8. **Partner-Applied FX Receipts & Mid-Market Sanity Check (`POST /api/payroll/dispatch-offramp`, `src/lib/fx.ts`, `src/lib/offramp/kotani.ts`):**
   - Receipts stamp the payout partner's actual applied execution rate (`fxRateSource: "partner_applied"` in live mode, explicitly labeled `"sandbox_simulated_partner"` in sandbox mode) so receipts reconcile 1:1 with partner settlement statements.
   - `open.er-api.com` is used strictly as a server-side mid-market reference benchmark and spread sanity guardrail (`validatePartnerAppliedRate`, rejecting abnormal >500 bps deviations).

---

## Threat Model & Cryptographic vs. Policy Boundaries

| Security Property | Enforcement Mechanism | Honest Scope & Limits |
| :--- | :--- | :--- |
| **Org API & Key-Vault Authorization** | **Solana Wallet-Native SIWS + Per-Mutation Ed25519 Signatures (`src/lib/auth.ts`).** Every org route requires a verified HttpOnly `aegis_admin_session` JWT + live `org_admins` DB check and derives `org_id` strictly from `session.orgId` (caller-supplied `org_id` is rejected by `.strict()` schemas). `POST`/`PATCH /api/org/key-vault` additionally require a fresh Ed25519 signature from an already-registered admin wallet over an atomic single-use Postgres nonce (`auth_challenges`) bound to `(org_id, action, target_fingerprint)`. | All Postgres tables lock out `anon` via RLS (`service_role` only). Wallet-native SIWS is used rather than Web2 Supabase Auth `auth.users` so organization identity stays rooted in Solana treasury/admin wallets. |
| **Can Aegis servers read on-chain payroll or stored manifests?** | **Cryptographic (NO).** Blind `.strict()` schemas on `/api/payroll` and `/api/payroll/confirm` accept zero individual salaries, employee wallets, salts, Merkle sum proofs, or employee ER transfer signatures; all manifests & proofs stay inside multi-admin `RSA-OAEP-256 + AES-256-GCM` envelopes. | Applies end-to-end for on-chain shielded payroll and all persisted batch manifests. Optional fiat off-ramp dispatch (`/api/payroll/dispatch-offramp`) necessarily passes payout instructions to the fiat rail partner (Kotani Pay / Yellow Card) in transit and does not persist plaintext payroll in Postgres. |
| **Organization key custody & continuity** | **Passphrase-encrypted vault + 2+ admin wrapping.** `PBKDF2-SHA256` (600k iter) + `AES-256-GCM`, volatile memory-only unlock, offline Recovery Kit JSON, multi-admin `orgWrappedDeks`, and wallet-signed rotation API. | Full operational policy documented in [`docs/KEY_MANAGEMENT_POLICY.md`](docs/KEY_MANAGEMENT_POLICY.md). |
| **Cross-batch completeness (withheld batches)** | **Direct Auditor Solana L1 RPC enumeration.** Reconciles all `aegis:merkle:v1` memos signed by the treasury on L1 inside `[valid_from, valid_until]` against delivered batches directly inside the auditor's browser (`src/hooks/useAuditorEngine.ts`). | Any L1-anchored batch missing from the audit package triggers an explicit `undisclosed_anchors` finding. |
| **Settled on-chain amounts match manifest** | **Client-side MagicBlock ER `0x10` wire decoding + strict 64-hex leaf memo.** Auditor browser decodes settled bytes and recomputes each Merkle leaf against the browser-fetched L1 root. | Stripping or truncating the transfer memo or underpaying (`300` vs `3,800`) fails audit verification unconditionally. |
| **Fiat off-ramp settlement verification (`ngn_bank` / `kes_mpesa`)** | **Known Limitation (Honest Boundary).** Fiat leaves commit into the same L1-anchored Merkle Sum Tree and receive receipts stamped with the partner's applied FX rate + mid-market sanity guardrail, **but have no MagicBlock ER settlement transaction**. | Today, an auditor cryptographically proves the on-chain crypto half of a batch against Solana L1 + ER bytes, while the fiat half relies on partner disbursement receipts / bank statement reconciliation. **Planned closure:** partner-signed receipts binding `(batchRoot, noteCommitment, appliedRate, fiatAmount, railReference)` verified directly against Kotani Pay's published signing key inside the auditor's browser. |
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
