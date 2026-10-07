# Aegis — Confidential Payroll & Local Settlement for Solana Teams

> **Pay distributed teams and emerging-market contributors in USDC without doxxing salaries on Solscan.**  
> Powered by MagicBlock Private Ephemeral Rollups (TEE), Time-Scoped Compliance Viewing Keys, and Native NGN/KES Off-Ramp Rails.

---

[![Solana](https://img.shields.io/badge/Solana-World's_Fair-9945FF?style=flat-square&logo=solana)](https://colosseum.com/worldsfair)
[![Superteam NG](https://img.shields.io/badge/Track-Superteam_Nigeria-green?style=flat-square)](https://superteam.fun/earn/listing/colosseum-crypto-worlds-fair-hackathon-superteam-nigeria-track)
[![MagicBlock](https://img.shields.io/badge/Execution-MagicBlock_PER_(TEE)-blue?style=flat-square)](https://magicblock.gg)
[![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)](LICENSE)

---

## The 20-Second Reality: The Emerging Market Payroll Problem

Distributed teams, devshops, and startups in emerging markets (Lagos, Nairobi, Kigali) run on USDC. But executing payroll on public Solana rails creates severe, dangerous real-world consequences:

1. **Burn-Rate & Runway Doxxing:** Competitors and outsiders inspect the company's treasury on Solscan, calculate exact monthly burn rate, reverse-engineer runway, and poach developers with precise compensation deltas.
2. **Personal Safety & Extortion:** In emerging markets, a public on-chain wallet displaying thousands of dollars is a literal target for kidnapping, extortion, and harassment.
3. **P2P Bank Freeze Risk:** When remote developers cash out public crypto to their local bank accounts, P2P fraud flags and centralized banking algorithms freeze their accounts for weeks.
4. **The Compliance Dead-End:** Traditional mixers offer zero selective disclosure, creating severe regulatory stigma and preventing legitimate corporate tax accounting.

**Aegis solves this:** *Confidential on-chain where competitors watch. Accountable off-chain where tax authorities audit. Direct to local fiat where developers actually live.*

---

## How It Works (The 30-Second Flow)

```
       1. UPLOAD CSV                  2. TEE DISPATCH (<50ms)           3. CONFIDENTIAL DUAL-RAIL
  ┌─────────────────────────┐        ┌─────────────────────────┐        ┌─────────────────────────┐
  │ Lead Dev (Lagos): $3,800│  ───►  │ MagicBlock PER (TEE)    │  ───►  │ 🇳🇬 Providus Bank:₦6.27M │
  │ iOS Dev (Nairobi):$2,600│        │ Intel TDX Enclave       │        │ 🇰🇪 M-Pesa:    KSh 338K  │
  │ ZK Fellow:        $3,500│        │ Uniform Note Splitting  │        │ 🛡️ Shielded UTXO: 3,500 │
  └─────────────────────────┘        └─────────────────────────┘        └─────────────────────────┘
                                       (Zero Solscan Leakage;             (Direct Local Settlement;
                                        Sub-second batch slot)             Zero P2P Flag Risk)
                                                  │
                                                  ▼
                                     4. SCOPED AUDIT ACCESS
                                     ┌─────────────────────────┐
                                     │ 24-hr Merkle Viewing Key│
                                     │ Tax & Compliance Proof  │
                                     └─────────────────────────┘
```

1. **Upload Team CSV / Enter Batch:** Input contributor roles, USDC amounts, and preferred payout rails (USDC, Nigerian Bank Transfer, or Kenyan M-Pesa).
2. **Uniform Note Splitting (`denominate.ts`):** Break non-uniform salaries into standardized note denominations (`$1000`, `$500`, `$100`) so amount-correlation attacks on Solscan fail completely.
3. **Sub-50ms TEE Execution (MagicBlock PER):** Instead of freezing the browser with 30-second client-side Groth16 WASM proofs per person, the batch executes securely inside an Intel TDX hardware enclave on MagicBlock's Ephemeral Rollup.
4. **Confidential Last-Mile Settlement (NGN / KES):** Off-ramp triggers dispatch clean, automated bank/M-Pesa transfers without ever creating an on-chain link between the employer's treasury and the contractor's off-chain identity.
5. **Selective Scoped Auditability (`/audit`):** Issue time-scoped viewing keys derived via HKDF-SHA256 and encrypted with AES-256-GCM. An auditor or regulator holding a 24-hour key can verify fiscal compliance without exposing ongoing treasury operations.

---

## Architectural Comparison

| Dimension | Standard Public Multisig | Traditional Privacy Mixers | Aegis |
| :--- | :---: | :---: | :---: |
| **Salary Privacy** | ❌ Completely public on Solscan | ⚠️ High regulatory stigma | ✅ Confidential on-chain |
| **Emerging Market Off-Ramp** | ❌ Manual P2P (Bank freeze risk) | ❌ Unsupported | ✅ Direct to NGN Bank / KES M-Pesa |
| **Batch Scalability** | ✅ Fast (Public) | ❌ 30s+ per note in browser WASM | ✅ Sub-50ms batch execution (MagicBlock PER) |
| **Amount Clustering Defense** | ❌ Leaks exact dollar amounts | ❌ Deposited as unique amounts | ✅ Uniform denomination note splitting |
| **Custody Risk** | ✅ Non-custodial | ✅ Non-custodial | ✅ 100% Non-custodial (Zero hot-wallet hop) |
| **Corporate Compliance** | ❌ Raw CSV dumps | ❌ Zero auditability | ✅ Time-scoped HKDF viewing keys for auditors |
| **Asset Support** | ✅ All tokens | ❌ Native SOL only | ✅ Production USDC & Stablecoins |

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
- [x] **Drag-and-drop CSV batch importer with balance & address validation** (`CsvImporter.tsx`).
- [x] **MagicBlock Private Ephemeral Rollup (PER / TEE) sub-50ms batch settlement** (`PayrollTerminal.tsx`).
- [x] **Dual-rail emerging market off-ramp** (Live Spot FX conversion bar, NGN Bank & KES M-Pesa rails with instant settlement receipts).
- [ ] **Superteam Nigeria pilot demo run** (Recorded video walkthrough + live devnet batch submission).

---

## Team & Motivation

Built by Solana engineers who experienced the compensation-doxxing problem firsthand while receiving contractor payouts across web3 projects.

Distributed under the MIT License.
