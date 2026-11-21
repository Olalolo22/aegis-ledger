/**
 * TypeScript types mirroring the PostgreSQL schema.
 * Maintained to match supabase/migrations/001..005_*.sql exactly.
 */

import type {
  EncryptedAuditEnvelope,
  EncryptedPrivateKeyVault,
  OrgAdminRole,
} from "@/lib/e2ee";

export interface Organization {
  id: string;
  name: string;
  treasury_pubkey: string;
  created_at: string;
  updated_at: string;
}

export type OrgKeyVaultStatus = "active" | "rotated" | "revoked";

export interface OrgKeyVault {
  id: string;
  org_id: string;
  admin_label: string;
  role: OrgAdminRole;
  public_key_spki: string;
  fingerprint: string;
  encrypted_vault: EncryptedPrivateKeyVault | null;
  status: OrgKeyVaultStatus;
  created_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
}

export type PayrollRunStatus =
  | "pending"
  | "pending_signature"
  | "processing"
  | "completed"
  | "failed";

export interface PayrollRun {
  id: string;
  org_id: string;
  status: PayrollRunStatus;
  execution_rail?: string;
  token_mint: string;
  token_symbol: string;
  total_amount_lamports: number;
  recipient_count: number;
  tx_signatures: string[] | null;
  anchor_tx_signature: string | null;
  anchor_slot: number | null;
  merkle_root: string | null;
  encrypted_manifest: string | null;
  e2ee_envelope: EncryptedAuditEnvelope | null;
  settlement_verified: boolean;
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
  merkle_proof: Record<string, unknown> | null;
  created_at: string;
}

export interface ViewingKey {
  id: string;
  org_id: string;
  key_id: string;
  encrypted_viewing_key: string;
  auditor_public_key: string | null;
  wrapped_batch_keys: Record<string, string>;
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
      org_key_vaults: {
        Row: OrgKeyVault;
        Insert: {
          id?: string;
          org_id: string;
          admin_label: string;
          role: OrgAdminRole;
          public_key_spki: string;
          fingerprint: string;
          encrypted_vault?: EncryptedPrivateKeyVault | null;
          status?: OrgKeyVaultStatus;
          created_at?: string;
          rotated_at?: string | null;
          revoked_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          admin_label?: string;
          role?: OrgAdminRole;
          public_key_spki?: string;
          fingerprint?: string;
          encrypted_vault?: EncryptedPrivateKeyVault | null;
          status?: OrgKeyVaultStatus;
          created_at?: string;
          rotated_at?: string | null;
          revoked_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "org_key_vaults_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      payroll_runs: {
        Row: PayrollRun;
        Insert: {
          id?: string;
          org_id: string;
          status?: PayrollRunStatus;
          execution_rail?: string;
          token_mint: string;
          token_symbol: string;
          total_amount_lamports: number;
          recipient_count: number;
          tx_signatures?: string[] | null;
          anchor_tx_signature?: string | null;
          anchor_slot?: number | null;
          merkle_root?: string | null;
          encrypted_manifest?: string | null;
          e2ee_envelope?: EncryptedAuditEnvelope | null;
          settlement_verified?: boolean;
          error_message?: string | null;
          initiated_by: string;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          status?: PayrollRunStatus;
          execution_rail?: string;
          token_mint: string;
          token_symbol: string;
          total_amount_lamports?: number;
          recipient_count?: number;
          tx_signatures?: string[] | null;
          anchor_tx_signature?: string | null;
          anchor_slot?: number | null;
          merkle_root?: string | null;
          encrypted_manifest?: string | null;
          e2ee_envelope?: EncryptedAuditEnvelope | null;
          settlement_verified?: boolean;
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
          merkle_proof?: Record<string, unknown> | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          payroll_run_id?: string;
          recipient_index?: number;
          commitment_hash?: string;
          merkle_proof?: Record<string, unknown> | null;
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
          auditor_public_key?: string | null;
          wrapped_batch_keys?: Record<string, string>;
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
          auditor_public_key?: string | null;
          wrapped_batch_keys?: Record<string, string>;
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
