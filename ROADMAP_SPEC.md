# Aegis Ledger — Technical Specification & Engineering Roadmap

This document serves as the ground-truth technical specification, competitive moat analysis, and engineering backlog for Aegis Ledger. It is structured for developers, design partners, and incubator technical reviews (e.g., Colosseum / Eternal).

---

## 1. System Philosophy & Architecture

Aegis Ledger is the **confidential treasury coordination layer** for on-chain organizations. It bridges governance and privacy without requiring organizations to trust an intermediary operator or surrender compliance.

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

> **The Core Formula:**  
> *"Squads controls authorization. MagicBlock & Cloak provide private settlement. Aegis coordinates the treasury."*

---

## 2. Competitive Landscape & Architectural Moats

### The Competitor Reality (`lrafasouza/aegis` / `aegisz.xyz`)
A competing project built for the Cloak track implemented a product shell with Squads, an operator dashboard, and bearer invoices. However, an engineering audit reveals three fatal architectural flaws that break their security and privacy guarantees:

| Dimension | Competitor Architecture (`aegisz.xyz`) | Aegis Ledger Architecture |
| :--- | :--- | :--- |
| **Custody & Trust Model** | **Custodial Operator EOA Hazard:** Vault transfers raw treasury funds into an operator’s personal wallet (`Vault → Operator EOA → Cloak`). If the operator is compromised during the 15-min license window, funds can be stolen. | **Non-Custodial State Delegation:** Utilizes MagicBlock TEE ephemeral state delegation and direct client proving. Zero intermediary EOA hot-wallets holding raw treasury funds. |
| **Amount-Correlation Attack** | **Zero Note Splitting (Fatal Privacy Leak):** Deposits exact amounts (e.g. $4,891.22) into Cloak. Observers deanonymize payments simply by matching the exact dollar amount exiting the Vault with the amount exiting Cloak. | **Standard Denomination Splitting (`denominate.ts`):** Partitions non-uniform amounts into standard notes (`1000`, `500`, `100`, `10`) before shielding, destroying amount-correlation clustering on block explorers. |
| **Batch Scalability & UX** | **WASM Prover Wall (~30s / payment):** Relies solely on client-side Groth16 proofs. A 20-person payroll run requires 10–15 minutes of continuous browser proving, crashing tabs and timing out RPCs. | **Dual-Rail Settlement (MagicBlock TEE + Cloak ZK):** High-volume batch payroll (50+ contributors) executes in sub-seconds inside hardware enclaves (TEE); individual discreet payouts route through Cloak ZK. |
| **Compliance & Auditing** | **Database-Signed Snapshots:** Backend queries PostgreSQL and signs a CSV with an Ed25519 secret (`# signature=`). If the Web2 server is compromised, fake audits can be generated. | **On-Chain Cryptographic Decryption (`noteScanner.ts`):** Scoped viewing keys (`ivk`/`ovk`) allow auditors to scan and decrypt actual on-chain Merkle tree leaves directly in the browser, independent of central databases. |
| **Asset Support** | **SOL Native Only:** Cloak SPL/USDC remains unproven on mainnet. | **USDC / Stablecoin First:** Architected specifically for DAO dollar-denominated contributor retainers and payroll. |

---

## 3. Current Shipped State (v0.1 Ground Truth)

The following modules are live in the codebase (branch: `magic-mvp`):

- **Client-Side Proving Engine:** [`src/hooks/usePayrollSigner.ts`](file:///home/lala_02/aegis-ledger/src/hooks/usePayrollSigner.ts) interfacing with `@cloak.dev/sdk`.
- **Amount Clustering Defense:** [`src/lib/denominate.ts`](file:///home/lala_02/aegis-ledger/src/lib/denominate.ts) uniform note-splitting utility.
- **Cryptographic Audit Scanner:** [`src/lib/noteScanner.ts`](file:///home/lala_02/aegis-ledger/src/lib/noteScanner.ts) client-side Merkle leaf decryption.
- **Viewing Key Derivation & Ephemeral Delivery:** [`src/lib/crypto.ts`](file:///home/lala_02/aegis-ledger/src/lib/crypto.ts) AES-256-GCM + HKDF-SHA256 with Upstash Redis TTL magic links.
- **Terminal Coordinator:** Real-time log streaming via Next.js 14 API routes and Supabase state synchronization.

---

## 4. Phased Engineering Roadmap

### Phase 0: Production Hardening & Live Settlement (Current Priority)
- [ ] **Eliminate Fallback Simulation:** Remove mock signature/hash fallback in [`usePayrollSigner.ts`](file:///home/lala_02/aegis-ledger/src/hooks/usePayrollSigner.ts#L180-L195) so failures trigger clean retries and diagnostic error reporting instead of synthetic proofs.
- [ ] **USDC / SPL Token Pipeline:** Implement SPL token account derivation and transfer instructions for USDC disbursements.
- [ ] **CSV Batch Importer:** Drag-and-drop CSV parser with address regex validation, denomination calculation preview, and balance preflight checks.

### Phase 1: Dual-Rail Privacy (MagicBlock TEE + Cloak ZK)
- [ ] **MagicBlock Private Ephemeral Rollups Integration:**
  - Deploy ephemeral rollup session program.
  - Implement sub-second private batch payroll execution inside Intel TDX hardware enclaves.
  - Enable instant, zero-client-lag disbursements for teams with 20–100 contributors.
- [ ] **Cloak ZK Settlement Rail:**
  - Preserve Cloak Groth16 shielded UTXO pipeline for high-value executive transfers, discreet bonuses, and mathematical zero-knowledge privacy.

### Phase 2: Governed Execution (Squads v4 Integration)
- [ ] **Multisig Proposal Flow (`@sqds/multisig`):**
  - Connect Squads Vault PDA.
  - Generate batched execution proposal payloads without intermediate operator custody.
  - Enforce N-of-M multisig approval before batch dispatch.
- [ ] **Sub-Vault & Time-Lock Support:** Allow organizations to partition operational budgets into sub-vaults with on-chain execution delays.

### Phase 3: Advanced Disbursement & Invoicing Workflows
- [ ] **Bearer Invoices:** Generate claim links where no recipient wallet is committed at creation time. The claimant connects any wallet at claim time to withdraw funds privately.
- [ ] **Bound Stealth Invoices:** Issue encrypted invoices linked to designated one-time stealth addresses for vendor billing.
- [ ] **Recurring Contributor Retainers:** Automated schedule tracking (`nextDueAt`, `lastRunAt`, monthly cadence) with one-click proposal generation.

### Phase 4: Verifiable Compliance & Scoped Auditing
- [ ] **Cryptographic Proof-of-Payment Receipts:** Generate Groth16 witness exports allowing payers to prove a specific payment occurred to an authorized verifier without leaking the rest of the treasury.
- [ ] **Granular Audit Links:** Enforce scoped viewing key policies:
  - `amounts_only`: Reveals dollar values while keeping recipient identities redacted.
  - `time_ranged`: Limits visibility strictly to a designated fiscal window (e.g. Q1 2026).
  - `full_history`: Complete audit visibility with automatic link expiration and access logging.

### Phase 5: Autonomous Treasury Coordination (Aegis MCP Server)
- [ ] **`@aegis/mcp-server` Implementation:**
  - Expose Model Context Protocol tools for Cursor, Claude, and autonomous agents:
    - `propose_batch_payroll({ recipients, amounts, memo })`
    - `get_vault_balances()`
    - `verify_payout_receipt(receipt_hash)`
- [ ] **Strict Non-Custodial Permission Boundary:**
  - AI agents can **only propose** transactions and inspect authorized state.
  - Approval and execution **strictly require human multisig signers** via Squads.
