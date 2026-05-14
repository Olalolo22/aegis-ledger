-- ═══════════════════════════════════════════════════════════════
-- Aegis Ledger — Stage 2: Treasury Swaps Table + RLS
--
-- This migration creates the treasury_swaps table (previously
-- created ad-hoc in the dashboard without RLS) and immediately
-- locks it to service_role access only.
--
--  resolved the Supabase "rls_disabled_in_public"
-- critical alert on the treasury_swaps table.
--
-- 

-- ═══════════════════════════════════════════════════════════════
-- TABLE: treasury_swaps
-- Records private SOL→USDC swap operations initiated by the
-- treasury. Individual UTXO details are NOT stored here — they
-- exist only transiently in API route memory and in the Cloak pool.
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS treasury_swaps (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Swap state machine
  status                    text        NOT NULL DEFAULT 'pending',

  -- Token pair
  input_token               text        NOT NULL DEFAULT 'SOL',
  output_token              text        NOT NULL DEFAULT 'USDC',

  -- Amounts
  input_amount_lamports     bigint      NOT NULL,
  estimated_output_amount   bigint,

  -- Execution config
  slippage_bps              integer     NOT NULL DEFAULT 50,

  -- Who triggered this (Solana wallet pubkey — not PII)
  initiated_by              text        NOT NULL,

  -- Result fields (populated after client signs & broadcasts)
  tx_signature              text,
  error_message             text,
  completed_at              timestamptz,

  created_at                timestamptz NOT NULL DEFAULT now(),

  -- Enforce valid status transitions
  CONSTRAINT chk_treasury_swaps_status
    CHECK (status IN ('pending', 'completed', 'failed')),

  -- Amount must be positive
  CONSTRAINT chk_treasury_swaps_amount
    CHECK (input_amount_lamports > 0),

  -- Slippage must be reasonable (0–5000 bps = 0–50%)
  CONSTRAINT chk_treasury_swaps_slippage
    CHECK (slippage_bps BETWEEN 0 AND 5000)
);

CREATE INDEX IF NOT EXISTS idx_treasury_swaps_org_id    ON treasury_swaps(org_id);
CREATE INDEX IF NOT EXISTS idx_treasury_swaps_status    ON treasury_swaps(status);
CREATE INDEX IF NOT EXISTS idx_treasury_swaps_created   ON treasury_swaps(created_at DESC);

COMMENT ON TABLE  treasury_swaps                           IS 'Private SOL→USDC swap records. No UTXO details or raw key material stored.';
COMMENT ON COLUMN treasury_swaps.input_amount_lamports     IS 'SOL amount in lamports (1 SOL = 1,000,000,000 lamports).';
COMMENT ON COLUMN treasury_swaps.estimated_output_amount   IS 'Estimated USDC output in base units (1 USDC = 1,000,000).';
COMMENT ON COLUMN treasury_swaps.initiated_by              IS 'Solana wallet pubkey of the user who initiated the swap. Not PII.';
COMMENT ON COLUMN treasury_swaps.tx_signature              IS 'On-chain Solana transaction signature, populated after client broadcast.';


-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Lock table to service_role only — same pattern as all other
-- Aegis Ledger tables. The anon key cannot access this table.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE treasury_swaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON treasury_swaps
  FOR ALL USING (auth.role() = 'service_role');


-- ═══════════════════════════════════════════════════════════════
-- IF treasury_swaps ALREADY EXISTS (created ad-hoc in dashboard):
--
-- The CREATE TABLE IF NOT EXISTS above will be a no-op, but the
-- RLS commands below this line will still execute and secure it.
-- Run this block separately if needed:
--
--   ALTER TABLE treasury_swaps ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY "service_role_full_access" ON treasury_swaps
--     FOR ALL USING (auth.role() = 'service_role');
--
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- VERIFY: Run this query after applying to confirm all tables
-- in the public schema have RLS enabled.
--
--   SELECT tablename, rowsecurity
--   FROM pg_tables
--   WHERE schemaname = 'public'
--   ORDER BY tablename;
--
-- All rows should show rowsecurity = true.
-- ═══════════════════════════════════════════════════════════════
