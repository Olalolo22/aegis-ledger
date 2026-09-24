# Aegis — Private USDC Payroll for Solana Teams

> Pay your contributors, contractors, and agencies in USDC without doxxing individual salaries on Solscan.  
> Cryptographic audit links for your accountant. Zero hot-wallet custody risk.

---

[![Solana](https://img.shields.io/badge/Solana-Mainnet_%26_Devnet-9945FF?style=flat-square&logo=solana)](https://solana.com)
[![MagicBlock](https://img.shields.io/badge/Settlement-MagicBlock_TEE-blue?style=flat-square)](https://magicblock.gg)
[![Squads](https://img.shields.io/badge/Multisig-Squads_v4-black?style=flat-square)](https://squads.so)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

---

## The Problem: The Salary Doxxing Reality

Every month, Solana protocols, developer shops, and DAOs pay remote contractors and employees in USDC. Because public ledgers are completely transparent, this creates severe operational fallout:

1. **Compensation Doxxing:** Anyone with Solscan can inspect a team's treasury wallet, view every contributor's monthly pay, infer executive burn rates, and trigger toxic internal salary discussions.
2. **Talent Poaching:** Competitors monitor treasury disbursements to identify key engineers and poach them with exact compensation delta offers.
3. **The Mixer Dilemma:** Privacy mixers (e.g. Tornado-style pools) carry severe regulatory contamination, lack batch payroll support, and offer zero corporate accounting or compliance proofs.
4. **The Naive Hot-Wallet Hazard:** Existing "private payroll" scripts route treasury funds through an operator's personal hot wallet before shielding, creating a multi-million-dollar custody and theft vector.

**Aegis solves this:** *Private where it should be (on the block explorer). Accountable where it must be (for your tax accountant).*

---

## How It Works (The 30-Second Flow)

```
       1. UPLOAD CSV                  2. UNIFORM SPLIT               3. TEE DISPATCH             4. VERIFY / AUDIT
  ┌─────────────────────┐        ┌───────────────────────┐        ┌─────────────────┐        ┌─────────────────────┐
  │ Alice:  $4,800 USDC │  ───►  │ 4 x $1,000 notes      │  ───►  │ MagicBlock TEE  │  ───►  │ Employee: Payslip  │
  │ Bob:    $3,200 USDC │        │ 1 x $500   note       │        │ Sub-second batch│        │ Accountant: Scoped  │
  │ Charlie:$1,500 USDC │        │ 3 x $100   notes      │        │ zero-leak rail  │        │ Merkle Viewing Key  │
  └─────────────────────┘        └───────────────────────┘        └─────────────────┘        └─────────────────────┘
                                   (Destroys Solscan amount-        (Zero intermediary         (Browser scans Merkle
                                    correlation clustering)          hot-wallet custody)        tree leaves directly)
```

1. **Drop a Contributor CSV:** Import addresses and USDC amounts. Aegis parses, validates Solana addresses, and previews transaction fees.
2. **Amount-Correlation Defense (`denominate.ts`):** Standard shielded pools leak identities because an observer simply matches a `$4,891.22` withdrawal with a `$4,891.22` deposit. Aegis splits non-uniform salaries into standardized notes (`$1000`, `$500`, `$100`, `$10`) so all transfers blend indistinguishably on-chain.
3. **Sub-Second Batch Settlement:** Settles through MagicBlock Ephemeral Rollups (TEE / Intel TDX hardware enclaves). Payouts for 10–50+ contributors execute in sub-seconds without browser freezing or client-side WASM prover timeouts.
4. **Selective, Cryptographic Accounting:**
   - **For Employees:** A private claim link allows the recipient to decrypt their specific payslip note directly in their browser.
   - **For Accountants & Auditors:** Issue time-scoped, cryptographic viewing keys (`ivk`/`ovk`) that decrypt Merkle leaves for designated fiscal windows (e.g., Q1 2026) without exposing unrelated treasury activity.

---

## Architectural Moats

| Dimension | Standard Public Multisig | Traditional Privacy Mixers | Aegis |
| :--- | :---: | :---: | :---: |
| **Salary Privacy** | ❌ Completely public on Solscan | ⚠️ High regulatory stigma | ✅ Confidential on-chain |
| **Amount Clustering Defense** | ❌ Leaks exact dollar amounts | ❌ Deposited as unique amounts | ✅ Uniform denomination note splitting |
| **Batch Scalability** | ✅ Fast (Public) | ❌ 30s+ per note in browser WASM | ✅ Sub-second batch execution (TEE) |
| **Custody Risk** | ✅ Non-custodial | ✅ Non-custodial | ✅ 100% Non-custodial (Zero hot-wallet hop) |
| **Corporate Compliance** | ❌ Raw CSV dumps | ❌ Zero auditability | ✅ Scoped Merkle viewing keys for auditors |
| **Asset Support** | ✅ All tokens | ❌ Native SOL only | ✅ Production USDC first |

---

## Codebase Structure

```
aegis-ledger/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── payroll/          # Batch coordinator & execution endpoints
│   │   │   └── audit/            # Scoped viewing key generation & verification
│   │   ├── audit/page.tsx        # Auditor Portal (Merkle decryption scanner)
│   │   ├── verify/page.tsx       # Employee note decryption portal
│   │   └── page.tsx              # Main Treasury Payroll Terminal
│   ├── components/
│   │   ├── PayrollTerminal.tsx   # Real-time execution stream & CSV pipeline
│   │   ├── AuditGraph.tsx        # Interactive UTXO / note visualization
│   │   └── EmployeeScanner.tsx   # Client-side Merkle note decryptor
│   ├── hooks/
│   │   ├── usePayrollSigner.ts   # Live transaction signing & TEE pipeline
│   │   └── useNoteScanner.ts     # In-browser Merkle tree leaf scanner
│   └── lib/
│       ├── denominate.ts         # Uniform denomination note splitter
│       ├── crypto.ts             # AES-256-GCM, HKDF-SHA256 viewing key derivation
│       └── redis.ts              # Upstash Redis TTL for ephemeral audit links
└── package.json
```

---

## Quickstart & Local Development

### Prerequisites
- Node.js 18+
- Solana CLI & local Phantom wallet (Devnet)

### Installation
```bash
git checkout feat/colosseum-usdc-payroll
npm install
cp .env.example .env.local
npm run dev
```

Visit `http://localhost:3000` to access the Payroll Terminal.

---

## Current Focus & Colosseum Roadmap

- [x] **Client-side note denomination splitting engine** (`denominate.ts`).
- [x] **In-browser Merkle tree decryption scanner** (`noteScanner.ts`).
- [x] **Scoped viewing key generation & ephemeral link delivery** (`crypto.ts`).
- [ ] **Drag-and-drop CSV batch importer with balance & address validation** (In Progress).
- [ ] **MagicBlock Ephemeral Rollup / TEE batch settlement connector** (In Progress).
- [ ] **Superteam Nigeria pilot run** (Live devnet batch with 2 regional dev agencies).

---

## Team & Motivation

Built by Solana engineers who experienced the compensation-doxxing problem firsthand while receiving contractor payouts across web3 projects.

Distributed under the MIT License.
