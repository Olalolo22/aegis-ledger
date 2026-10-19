"use client";

import React, { useState } from "react";
import { DisbursementReceipt } from "@/lib/offramp/types";
import { IconShield } from "./Icons";

interface SettlementReceiptModalProps {
  receipt: DisbursementReceipt;
  memo?: string;
  onClose: () => void;
}

export function SettlementReceiptModal({
  receipt,
  memo,
  onClose,
}: SettlementReceiptModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyProof = () => {
    navigator.clipboard.writeText(JSON.stringify(receipt, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(8, 9, 11, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#0d0f12",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: 12,
          maxWidth: 520,
          width: "100%",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          overflow: "hidden",
          color: "#f3f4f6",
          fontFamily: "var(--font-geist-sans, sans-serif)",
          animation: "ae-fade-up 0.2s ease both",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(34, 197, 94, 0.1)",
                border: "1px solid rgba(34, 197, 94, 0.25)",
                borderRadius: 4,
                padding: "2px 8px",
                fontSize: 10,
                fontFamily: "var(--mono)",
                color: "#22c55e",
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              <IconShield size={11} style={{ color: "#22c55e" }} />
              ZERO SOLSCAN LEAKAGE
            </div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#fff" }}>
              Confidential Settlement Receipt
            </h3>
            <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "var(--mono)" }}>
              {memo ? `${memo} · ` : ""}Disbursement #{receipt.disbursementId.slice(0, 16)}
            </span>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#9ca3af",
              fontSize: 18,
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Amount & Destination Banner */}
        <div
          style={{
            padding: "20px 24px",
            background: "rgba(255, 255, 255, 0.02)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <span style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "var(--mono)" }}>
              Settled Local Currency
            </span>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#22c55e", marginTop: 2, fontFamily: "var(--mono)" }}>
              {receipt.fiatCurrency === "NGN" ? "₦" : "KSh "}
              {receipt.fiatAmount.toLocaleString()}
            </div>
            <span style={{ fontSize: 10.5, color: "#9ca3af", fontFamily: "var(--mono)" }}>
              ≈ ${receipt.usdAmount.toLocaleString()} USDC (@ {receipt.exchangeRate} {receipt.fiatCurrency})
            </span>
          </div>

          <div>
            <span style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "var(--mono)" }}>
              Destination Account
            </span>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginTop: 4, fontFamily: "var(--mono)" }}>
              {receipt.maskedAccount}
            </div>
            <span style={{ fontSize: 10.5, color: "#6b7280", fontFamily: "var(--mono)" }}>
              Rail: {receipt.provider}
            </span>
          </div>
        </div>

        {/* Cryptographic & Audit Proofs */}
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <span style={{ fontSize: 10.5, color: "#6b7280", fontFamily: "var(--mono)", textTransform: "uppercase" }}>
              Settlement Rail Reference
            </span>
            <div
              style={{
                background: "rgba(0, 0, 0, 0.4)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 6,
                padding: "8px 12px",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "#e5e7eb",
                marginTop: 4,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{receipt.railReference}</span>
              <span style={{ fontSize: 9.5, color: "#22c55e", background: "rgba(34, 197, 94, 0.1)", padding: "2px 6px", borderRadius: 4 }}>
                CLEARED
              </span>
            </div>
          </div>

          <div>
            <span style={{ fontSize: 10.5, color: "#6b7280", fontFamily: "var(--mono)", textTransform: "uppercase" }}>
              MagicBlock TEE Attestation (Solana Devnet)
            </span>
            <div
              style={{
                background: "rgba(0, 0, 0, 0.4)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 6,
                padding: "8px 12px",
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "#9ca3af",
                marginTop: 4,
                wordBreak: "break-all",
              }}
            >
              {receipt.privacyProof.teeAttestation}
            </div>
          </div>

          <div>
            <span style={{ fontSize: 10.5, color: "#6b7280", fontFamily: "var(--mono)", textTransform: "uppercase" }}>
              Note Commitment (SHA-256)
            </span>
            <div
              style={{
                background: "rgba(0, 0, 0, 0.4)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 6,
                padding: "8px 12px",
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "#9ca3af",
                marginTop: 4,
                wordBreak: "break-all",
              }}
            >
              {receipt.noteCommitment}
            </div>
          </div>

          {/* Privacy Audit Checklist */}
          <div
            style={{
              background: "rgba(34, 197, 94, 0.04)",
              border: "1px solid rgba(34, 197, 94, 0.15)",
              borderRadius: 6,
              padding: "10px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {[
              "Personal bank account / phone number never touched Solana mempool or Explorer",
              "Individual salary amount decoupled via TEE Merkle batch attestation",
              "Clean corporate fiat settlement issued via licensed partner (no P2P exposure)",
            ].map((claim, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10.5, color: "#86efac", fontFamily: "var(--mono)" }}>
                <span>✓</span>
                <span>{claim}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(0,0,0,0.2)",
          }}
        >
          <span style={{ fontSize: 10.5, color: "#6b7280", fontFamily: "var(--mono)" }}>
            Settled: {new Date(receipt.settledAt).toLocaleTimeString()}
          </span>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleCopyProof}
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                color: "#fff",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 11,
                fontFamily: "var(--mono)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {copied ? "✓ Copied JSON" : "Copy Cryptographic Proof"}
            </button>
            <button
              onClick={onClose}
              style={{
                background: "#22c55e",
                color: "#08090b",
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                fontSize: 11,
                fontFamily: "var(--mono)",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
