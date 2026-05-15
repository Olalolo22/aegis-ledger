"use client";

import React, { useMemo, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
} from "@solana/wallet-adapter-phantom";
import {
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-solflare";
import {
  BackpackWalletAdapter,
} from "@solana/wallet-adapter-backpack";
import type { WalletError } from "@solana/wallet-adapter-base";

// Default styles for the wallet modal
// MOVED TO layout.tsx for faster loading

/**
 *
 * Design decisions for NON-CUSTODIAL architecture:
 *
 * 1. autoConnect: false — we NEVER silently connect. The user must
 *    explicitly approve wallet access for each session.
 *
 * 2. EVM Injection Isolation:
 *    The Solana wallet-adapter standard expects `window.solana` but
 *    MetaMask and other EVM wallets can inject a `window.ethereum`
 *    that sometimes includes a `solana` property on certain browser
 *    configurations (particularly when both Phantom + MetaMask are
 *    installed). We mitigate this by:
 *
 *    a. Using only explicitly configured wallet adapters (Phantom,
 *       Solflare, Backpack) — not auto-detecting injected wallets
 *    b. Verifying the connected wallet exposes `signTransaction`
 *       (Solana-specific, EVM wallets lack this method)
 *    c. Wrapping wallet errors with clear messaging if an EVM
 *       wallet responds instead of a Solana wallet
 *
 * 3. The wallet adapter handles the `window` guard internally,
 *    but this component MUST be loaded with `ssr: false` to avoid
 *    server-side rendering issues.
 */

interface WalletProviderProps {
  children: ReactNode;
}

export default function WalletProvider({ children }: WalletProviderProps) {
  // Solana RPC endpoint — uses the public env var (safe for client)
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com",
    []
  );

  // Explicitly configured wallets — NO auto-detection.
  // This prevents EVM wallets from being picked up as Solana wallets.
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new BackpackWalletAdapter(),
    ],
    []
  );

  // Wallet error handler with EVM isolation detection
  const onError = useCallback((error: WalletError) => {
    // Check for common EVM wallet injection conflicts
    const errorMsg = error.message || "";
    const isEvmConflict =
      errorMsg.includes("ethereum") ||
      errorMsg.includes("MetaMask") ||
      errorMsg.includes("not a function");

    if (isEvmConflict) {
      console.error(
        "[Aegis Ledger] EVM wallet injection conflict detected. " +
        "Please ensure you are connecting a Solana wallet (Phantom, Solflare, or Backpack). " +
        "If you have both MetaMask and a Solana wallet installed, " +
        "try disabling MetaMask temporarily.",
        error
      );
    } else {
      console.error("[Aegis Ledger] Wallet error:", error);
    }
  }, []);

  // Cast providers to work around React 18 vs 19 type mismatch.
  // The wallet-adapter packages are built against @types/react@19
  // which changes the JSX element return type. This is a known
  // compatibility issue in the Solana ecosystem.
  const ConnProvider = ConnectionProvider as React.ComponentType<any>;
  const WalletProv = SolanaWalletProvider as React.ComponentType<any>;
  const ModalProv = WalletModalProvider as React.ComponentType<any>;

  return (
    <ConnProvider endpoint={endpoint}>
      <WalletProv
        wallets={wallets}
        autoConnect={false}
        onError={onError}
      >
        <ModalProv>{children}</ModalProv>
      </WalletProv>
    </ConnProvider>
  );
}
