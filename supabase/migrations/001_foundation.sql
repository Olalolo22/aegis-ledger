-- ═══════════════════════════════════════════════════════════════
-- Aegis Ledger — Stage 1 Foundation Schema Migration
-- 
-- Security invariants enforced:
--   1. NO key material in the database (viewing keys are AES-256-GCM ciphertext only)
--   2. Temporal & scope binding enforced at the database level
--   3. Audit session hygiene — no plaintext auditor identity, no sessions table
--
-- Apply via: Supabase Dashboard → SQL Editor → paste & run
-- ═══════════════════════════════════════════════════════════════

-- ─── Extensions ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()


-- ═══════════════════════════════════════════════════════════════
-- TABLE: organizations
-- Represents a DAO or company using Aegis Ledger.
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS organizations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  treasury_pubkey text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  organizations                  IS 'DAO or company entities that use Aegis Ledger for payroll/treasury.';
COMMENT ON COLUMN organizations.treasury_pubkey  IS 'Solana public key of the organization treasury wallet.';


-- ═══════════════════════════════════════════════════════════════
-- TABLE: payroll_runs
-- One row per batch payroll execution. Individual recipient
-- amounts and addresses are NOT stored here — they exist only
-- transiently in API route memory and inside the Cloak shielded pool.
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payroll_runs (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status                  text        NOT NULL DEFAULT 'pending',
  token_mint              text        NOT NULL,
  token_symbol            text        NOT NULL,
  total_amount_lamports   bigint      NOT NULL,
  recipient_count         integer     NOT NULL,
  tx_signatures           text[],
  error_message           text,
  initiated_by            text        NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz,

  -- Enforce valid status values
  CONSTRAINT chk_payroll_runs_status
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),

  -- Sanity: must have at least one recipient
  CONSTRAINT chk_payroll_runs_recipient_count
    CHECK (recipient_count > 0),

  -- Sanity: amount must be positive
  CONSTRAINT chk_payroll_runs_amount
    CHECK (total_amount_lamports > 0)
);

CREATE INDEX idx_payroll_runs_org_id   ON payroll_runs(org_id);
CREATE INDEX idx_payroll_runs_status   ON payroll_runs(status);

COMMENT ON TABLE  payroll_runs                         IS 'Batch payroll executions. No individual amounts or recipient addresses stored.';
COMMENT ON COLUMN payroll_runs.total_amount_lamports   IS 'Gross deposit amount in token base units (lamports for SOL, smallest unit for SPL).';
COMMENT ON COLUMN payroll_runs.initiated_by            IS 'Solana wallet pubkey of the user who initiated this payroll run.';
COMMENT ON COLUMN payroll_runs.tx_signatures           IS 'Array of on-chain Solana transaction signatures after broadcast.';


-- ═══════════════════════════════════════════════════════════════
-- TABLE: payroll_recipients
-- Stores ONLY the UTXO commitment hash (publicly visible on-chain
-- in the Merkle tree) for cross-referencing. NO stealth addresses,
-- NO amounts, NO recipient wallet pubkeys.
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payroll_recipients (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id   uuid        NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  recipient_index  integer     NOT NULL,
  commitment_hash  text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Each recipient has a unique index within a payroll run
  CONSTRAINT uq_payroll_recipients_run_index
    UNIQUE (payroll_run_id, recipient_index)
);

COMMENT ON TABLE  payroll_recipients                  IS 'Per-recipient commitment hashes only. No PII, no amounts, no addresses.';
COMMENT ON COLUMN payroll_recipients.commitment_hash  IS 'UTXO commitment hash from Cloak (public on-chain in the Merkle tree).';


-- ═══════════════════════════════════════════════════════════════
-- TABLE: viewing_keys   *** CRITICAL SECURITY TABLE ***
--
-- Security Rule 1: NO key material in the database.
--   • encrypted_viewing_key = AES-256-GCM ciphertext blob (iv || authTag || ciphertext).
--   • key_id = unique HKDF derivation context. The decryption key is:
--       HKDF-SHA256(ikm=AEGIS_MASTER_SECRET, salt=key_id, info="aegis-viewing-key")
--   • The master secret lives ONLY in the AEGIS_MASTER_SECRET env var.
--   • The database NEVER sees the master secret or any derived key.
--
-- Security Rule 2: Temporal & scope binding enforced at DB level.
--   • valid_from / valid_until = non-nullable timestamptz with CHECK.
--   • allowed_tokens = non-nullable text[] with CHECK for non-empty.
--   • auditor_identity_hash = salted SHA-256 of auditor email/wallet.
--
-- Security Rule 3: No plaintext auditor identity stored.
--   • auditor_identity_hash is a one-way hash.
--   • auditor_identity_salt is a per-key unique cryptographic salt.
--   • No sessions table — audit access is a stateless signed JWT.
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS viewing_keys (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- HKDF derivation context (Rule 1)
  key_id                  text        NOT NULL,

  -- AES-256-GCM ciphertext: iv(12) || authTag(16) || encrypted_data(N) (Rule 1)
  encrypted_viewing_key   bytea       NOT NULL,

  -- Temporal scope (Rule 2)
  valid_from              timestamptz NOT NULL,
  valid_until             timestamptz NOT NULL,

  -- Token scope (Rule 2)
  allowed_tokens          text[]      NOT NULL DEFAULT '{USDC}',

  -- Auditor identity — salted hash only (Rules 2 & 3)
  auditor_identity_hash   text        NOT NULL,

  -- Per-auditor unique cryptographic salt for the identity hash (Rule 3)
  -- NOT a global pepper. Each viewing key gets its own random salt.
  auditor_identity_salt   text        NOT NULL,

  -- Revocation flag
  revoked                 boolean     NOT NULL DEFAULT false,

  created_at              timestamptz NOT NULL DEFAULT now(),

  -- key_id must be globally unique (it's the HKDF salt)
  CONSTRAINT uq_viewing_keys_key_id
    UNIQUE (key_id),

  -- Temporal sanity: end must be after start
  CONSTRAINT chk_viewing_keys_temporal
    CHECK (valid_until > valid_from),

  -- Must allow at least one token
  CONSTRAINT chk_viewing_keys_tokens
    CHECK (array_length(allowed_tokens, 1) > 0)
);

CREATE INDEX idx_viewing_keys_org_id        ON viewing_keys(org_id);
CREATE INDEX idx_viewing_keys_auditor_hash  ON viewing_keys(auditor_identity_hash);

COMMENT ON TABLE  viewing_keys IS '*** CRITICAL SECURITY TABLE *** Stores AES-256-GCM encrypted viewing keys. No raw key material. Decryption key derived externally via HKDF.';
COMMENT ON COLUMN viewing_keys.key_id IS 'Unique HKDF derivation context. Decryption key = HKDF(master_secret, salt=key_id). Master secret is in env vars ONLY.';
COMMENT ON COLUMN viewing_keys.encrypted_viewing_key IS 'AES-256-GCM ciphertext blob: iv(12 bytes) || authTag(16 bytes) || encrypted_data. NOT the raw viewing key.';
COMMENT ON COLUMN viewing_keys.valid_from IS 'Start of the allowed audit time window. Non-nullable, DB-enforced.';
COMMENT ON COLUMN viewing_keys.valid_until IS 'End of the allowed audit time window. Must be > valid_from (CHECK constraint).';
COMMENT ON COLUMN viewing_keys.allowed_tokens IS 'Token symbols (e.g., USDC, USDT) this key may decrypt. Non-empty array enforced.';
COMMENT ON COLUMN viewing_keys.auditor_identity_hash IS 'SHA-256 hash of (auditor_identity_salt || auditor_email_or_wallet). One-way; no plaintext identity stored.';
COMMENT ON COLUMN viewing_keys.auditor_identity_salt IS 'Per-key unique cryptographic random salt (32 bytes hex). NOT a global pepper — each viewing key has its own salt.';


-- ═══════════════════════════════════════════════════════════════
-- TABLE: audit_log
-- Append-only operational audit trail. No PII, no key material.
-- Used for admin observability of system events.
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text        NOT NULL,
  org_id      uuid        REFERENCES organizations(id) ON DELETE SET NULL,
  metadata    jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX idx_audit_log_org_id     ON audit_log(org_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);

COMMENT ON TABLE  audit_log IS 'Append-only event log. No PII, no key material. For admin observability.';
COMMENT ON COLUMN audit_log.event_type IS 'e.g., viewing_key_created, payroll_initiated, payroll_completed, payroll_failed.';
COMMENT ON COLUMN audit_log.metadata IS 'Event-specific JSON data. MUST NOT contain PII or key material.';


-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- All sensitive tables are locked to service_role only.
-- The anon key cannot read or write these tables.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE viewing_keys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log          ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically, but we create explicit
-- deny-all policies to block the anon key from accessing these tables.
-- If you need anon-accessible data, create specific USING policies.

CREATE POLICY "service_role_full_access" ON organizations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access" ON payroll_runs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access" ON payroll_recipients
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access" ON viewing_keys
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access" ON audit_log
  FOR ALL USING (auth.role() = 'service_role');


-- ═══════════════════════════════════════════════════════════════
-- UPDATED_AT trigger for organizations
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ═══════════════════════════════════════════════════════════════
-- DONE. Verify with:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   ORDER BY table_name;
-- ═══════════════════════════════════════════════════════════════
