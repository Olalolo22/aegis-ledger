"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCallback, useEffect, useState } from "react";

/**
 *
 * Includes Solana-specific validation:
 * - After connecting, verifies the wallet exposes `signTransaction`
 * - If not, disconnects and shows an error (EVM wallet conflict)
 */
export default function WalletButton() {
  const { publicKey, wallet, disconnect, connected, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(() => {
    if (connected) {
      disconnect().catch(console.error);
    } else {
      setVisible(true);
    }
  }, [connected, disconnect, setVisible]);

  // Truncate pubkey for display: "7xKXt...F3Qr"
  const truncatedKey = publicKey
    ? `${publicKey.toBase58().slice(0, 5)}...${publicKey.toBase58().slice(-4)}`
    : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {error && (
        <span
          style={{
            fontSize: 11,
            color: "var(--red, #ef4444)",
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={error}
        >
          ⚠ {error}
        </span>
      )}

      <button
        className="btn-ghost"
        onClick={handleClick}
        disabled={connecting}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          position: "relative",
        }}
      >
        {connecting ? (
          <>
            <span className="spinner" />
            Connecting...
          </>
        ) : connected && truncatedKey ? (
          <>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#10b981",
                display: "inline-block",
                boxShadow: "0 0 6px rgba(16, 185, 129, 0.5)",
              }}
            />
            {truncatedKey}
          </>
        ) : (
          <>🔌 Connect Wallet</>
        )}
      </button>
    </div>
  );
}
