# ⟐ Aegis Ledger

**Confidential Treasury Infrastructure for On-Chain Organizations**

Squads controls authorization. MagicBlock and Cloak provide private settlement. Aegis coordinates the treasury.

---

[![Solana](https://img.shields.io/badge/Solana-Mainnet_%26_Devnet-9945FF?style=for-the-badge&logo=solana)](https://solana.com)
[![Squads](https://img.shields.io/badge/Squads-v4_Multisig-black?style=for-the-badge)](https://squads.so)
[![MagicBlock](https://img.shields.io/badge/MagicBlock-Private_Ephemeral_Rollups-blue?style=for-the-badge)](https://magicblock.gg)
[![Cloak](https://img.shields.io/badge/Cloak-Shielded_UTXO-00D4AA?style=for-the-badge)](https://cloak.ag)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

---

## The Problem: The On-Chain Transparency Paradox

Blockchains offer unprecedented operational transparency and composability, but for real organizations, **public ledgers turn routine financial operations into competitive vulnerabilities**:

* **Salary & Contributor Doxxing:** When a DAO or protocol team pays contributors, anyone with a block explorer can correlate wallet identities, infer individual compensation, calculate headcount burn rates, and poach top talent.
* **Vendor & M&A Strategy Leakage:** Plaintext payments to security auditors, law firms, and strategic acquisition targets signal private corporate moves before announcements.
* **Front-Running & Metadata Exploitation:** Public treasury disbursements expose operational timing and liquidity depth.

Existing multisigs (like Squads) solve internal authorization brilliantly, but execute everything in plaintext. General-purpose privacy mixers carry severe regulatory baggage and zero operational governance.

**Aegis Ledger resolves the paradox:**  
*Private where it should be. Accountable where it must be.*

---

## The Architecture: The Coordination Layer

Aegis is not an isolated privacy protocol or an unbacked mixer. It is the **treasury operating layer** sitting between multisig authorization and confidential execution rails:

```
                    ON-CHAIN ORGANIZATION / AI AGENT
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │          AEGIS LEDGER           │
                 │   Treasury Coordination Layer   │
                 │                                 │
                 │ • Batch Payroll & Invoices      │
                 │ • Bearer & Bound Stealth Claims │
                 │ • Scoped Viewing Keys & Audits  │
                 │ • Note Denomination Splitting   │
                 │ • Agent MCP Policy Boundary     │
                 └───────┬─────────────────┬───────┘
                         │                 │
            ┌────────────┘                 └────────────┐
            ▼                                           ▼
   ┌──────────────────┐                       ┌───────────────────┐
   │      SQUADS      │                       │  DUAL-RAIL PRIVACY│
   │  (Authorization) │                       │   (Settlement)    │
   │                  │                       │                   │
   │ • Multisig Vault │                       │ • MagicBlock(TEE) │
   │ • 2-of-N Signers │                       │   Sub-second batch│
   │ • Time Locks     │                       │ • Cloak (ZK UTXO) │
   │                  │                       │   Math-grade ZK   │
   └────────┬─────────┘                       └─────────┬─────────┘
            │                                           │
            └─────────────────────┬─────────────────────┘
                                  ▼
                           SOLANA NETWORK
```

### The Separation of Responsibilities
* **Squads** answers: *"Who has the authority to approve this payout?"*
* **MagicBlock & Cloak** answer: *"How can this transaction be shielded on-chain?"*
* **Aegis Ledger** answers: *"How does an organization coordinate, audit, automate, and account for private treasury operations?"*

---

## Core Product Pillars

### 1. 🔐 Governed Confidential Disbursements
* **Non-Custodial Multi-Signer Execution:** Proposals originate from authorized proposers and require threshold approvals (2-of-N) via Squads vaults before dispatch.
* **Zero Intermediary Hot-Wallet Custody:** Unlike naive relay architectures that route raw funds into an operator EOA, Aegis coordinates state transitions directly into shielded execution rails.
* **Dual-Rail Settlement Engine:**
  * **MagicBlock (TEE Hardware Enclaves):** Sub-second, low-overhead batch payouts for 20–100+ contributors without browser proving lag.
  * **Cloak (ZK-SNARK UTXO Pool):** Mathematical zero-knowledge privacy for executive salaries and high-value strategic transfers.

### 2. 🛡️ Amount-Correlation Defense (Note Denomination Splitting)
Standard shield pools remain vulnerable to amount clustering: an observer matching an outbound vault payment of `$4,891.22` with a shielded withdrawal of `$4,891.22` deanonymizes the recipient instantly.  
Aegis Ledger eliminates this attack vector via client-side **note denomination splitting** (`denominate.ts`):
$$\$4,891.22 \longrightarrow 4 \times \$1,000 + 1 \times \$500 + 3 \times \$100 + 1 \times \$10 \dots$$
Non-uniform salaries blend indistinguishably into standard pool commitments.

### 3. 🔎 Selective, Verifiable Auditability
Privacy without accountability is a non-starter for legitimate organizations. Aegis provides **cryptographically enforceable selective disclosure**:
* **Scoped Viewing Keys:** Grant auditors time-bounded, granular read access:
  * `amounts_only`: Plaintext numbers revealed, recipient identities redacted.
  * `time_ranged`: Restricted strictly to a single fiscal window (e.g. Q1 2026).
  * `full_history`: Complete transaction timeline.
* **Client-Side Merkle Decryption:** Auditors don’t rely on server-signed SQL dumps. The Auditor Portal scans and decrypts on-chain Merkle leaves directly in the browser via zero-knowledge viewing keys (`ivk`/`ovk`).
* **Ephemeral Delivery:** Keys are AES-256-GCM encrypted and delivered via single-use magic links backed by Upstash Redis TTL.

### 4. 🤖 Autonomous Agent Coordination (MCP Server)
AI agents shouldn’t have raw custody of treasury private keys. Aegis exposes an **MCP (Model Context Protocol) Server** establishing a strict permission boundary:
* **Agents Can:** Parse payroll spreadsheets, verify recipient addresses, draft batch proposals, and run preflight checks.
* **Agents Cannot:** Sign transactions, access unshielded keys, or bypass multisig thresholds.
> *Agents propose. Humans approve. Aegis coordinates. Shielded rails settle.*

---

## Feature Matrix

| Feature | Aegis Ledger | Traditional Multisig (Squads) | General Mixers | Competitor Wrappers |
| :--- | :---: | :---: | :---: | :---: |
| **Multisig Governance** | ✅ Native (Squads) | ✅ Native | ❌ None | ⚠️ Operator EOA Hop |
| **Salary Privacy** | ✅ Shielded | ❌ Public Ledger | ✅ Shielded | ⚠️ Leaked via Amounts |
| **Amount Clustering Protection** | ✅ Uniform Splitting | ❌ N/A | ❌ Varies | ❌ Exact Amounts Leaked |
| **Batch Scalability** | ✅ Sub-Second (TEE) | ✅ Fast (Public) | ❌ Slow WASM | ❌ 30s / recipient |
| **Selective Auditability** | ✅ Cryptographic Merkle | ❌ Public Explorer | ❌ None / Raw Key | ⚠️ Server-signed DB |
| **Non-Custodial Flow** | ✅ 100% Non-Custodial | ✅ Non-Custodial | ✅ Non-Custodial | ❌ Operator Hot Wallet |
| **AI Agent Interface (MCP)** | ✅ Non-Custodial Boundary | ❌ Direct Script | ❌ None | ❌ Roadmap Spec Only |

---

## Project Structure

```
aegis-ledger/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── payroll/          # Batch coordinator & execution endpoints
│   │   │   ├── audit/            # Scoped viewing key generation & verification
│   │   │   └── treasury/         # Swap quote & settlement hooks
│   │   ├── audit/page.tsx        # Auditor Portal (ReactFlow graph & Merkle scan)
│   │   ├── verify/page.tsx       # Employee/Auditor note decryption portal
│   │   ├── dashboard/page.tsx    # Treasury operator console
│   │   └── page.tsx              # Public interface & privacy overview
│   ├── components/
│   │   ├── PayrollTerminal.tsx   # Real-time cryptographic execution stream
│   │   ├── AuditGraph.tsx        # ReactFlow interactive UTXO visualization
│   │   ├── EmployeeScanner.tsx   # Client-side Merkle note decryptor
│   │   └── PrivacyScoreCard.tsx  # Treasury operational privacy metrics
│   ├── hooks/
│   │   ├── usePayrollSigner.ts   # Client-side WASM proving & wallet signer
│   │   ├── useAuditorEngine.ts   # Auditor state machine & scoped decryptor
│   │   └── useNoteScanner.ts     # In-browser Merkle tree leaf scanner
│   ├── lib/
│   │   ├── denominate.ts         # Uniform denomination note splitter
│   │   ├── crypto.ts             # AES-256-GCM, HKDF-SHA256, key derivation
│   │   ├── cloak.ts              # Shielded pool SDK factory & connection
│   │   ├── redis.ts              # Upstash Redis TTL mutex & ephemeral links
│   │   └── validation.ts         # Zod schemas for all treasury inputs
│   └── types/
│       ├── database.ts           # PostgreSQL schema typings
│       └── payslip.ts            # Decrypted payroll record structures
├── supabase/
│   └── migrations/               # Database schemas with RLS policies
├── ROADMAP_SPEC.md               # Technical specification & engineering backlog
└── package.json
```

---

## Engineering Roadmap

### Phase 0: Mainnet Hardening & Live Settlement (In Progress)
- [ ] Remove fallback offline simulation in `usePayrollSigner.ts` for clean live error telemetry.
- [ ] Implement production SPL token account routing for native **USDC payroll**.
- [ ] Drag-and-drop CSV batch importer with address checksum validation.

### Phase 1: Dual-Rail Private Settlement
- [ ] Deploy MagicBlock Ephemeral Rollup adapter for sub-second, 50+ recipient batch payouts.
- [ ] Retain Cloak ZK-SNARKs for mathematical privacy on executive/isolated disbursements.

### Phase 2: Governed Multisig Proposal Flow
- [ ] Direct `@sqds/multisig` v4 proposal builder (zero operator custody hop).
- [ ] Configurable time-locks and sub-vault operational budgets.

### Phase 3: Advanced Workflows
- [ ] **Bearer Invoices:** Secret claim links with dynamic recipient wallet binding at claim time.
- [ ] **Bound Stealth Invoices:** One-time stealth address generation for vendor billing.
- [ ] **Recurring Contributor Retainers:** Automated schedule tracking (`nextDueAt`, `lastRunAt`).

### Phase 4: Cryptographic Proof-of-Payment
- [ ] Groth16 witness export enabling single-payment cryptographic verification without exposing treasury history.

### Phase 5: Autonomous Treasury Operations
- [ ] `@aegis/mcp-server` release allowing AI agents (Cursor, Claude) to draft proposals under human multisig approval.

---

## License

Distributed under the MIT License. See `LICENSE` for more information.

---

<p align="center">
<strong>Aegis Ledger</strong> · <em>Confidential Treasury Infrastructure on Solana</em>
</p>
