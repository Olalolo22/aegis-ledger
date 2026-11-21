-- ═══════════════════════════════════════════════════════════════
-- Aegis Ledger — Stage 6 Migration: Solana Wallet-Native Auth (SIWS),
-- Org Admin Membership (`org_admins`), and Atomic Single-Use Challenges
--
-- Security invariants enforced:
--   1. `org_id` is NEVER trusted from request query strings or JSON bodies.
--      Every org-scoped API route derives `org_id` strictly from a verified
--      Ed25519 wallet session JWT AND re-checks live `org_admins` membership.
--   2. `auth_challenges` enforces atomic single-use nonce consumption via
--      Postgres (`UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()`),
--      eliminating replay attacks on both SIWS logins and per-mutation vault
--      signatures (`vault_register`, `vault_rotate`) without requiring Redis.
--   3. RLS locks both tables strictly to `service_role` (zero `anon` access).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS org_admins (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  wallet_pubkey  text        NOT NULL,
  role           text        NOT NULL CHECK (role IN ('owner', 'admin', 'backup_controller')),
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  UNIQUE (org_id, wallet_pubkey)
);

CREATE INDEX IF NOT EXISTS idx_org_admins_wallet_active
  ON org_admins (wallet_pubkey, status);

CREATE INDEX IF NOT EXISTS idx_org_admins_org_status
  ON org_admins (org_id, status);

-- Backfill existing organization treasury pubkeys as active owners
INSERT INTO org_admins (org_id, wallet_pubkey, role, status)
SELECT id, treasury_pubkey, 'owner', 'active'
FROM organizations
WHERE treasury_pubkey IS NOT NULL AND length(treasury_pubkey) >= 32
ON CONFLICT (org_id, wallet_pubkey) DO NOTHING;

CREATE TABLE IF NOT EXISTS auth_challenges (
  nonce              text        PRIMARY KEY,
  purpose            text        NOT NULL CHECK (purpose IN ('session_login', 'vault_register', 'vault_rotate', 'admin_add', 'admin_revoke')),
  wallet_pubkey      text        NOT NULL,
  org_id             uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  target_fingerprint text,
  message            text        NOT NULL,
  expires_at         timestamptz NOT NULL,
  consumed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_wallet_purpose
  ON auth_challenges (wallet_pubkey, purpose, expires_at DESC);

ALTER TABLE org_admins      ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access_org_admins" ON org_admins;
CREATE POLICY "service_role_full_access_org_admins"
  ON org_admins
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_full_access_auth_challenges" ON auth_challenges;
CREATE POLICY "service_role_full_access_auth_challenges"
  ON auth_challenges
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE org_admins IS 'Authoritative wallet-to-organization membership table checked live on every authenticated org API request.';
COMMENT ON TABLE auth_challenges IS 'Single-use Ed25519 challenge nonces for SIWS session login and per-mutation key-vault authorization.';
