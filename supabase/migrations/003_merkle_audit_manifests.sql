-- ═══════════════════════════════════════════════════════════════
-- Aegis Ledger — Stage 3 Migration: Merkle Sum Trees & Encrypted Audit Manifests
--
-- Security invariants preserved:
--   1. NO plaintext individual salaries or recipient wallets in Postgres.
--   2. `encrypted_manifest` holds AES-256-GCM ciphertext encrypted with a
--      per-run HKDF subkey derived from the organization's audit viewing key
--      (with AAD = org_id | payroll_run_id | merkle_root | token_symbol).
--   3. `merkle_root` holds the domain-separated Binary SHA-256 Merkle Sum Tree
--      root committing to all leaf hashes, total batch sum, and leaf count.
--   4. `merkle_proof` holds the O(log N) inclusion proof for each leaf commitment.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS execution_rail     text NOT NULL DEFAULT 'magicblock_per',
  ADD COLUMN IF NOT EXISTS merkle_root        text,
  ADD COLUMN IF NOT EXISTS encrypted_manifest text;

ALTER TABLE payroll_recipients
  ADD COLUMN IF NOT EXISTS merkle_proof       jsonb;

COMMENT ON COLUMN payroll_runs.execution_rail     IS 'Settlement rail used for this batch (magicblock_per).';
COMMENT ON COLUMN payroll_runs.merkle_root        IS 'Domain-separated Binary SHA-256 Merkle Sum Tree root committing to all leaves, total sum, and leaf count.';
COMMENT ON COLUMN payroll_runs.encrypted_manifest IS 'AES-256-GCM ciphertext (base64 iv||tag||ct) of batch manifest, decryptable only via authorized scoped viewing keys.';
COMMENT ON COLUMN payroll_recipients.merkle_proof IS 'O(log N) Merkle Sum Tree inclusion proof binding this leaf commitment to payroll_runs.merkle_root.';
