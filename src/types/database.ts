/**
 * TypeScript types mirroring the PostgreSQL schema.
 * Used to type-check Supabase client queries.
 *
 * These types are manually maintained to match
 * supabase/migrations/001_foundation.sql exactly.
 *
 * Compatible with @supabase/postgrest-js v2.104+ which requires
 * the Relationships key in each table definition.
 */

// ─── Row Types ──────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  treasury_pubkey: string;
  created_at: string;
  updated_at: string;
}

export type PayrollRunStatus = "pending" | "processing" | "completed" | "failed";

export interface PayrollRun {
  id: string;
  org_id: string;
  status: PayrollRunStatus;
  token_mint: string;
  token_symbol: string;
  total_amount_lamports: number;
  recipient_count: number;
  tx_signatures: string[] | null;
  error_message: string | null;
  initiated_by: string;
  created_at: string;
  completed_at: string | null;
}

export interface PayrollRecipient {
  id: string;
  payroll_run_id: string;
  recipient_index: number;
  commitment_hash: string;
  created_at: string;
}

export interface ViewingKey {
  id: string;
  org_id: string;
  key_id: string;
  encrypted_viewing_key: string;
  valid_from: string;
  valid_until: string;
  allowed_tokens: string[];
  auditor_identity_hash: string;
  auditor_identity_salt: string;
  revoked: boolean;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  event_type: string;
  org_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ─── Supabase Database Type ─────────────────────────────────────
// Compatible with @supabase/postgrest-js >=2.104
// Each table requires Row, Insert, Update, and Relationships.

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: Organization;
        Insert: {
          id?: string;
          name: string;
          treasury_pubkey: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          treasury_pubkey?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      payroll_runs: {
        Row: PayrollRun;
        Insert: {
          id?: string;
          org_id: string;
          status?: PayrollRunStatus;
          token_mint: string;
          token_symbol: string;
          total_amount_lamports: number;
          recipient_count: number;
          tx_signatures?: string[] | null;
          error_message?: string | null;
          initiated_by: string;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          status?: PayrollRunStatus;
          token_mint?: string;
          token_symbol?: string;
          total_amount_lamports?: number;
          recipient_count?: number;
          tx_signatures?: string[] | null;
          error_message?: string | null;
          initiated_by?: string;
          created_at?: string;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payroll_runs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      payroll_recipients: {
        Row: PayrollRecipient;
        Insert: {
          id?: string;
          payroll_run_id: string;
          recipient_index: number;
          commitment_hash: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          payroll_run_id?: string;
          recipient_index?: number;
          commitment_hash?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payroll_recipients_payroll_run_id_fkey";
            columns: ["payroll_run_id"];
            isOneToOne: false;
            referencedRelation: "payroll_runs";
            referencedColumns: ["id"];
          }
        ];
      };
      viewing_keys: {
        Row: ViewingKey;
        Insert: {
          id?: string;
          org_id: string;
          key_id: string;
          encrypted_viewing_key: string;
          valid_from: string;
          valid_until: string;
          allowed_tokens?: string[];
          auditor_identity_hash: string;
          auditor_identity_salt: string;
          revoked?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          key_id?: string;
          encrypted_viewing_key?: string;
          valid_from?: string;
          valid_until?: string;
          allowed_tokens?: string[];
          auditor_identity_hash?: string;
          auditor_identity_salt?: string;
          revoked?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "viewing_keys_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      audit_log: {
        Row: AuditLogEntry;
        Insert: {
          id?: string;
          event_type: string;
          org_id?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_type?: string;
          org_id?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
