-- ═══════════════════════════════════════════════════════════════
-- Aegis Ledger — Stage 5 Migration: Multi-Admin Passphrase-Encrypted Key Vaults
-- & Blind Server Confirmation Enforcement
--
-- Security invariants enforced:
--   1. Organization admin private keys are NEVER stored in plaintext in
--      window.localStorage or Postgres. `org_key_vaults.encrypted_vault` holds
--      ONLY PBKDF2-SHA256 (600k iter) + AES-256-GCM ciphertext locked under each
--      admin's passphrase, enabling multi-device unlock, 2+ admin quorum custody,
--      and offboarding rotation without server access to plaintext.
--   2. `payroll_recipients.merkle_proof` is purged/kept NULL for blind-server
--      batches so zero per-employee amounts or Merkle sibling sums ever reside
--      in Postgres. Full inclusion proofs live exclusively inside `e2ee_envelope`.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS org_key_vaults (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  admin_label     text        NOT NULL,
  role            text        NOT NULL CHECK (role IN ('primary', 'backup_controller', 'recovery')),
  public_key_spki text        NOT NULL,
  fingerprint     text        NOT NULL,
  encrypted_vault jsonb,
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated', 'revoked')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  rotated_at      timestamptz,
  revoked_at      timestamptz,
  UNIQUE (org_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_org_key_vaults_org_status
  ON org_key_vaults (org_id, status);

ALTER TABLE org_key_vaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access_org_key_vaults" ON org_key_vaults;
CREATE POLICY "service_role_full_access_org_key_vaults"
  ON org_key_vaults
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS anchor_verified boolean NOT NULL DEFAULT false;

COMMENT ON TABLE org_key_vaults IS 'Passphrase-encrypted RSA-OAEP-256 admin key vaults (PBKDF2-SHA256 600k + AES-256-GCM). Aegis servers never receive passphrases or plaintext private keys.';
COMMENT ON COLUMN payroll_runs.anchor_verified IS 'True once /api/payroll/confirm independently verified the Solana L1 anchor memo tx (aegis:merkle:v1:<root>:<count>). Does NOT assert server-side completeness or ER byte verification.';
COMMENT ON COLUMN payroll_runs.settlement_verified IS 'Legacy column; ALWAYS false for blind-server runs because Aegis servers cannot inspect salaries, salts, or ER transfer bytes. Only the auditor browser asserts full settlement/completeness verification.';
COMMENT ON COLUMN payroll_recipients.merkle_proof IS 'DEPRECATED / NULL for blind-server E2EE runs: per-leaf amounts and Merkle sum sibling proofs live exclusively inside payroll_runs.e2ee_envelope.';
