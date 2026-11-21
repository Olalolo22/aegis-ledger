# Aegis — Confidential Payroll & Local Settlement for Solana Teams

> **Pay distributed teams and emerging-market contributors in USDC without broadcasting salaries on public Solana L1.**  
> Powered by MagicBlock Private Ephemeral Rollups (Private SPL / Intel TDX TEE), Solana L1-Anchored Binary Merkle Sum Trees, Zero-Knowledge Client-Side E2EE Audit Envelopes, and Live Server-Quoted NGN/KES Off-Ramp Rails.

---

[![Solana](https://img.shields.io/badge/Solana-World's_Fair-9945FF?style=flat-square&logo=solana)](https://colosseum.com/worldsfair)
[![Superteam NG](https://img.shields.io/badge/Track-Superteam_Nigeria-green?style=flat-square)](https://superteam.fun/earn/listing/colosseum-crypto-worlds-fair-hackathon-superteam-nigeria-track)
[![MagicBlock](https://img.shields.io/badge/Execution-MagicBlock_PER_(TEE)-blue?style=flat-square)](https://magicblock.gg)
[![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)](LICENSE)

---

## Branch & Canonical Architecture

- **`feature/zero-trust-refactor` (active / canonical):** MagicBlock Private Ephemeral Rollups (Private SPL API + Intel TDX TEE), unconditional Solana L1 Merkle Sum Tree anchoring, on-chain transfer settlement decoding, client-side zero-knowledge E2EE audit envelopes (`RSA-OAEP-256 + AES-256-GCM`), and live server-quoted NGN/KES local settlement rails.
- **`main` (legacy archive):** Earlier Cloak devnet integration retained for git history after Cloak retired devnet (`api.devnet.cloak.ag` offline; Cloak is now mainnet-only).

---

## Architecture & Settlement Flow

```
       1. UPLOAD CSV               2. PER EXECUTION + L1 ANCHOR             3. VERIFIED SETTLEMENT
  ┌─────────────────────────┐    ┌────────────────────────────────────┐   ┌───────────────────────────────┐
  │ Lead Dev (Lagos): $3,800│ ─► │ Binary SHA-256 Merkle Sum Tree     │ ─►│ NGN Bank / KES M-Pesa Rail    │
  │ iOS Dev (Nairobi):$2,600│    │ MagicBlock Private SPL (ephemeral) │   │ (Live server-quoted FX stamp) │
  │ Fellow (Global):  $3,500│    │ L1 Memo: aegis:merkle:v1:root:cnt  │ ─►│ MagicBlock Private SPL        │
  └─────────────────────────┘    │ Browser E2EE (RSA-OAEP + AES-GCM)  │   │ (decoded & verified on confirm)│
                                 └────────────────────────────────────┘   └───────────────────────────────┘
                                                   │
                                                   ▼
                                 4. ZERO-KNOWLEDGE AUDITOR VERIFICATION
                                 ┌────────────────────────────────────┐
                                 │ Pulls root independently off L1    │
                                 │ Browser decrypts with auditor key  │
                                 │ Recomputes full Merkle Sum Tree    │
                                 └────────────────────────────────────┘
```

1. **Non-Custodial Batch Coordination (`POST /api/payroll`):** Validates recipient wallets, acquires a per-organization Redis mutex, checks MagicBlock Private SPL health & treasury delegation (`GET /v1/spl/balance`), and opens a `pending` batch record. Fails closed with `503` if MagicBlock or Postgres is unavailable.
2. **Binary SHA-256 Merkle Sum Tree (`src/lib/merkle.ts`):** Every recipient note gets a fresh 16-byte salt and domain-separated leaf commitment (`aegis:leaf:v1`). Every internal node commits to child hashes AND cumulative `(sum, count)` with empty-node padding (no leaf duplication).
3. **MagicBlock Private SPL Execution (`src/lib/magicblock.ts`, `src/hooks/usePayrollSigner.ts`):**
   - Never builds plaintext L1 `SPL Transfer` / `SystemProgram.transfer` instructions.
   - Delegates treasury funds into MagicBlock PER (`POST /v1/spl/deposit`, `private: true`) when ephemeral balance is below batch total.
   - Dispatches each on-chain payout via `POST /v1/spl/transfer` (`visibility: "private"`, `fromBalance: "ephemeral"`, randomized `split` + `minDelayMs`/`maxDelayMs` timing jitter), broadcast strictly to MagicBlock's TEE RPC (`sendRpcEndpoint`).
4. **Unconditional Solana L1 Root Anchoring:** On **every** batch regardless of rail mix (on-chain, fiat, or hybrid), the signer anchors `aegis:merkle:v1:<merkleRoot>:<leafCount>` permanently on Solana L1 (`anchor_tx_signature`). Zero salaries, zero recipient addresses, and zero burn-rate totals appear in the L1 memo.
5. **On-Chain Settlement Decoding & Sealing (`POST /api/payroll/confirm`):**
   - Independently fetches `anchor_tx_signature` from Solana L1 RPC, verifying `meta.err === null`, `signer === initiated_by`, and `onChainRoot === merkle_root`.
   - Independently fetches EVERY MagicBlock Private SPL transfer signature from MagicBlock ER RPC, decodes the wire instruction (`SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2`, discriminant `0x10`), and proves that the **actual settled on-chain `(sender, recipient, mint, amountBaseUnits)`** hashes to the exact Merkle leaf committed in the L1-anchored root. A buggy or malicious signer paying `300` while claiming `3,800` is rejected with HTTP `400`.
   - Stores ONLY the browser-encrypted `e2ee_envelope` (whose GCM AAD is verified against the L1-anchored root).
6. **Live Server-Side FX Quoting (`POST /api/payroll/dispatch-offramp`, `src/lib/fx.ts`):** Never trusts client-computed local fiat amounts or hardcoded React rates. Quotes live USD→NGN / USD→KES server-side at dispatch time (fails loud with `503` if the live FX feed is unreachable), computes `amountLocal` server-side, and stamps `{ exchangeRate, fxProvider, fxQuotedAt, fxQuoteId }` into every receipt and its SHA-256 signature.
7. **Zero-Knowledge Auditor Verification (`/api/audit/*` + `src/lib/e2ee.ts`):**
   - **Can Aegis servers read customer payroll? NO — cryptographically impossible.** Each batch manifest is encrypted client-side with a random 256-bit AES-GCM DEK wrapped to the organization's RSA-OAEP-256 public key. Aegis servers never hold org or auditor private keys.
   - When granting audit access, the org admin's browser fetches only in-scope `orgWrappedDek`s (`GET /api/payroll`), unwraps them locally, re-wraps them to the auditor's RSA-OAEP-256 public key (`reWrapDekForAuditor`), and registers `auditor_public_key` + `wrapped_batch_keys` (`POST /api/audit/generate-key`).
   - On `POST /api/audit/decrypt`, the server independently pulls every batch's `anchor_tx_signature` off Solana L1 RPC, verifies `onChainRoot === dbMerkleRoot` and `e2ee_envelope.aad`, and delivers ciphertexts to the auditor's browser.
   - The auditor's browser decrypts each envelope locally with the auditor's private key and runs `verifyBatchCompleteness(...)` directly against the Solana L1 root.

---

## Threat Model & Cryptographic vs. Policy Boundaries

| Security Property | Enforcement Mechanism | Honest Scope & Limits |
| :--- | :--- | :--- |
| **Can Aegis servers read payroll manifests at rest?** | **Cryptographic (NO).** Client-side `RSA-OAEP-256 + AES-256-GCM` hybrid envelope encryption (`src/lib/e2ee.ts`). Neither DB compromise nor stealing `AEGIS_MASTER_SECRET` can decrypt manifests. | Applies to persisted batch manifests (`e2ee_envelope`). During on-chain confirm, per-transfer `saltHex` is transiently checked in API memory to bind decoded ER transfers to Merkle leaves and is never stored. |
| **Auditor batch & token scope isolation** | **Cryptographic.** Only DEKs for batches inside `[valid_from, valid_until]` and `allowed_tokens` are wrapped to `auditor_public_key`. | Out-of-scope runs have no DEK wrapped for the auditor and cannot be decrypted even if fetched. |
| **Audit magic-link expiry & revocation** | **API delivery policy + GCM scope AAD.** Revoking a key or passing `valid_until` blocks ciphertext delivery from `/api/audit/decrypt`. | As with every E2EE system, expiry stops *future* fetches — it cannot un-read plaintext an auditor already decrypted locally. |
| **Manifest matches chain (not just Postgres)** | **Cryptographic + On-Chain RPC.** Every batch anchors `aegis:merkle:v1:<root>:<count>` on Solana L1; `/api/payroll/confirm` decodes every `SPLxh1LVZz...` (`0x10`) transfer on-chain; `/api/audit/decrypt` pulls the root back off Solana L1 RPC before verification. | Off-ramp fiat legs (`ngn_bank`/`kes_mpesa`) commit into the same L1-anchored Merkle Sum Tree and carry server-quoted FX receipts; live Kotani Pay / Yellow Card credentials are required for production fiat rails (sandbox gateway used when unset). |
| **On-chain amount & counterparty privacy** | **MagicBlock PER (Intel TDX TEE).** Delegated ephemeral balance + `visibility: "private"` + randomized `split` & delay windows (`src/lib/denominate.ts`). | Initial lump-sum deposit from a public treasury ATA into MagicBlock's delegated account is visible on L1. Greedy per-recipient denomination buckets are explicitly *not* used for privacy. |

---

## Verification & Quickstart

```bash
git checkout feature/zero-trust-refactor
npm ci

# Run cryptographic, L1 anchor, MagicBlock SPL decoder, E2EE, and live FX invariant checks
bun run scripts/verify-security-invariants.ts

# Apply migrations 001..004 in Supabase, populate .env.local, then run:
npm run dev
```

Apply SQL migrations in order:
1. `supabase/migrations/001_foundation.sql`
2. `supabase/migrations/002_treasury_swaps.sql`
3. `supabase/migrations/003_merkle_audit_manifests.sql`
4. `supabase/migrations/004_chain_anchor_and_e2ee_audits.sql`

---

## License

MIT
