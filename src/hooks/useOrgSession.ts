"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";

export interface OrgSessionState {
  authenticated: boolean;
  orgId: string | null;
  orgName: string | null;
  treasuryPubkey: string | null;
  walletPubkey: string | null;
  role: "owner" | "admin" | "backup_controller" | null;
}

export interface UseOrgSessionResult {
  session: OrgSessionState;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<OrgSessionState | null>;
  signOut: () => Promise<void>;
  signVaultAction: (
    action: "vault_register" | "vault_rotate",
    targetFingerprint: string
  ) => Promise<{ auth_nonce: string; wallet_signature: string }>;
  refresh: () => Promise<void>;
}

const EMPTY_SESSION: OrgSessionState = {
  authenticated: false,
  orgId: null,
  orgName: null,
  treasuryPubkey: null,
  walletPubkey: null,
  role: null,
};

/**
 * Solana Wallet-Native Sign-In With Solana (SIWS) session hook.
 *
 * - Authenticates via Ed25519 signature over a single-use Postgres nonce
 *   (`POST /api/auth/challenge` -> `wallet.signMessage` -> `POST /api/auth/verify`).
 * - Stores session exclusively in an `HttpOnly`, `SameSite=Strict` cookie
 *   (`aegis_admin_session`) — zero bearer tokens in `localStorage`.
 * - Provides `signVaultAction` for per-mutation Ed25519 signatures bound to
 *   `(org_id, action, target_fingerprint, signer_wallet, nonce)` on key-vault
 *   register & rotate mutations.
 */
export function useOrgSession(): UseOrgSessionResult {
  const { publicKey, signMessage, connected } = useWallet();
  const [session, setSession] = useState<OrgSessionState>(EMPTY_SESSION);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { credentials: "same-origin" });
      if (!res.ok) {
        setSession(EMPTY_SESSION);
        return;
      }
      const data = await res.json();
      if (data.authenticated && data.org_id && data.wallet_pubkey) {
        // If user switched connected wallet to a different address, clear stale session
        if (publicKey && publicKey.toBase58() !== data.wallet_pubkey) {
          await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin",
          }).catch(() => {});
          setSession(EMPTY_SESSION);
          return;
        }
        setSession({
          authenticated: true,
          orgId: data.org_id,
          orgName: data.org_name || null,
          treasuryPubkey: data.treasury_pubkey || null,
          walletPubkey: data.wallet_pubkey,
          role: data.role || null,
        });
      } else {
        setSession(EMPTY_SESSION);
      }
    } catch {
      setSession(EMPTY_SESSION);
    }
  }, [publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh, connected]);

  const signIn = useCallback(async (): Promise<OrgSessionState | null> => {
    setError(null);
    if (!connected || !publicKey) {
      setError("Connect your Solana wallet first to sign in.");
      return null;
    }
    if (!signMessage) {
      setError("Connected wallet adapter does not support Ed25519 message signing.");
      return null;
    }

    setLoading(true);
    try {
      const walletPubkey = publicKey.toBase58();
      const chRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          purpose: "session_login",
          wallet_pubkey: walletPubkey,
        }),
      });
      const chData = await chRes.json().catch(() => ({}));
      if (!chRes.ok || !chData.nonce || !chData.message) {
        throw new Error(
          chData.error || `Failed to obtain SIWS challenge (HTTP ${chRes.status})`
        );
      }

      const sigBytes = await signMessage(new TextEncoder().encode(chData.message));
      const signature = bs58.encode(sigBytes);

      const verRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          wallet_pubkey: walletPubkey,
          nonce: chData.nonce,
          signature,
        }),
      });
      const verData = await verRes.json().catch(() => ({}));
      if (!verRes.ok || !verData.authenticated || !verData.org_id) {
        throw new Error(
          verData.error || `Wallet sign-in verification failed (HTTP ${verRes.status})`
        );
      }

      const nextState: OrgSessionState = {
        authenticated: true,
        orgId: verData.org_id,
        orgName: verData.org_name || null,
        treasuryPubkey: verData.treasury_pubkey || null,
        walletPubkey: verData.wallet_pubkey,
        role: verData.role || null,
      };
      setSession(nextState);
      return nextState;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Wallet sign-in failed";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, signMessage]);

  const signVaultAction = useCallback(
    async (
      action: "vault_register" | "vault_rotate",
      targetFingerprint: string
    ): Promise<{ auth_nonce: string; wallet_signature: string }> => {
      if (!connected || !publicKey || !signMessage) {
        throw new Error(
          "Connected Solana wallet with message-signing support is required to authorize key-vault mutations."
        );
      }
      const walletPubkey = publicKey.toBase58();
      const chRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          purpose: action,
          wallet_pubkey: walletPubkey,
          target_fingerprint: targetFingerprint,
        }),
      });
      const chData = await chRes.json().catch(() => ({}));
      if (!chRes.ok || !chData.nonce || !chData.message) {
        throw new Error(
          chData.error || `Failed to obtain ${action} authorization challenge`
        );
      }

      const sigBytes = await signMessage(new TextEncoder().encode(chData.message));
      return {
        auth_nonce: chData.nonce,
        wallet_signature: bs58.encode(sigBytes),
      };
    },
    [connected, publicKey, signMessage]
  );

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      setSession(EMPTY_SESSION);
      setError(null);
    }
  }, []);

  return {
    session,
    loading,
    error,
    signIn,
    signOut,
    signVaultAction,
    refresh,
  };
}
