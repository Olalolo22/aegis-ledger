-- ═══════════════════════════════════════════════════════════════
-- Aegis Ledger — Stage 4 Migration: L1 Root Anchoring & Zero-Knowledge E2EE Audits
--
-- Security invariants enforced:
--   1. Every payroll batch anchors its Binary Merkle Sum Tree root on Solana L1
--      (`anchor_tx_signature`, `anchor_slot`), independently re-fetched on audit.
--   2. `e2ee_envelope` holds client-side RSA-OAEP-256 + AES-256-GCM ciphertext
--      encrypted to the organization's public key. Aegis servers CANNOT decrypt it.
--   3. `viewing_keys.wrapped_batch_keys` holds per-batch DEKs re-wrapped client-side
--      to the auditor's public key ONLY for runs within [valid_from, valid_until]
--      and allowed_tokens.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS anchor_tx_signature text,
  ADD COLUMN IF NOT EXISTS anchor_slot         bigint,
  ADD COLUMN IF NOT EXISTS e2ee_envelope       jsonb,
  ADD COLUMN IF NOT EXISTS settlement_verified boolean NOT NULL DEFAULT false;

ALTER TABLE viewing_keys
  ADD COLUMN IF NOT EXISTS auditor_public_key  text,
  ADD COLUMN IF NOT EXISTS wrapped_batch_keys  jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN payroll_runs.anchor_tx_signature IS 'Solana L1 transaction signature carrying aegis:merkle:v1:<root>:<count> memo.';
COMMENT ON COLUMN payroll_runs.anchor_slot         IS 'Confirmed Solana L1 slot of the Merkle root anchor transaction.';
COMMENT ON COLUMN payroll_runs.e2ee_envelope       IS 'Client-side RSA-OAEP-256 + AES-256-GCM encrypted manifest envelope; undecryptable by Aegis servers.';
COMMENT ON COLUMN payroll_runs.settlement_verified IS 'True only after /api/payroll/confirm decoded and verified every on-chain transfer & L1 anchor against the Merkle tree.';
COMMENT ON COLUMN viewing_keys.auditor_public_key  IS 'Auditor RSA-OAEP-256 SPKI public key (base64). Private key stays exclusively with the auditor.';
COMMENT ON COLUMN viewing_keys.wrapped_batch_keys  IS 'Map of { [payroll_run_id]: auditorWrappedDekBase64 } wrapped client-side strictly for in-scope batches.';
