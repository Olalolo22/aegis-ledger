# Aegis — Confidential Payroll & Local Settlement for Solana Teams

> **Pay distributed teams and emerging-market contributors in USDC without broadcasting salaries on public Solana L1.**  
> Powered by MagicBlock Private Ephemeral Rollups (Private SPL / Intel TDX TEE), Binary Merkle Sum Tree Completeness Proofs, HKDF/AES-256-GCM Encrypted Audit Manifests, and NGN/KES Off-Ramp Rails.

---

[![Solana](https://img.shields.io/badge/Solana-World's_Fair-9945FF?style=flat-square&logo=solana)](https://colosseum.com/worldsfair)
[![Superteam NG](https://img.shields.io/badge/Track-Superteam_Nigeria-green?style=flat-square)](https://superteam.fun/earn/listing/colosseum-crypto-worlds-fair-hackathon-superteam-nigeria-track)
[![MagicBlock](https://img.shields.io/badge/Execution-MagicBlock_PER_(TEE)-blue?style=flat-square)](https://magicblock.gg)
[![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)](LICENSE)

---

## Branch & Canonical Architecture

- **`feature/zero-trust-refactor` (active / canonical):** MagicBlock Private Ephemeral Rollups (Private SPL API + Intel TDX TEE validator), Binary SHA-256 Merkle Sum Trees, HKDF/AES-256-GCM encrypted batch manifests, and NGN/KES local settlement rails.
- **`main` (legacy archive):** Earlier Cloak devnet integration retained for git history after Cloak retired devnet (`api.devnet.cloak.ag` offline; Cloak is now mainnet-only).

---

## The Problem

Distributed teams, devshops, and startups in emerging markets (Lagos, Nairobi, Kigali) run on USDC, but executing payroll over standard public Solana transfers creates four real-world failures:

1. **Burn-Rate & Runway Doxxing:** Competitors inspect the company treasury on Solscan, compute monthly burn rate, and poach engineers with exact salary deltas.
2. **Personal Safety & Extortion:** Public wallets displaying recurring multi-thousand-dollar inflows create real physical safety risks in emerging markets.
3. **P2P Bank Freeze Risk:** Remote developers converting public crypto via informal P2P desks routinely get local bank accounts frozen by automated fraud heuristics.
4. **Auditability Without Full Exposure:** Traditional mixers cannot prove to an accountant or regulator that an entire payroll period was disclosed completely without omitting payments.

**Aegis solves this:** *Confidential execution via MagicBlock Private SPL. Cryptographically complete audits via Binary Merkle Sum Trees & scoped viewing keys. Direct local fiat settlement rails (NGN / KES).*

---

## Architecture & Execution Flow

```
       1. UPLOAD CSV                    2. MERKLE SUM TREE + PER            3. DUAL-RAIL SETTLEMENT
  ┌─────────────────────────┐        ┌──────────────────────────────┐     ┌───────────────────────────────┐
  │ Lead Dev (Lagos): $3,800│  ───►  │ Binary SHA-256 Merkle Sum    │ ──► │ NGN Bank / KES M-Pesa Rail    │
  │ iOS Dev (Nairobi):$2,600│        │ Tree (src/lib/merkle.ts)     │     │ (Sandbox / Kotani adapter)    │
  │ Fellow (Global):  $3,500│        │ MagicBlock Private SPL API   │ ──► │ MagicBlock Private SPL        │
  └─────────────────────────┘        │ deposit -> private transfer  │     │ (ephemeral, split + jitter)   │
                                     └──────────────────────────────┘     └───────────────────────────────┘
                                                     │
                                                     ▼
                                     4. SCOPED AUDIT & COMPLETENESS
                                     ┌──────────────────────────────┐
                                     │ HKDF + AES-256-GCM Manifest  │
                                     │ Scope-Bound AAD Viewing Key  │
                                     │ O(log N) Inclusion + Sum/Cnt │
                                     └──────────────────────────────┘
```

1. **Non-Custodial Batch Coordination (`POST /api/payroll`):** Validates recipient wallets, acquires a per-organization Redis mutex, verifies MagicBlock Private SPL health and treasury delegation status (`GET /v1/spl/balance`), and opens a `pending` batch record. Fails closed with `503` if MagicBlock or Postgres is unavailable — never returns silent `200` fallbacks.
2. **Binary SHA-256 Merkle Sum Tree (`src/lib/merkle.ts`):** Every recipient note gets a fresh 16-byte random salt and a domain-separated leaf commitment (`aegis:leaf:v1`). Every internal node commits to both child hashes AND cumulative `(sum, count)`, with empty-node padding (no leaf duplication).
3. **MagicBlock Private SPL Execution (`src/lib/magicblock.ts`, `src/hooks/usePayrollSigner.ts`):**
   - On-chain shielded payouts never build plaintext L1 `SPL Transfer` / `SystemProgram.transfer` instructions.
   - If the treasury's ephemeral balance is below the on-chain batch total, the signer first executes `POST /v1/spl/deposit` (`private: true`) to delegate funds into the MagicBlock TEE validator.
   - Each on-chain payout executes via `POST /v1/spl/transfer` with `visibility: "private"`, `fromBalance: "ephemeral"`, randomized `split` count, and `minDelayMs`/`maxDelayMs` timing jitter (`src/lib/denominate.ts`), broadcast strictly to MagicBlock's TEE RPC (`sendRpcEndpoint`). No silent fallback to public L1 RPC.
4. **Completeness Verification & Encrypted Manifest Sealing (`POST /api/payroll/confirm`):** Recomputes the full Binary Merkle Sum Tree and every `O(log N)` inclusion proof before marking the batch complete, then encrypts the recipient manifest with AES-256-GCM under a per-run subkey derived from `HKDF(AEGIS_MASTER_SECRET, org_id)` with AAD binding `org_id | payroll_run_id | merkle_root | token_symbol`.
5. **Scoped Auditor Decryption (`/api/audit/*`):**
   - `POST /api/audit/generate-key` wraps the organization's HKDF audit key with AES-256-GCM using canonical scope AAD (`org_id | valid_from | valid_until | allowed_tokens`). Raw key material is never returned.
   - `POST /api/audit/magic-link` verifies the salted auditor identity hash and stores a domain-separated HS256 JWT in Upstash Redis with a 15-minute single-use TTL.
   - `GET /api/audit/verify` atomically consumes the single-use token and returns the scoped Bearer JWT.
   - `POST /api/audit/decrypt` verifies the JWT, unwraps the organization audit key (GCM AAD enforces untouched scope), filters strictly by `valid_from..valid_until` and `allowed_tokens`, decrypts each batch manifest, and runs `verifyBatchCompleteness(...)` to prove zero recipients were omitted or modified.

---

## Threat Model & Honest Scope

| Layer | What Is Protected / Proven | Known Limits (Current Devnet Build) |
| :--- | :--- | :--- |
| **On-chain Execution** | Delegated treasury balance and recipient disbursements execute via MagicBlock Private SPL (`visibility: "private"`, `fromBalance: "ephemeral"`, randomized `split` + delay windows) inside Intel TDX. | Initial deposit from a public treasury ATA into MagicBlock's delegated account is visible on L1 as a lump-sum deposit. Timing/amount correlation improves with larger ephemeral pools and `toBalance: "ephemeral"` retention. |
| **Why not greedy note splitting?** | `src/lib/denominate.ts` plans MagicBlock Private SPL `split` counts and delay windows (`minDelayMs`/`maxDelayMs`). | Greedy per-recipient denomination buckets (e.g., `$3,800 -> 3x1000, 500, 250, 50 + cents`) do **not** break linkage on a public ledger without a shared anonymity pool — Aegis does not rely on client-side greedy denominations for privacy. |
| **Audit Completeness** | Binary SHA-256 Merkle Sum Tree (`src/lib/merkle.ts`) commits to every leaf hash, `totalSum`, and `leafCount`. Omitting or editing even 1 base unit fails `verifyBatchCompleteness`. | Assumes the batch root is anchored on-chain/TEE at execution time and compared against `payroll_runs.merkle_root` during audit verification. |
| **Key Storage** | `AEGIS_MASTER_SECRET` stays in server env vars; per-key/per-run/JWT keys use domain-separated HKDF-SHA256; ciphertexts enforce AES-256-GCM + AAD. | Viewing key unwrapping currently runs on the Next.js API server (trusted compliance coordinator, non-custodial for funds). |
| **Fiat Off-Ramp (NGN / KES)** | Off-ramp payouts skip L1 token transfers and attach to the same batch Merkle Sum Tree root. | Currently wired to `SandboxOfframpProvider` by default on devnet; live Kotani Pay / Yellow Card credentials required for production fiat settlement. |

---

## Codebase Structure

```
aegis-ledger/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── payroll/
│   │   │   │   ├── route.ts               # MagicBlock PER batch coordinator (fail-loud, zero mock fallbacks)
│   │   │   │   ├── confirm/route.ts       # Merkle Sum Tree verification + AES-256-GCM manifest sealing
│   │   │   │   ├── [id]/route.ts          # Public run status, Merkle root & O(log N) inclusion proofs
│   │   │   │   └── dispatch-offramp/      # NGN Bank / KES M-Pesa settlement dispatcher
│   │   │   ├── audit/
│   │   │   │   ├── generate-key/route.ts  # HKDF org key wrapping with GCM scope AAD
│   │   │   │   ├── magic-link/route.ts    # Single-use Redis magic link + HKDF-signed JWT
│   │   │   │   ├── verify/route.ts        # Atomic magic link consumption
│   │   │   │   └── decrypt/route.ts       # Real viewing-key unwrap, manifest decryption & completeness check
│   │   │   └── treasury/                  # Live Jupiter quote + MagicBlock delegation top-up
│   │   ├── dashboard/page.tsx             # Treasury Payroll Terminal
│   │   ├── audit/page.tsx                 # Scoped Auditor Portal
│   │   ├── verify/page.tsx                # Employee Payslip Verification Portal
│   │   └── page.tsx                       # Landing Page
│   ├── hooks/
│   │   ├── usePayrollSigner.ts            # MagicBlock Private SPL deposit + transfer pipeline
│   │   ├── usePrivateSwap.ts              # MagicBlock Private SPL treasury top-up
│   │   ├── useAuditorEngine.ts            # Auditor portal engine
│   │   └── useNoteScanner.ts              # Client-side verifier
│   └── lib/
│       ├── merkle.ts                      # Domain-separated Binary SHA-256 Merkle Sum Tree
│       ├── magicblock.ts                  # MagicBlock Private SPL API client & strict TEE RPC router
│       ├── crypto.ts                      # HKDF-SHA256, AES-256-GCM + AAD, manifest encryption
│       ├── denominate.ts                  # MagicBlock Private SPL split count & jitter planner
│       ├── validation.ts                  # Strict Zod input/manifest/proof schemas
│       └── redis.ts                       # Upstash Redis distributed mutex & magic-link TTL
├── supabase/migrations/
│   ├── 001_foundation.sql
│   ├── 002_treasury_swaps.sql
│   └── 003_merkle_audit_manifests.sql     # merkle_root, encrypted_manifest, merkle_proof
└── package.json
```

---

## Quickstart & Local Development

### Prerequisites
- Node.js 20+
- Solana wallet (Phantom / Solflare on Devnet)
- Supabase project (apply `supabase/migrations/001..003_*.sql`) and Upstash Redis credentials

### Installation
```bash
git checkout feature/zero-trust-refactor
npm ci
cp .env.example .env.local
# Populate AEGIS_MASTER_SECRET, Supabase, and Upstash Redis env vars
npm run dev
```

Visit `http://localhost:3000` for the Landing Page, `/dashboard` for the Treasury Terminal, and `/audit` for the Auditor Portal.

---

## License

MIT
