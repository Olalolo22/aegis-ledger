"use client";

import React from "react";
import { IconFlagNG, IconFlagKE, IconShield, IconBolt } from "./Icons";

interface RunwayRailsCardProps {
  monthlyBurn: number;
  currentBalance: number;
  recipientCount: number;
  onTopUpClick: () => void;
}

export default function RunwayRailsCard({
  monthlyBurn,
  currentBalance,
  recipientCount,
  onTopUpClick,
}: RunwayRailsCardProps) {
  const runwayMonths = monthlyBurn > 0 ? (currentBalance / monthlyBurn).toFixed(1) : "12.0";

  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: 18,
        padding: "24px 28px",
        border: "1px solid #e8ebee",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "#8e98a6",
              textTransform: "uppercase",
              letterSpacing: "0.8px",
              fontWeight: 600,
              display: "block",
              marginBottom: 4,
            }}
          >
            Treasury Runway & Payout Rails
          </span>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#08090b",
              letterSpacing: "-0.3px",
            }}
          >
            Runway Operations
          </div>
        </div>

        <button
          onClick={onTopUpClick}
          style={{
            background: "#f4f5f7",
            border: "1px solid #e2e4e9",
            borderRadius: 7,
            padding: "5px 11px",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            fontWeight: 600,
            color: "#08090b",
            cursor: "pointer",
            transition: "all 0.15s ease",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#e8eaee";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#f4f5f7";
          }}
        >
          <span>+ Top Up Runway</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          background: "#fafbfc",
          padding: "14px 18px",
          borderRadius: 12,
          border: "1px solid #f0f1f4",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 9.5,
              color: "#8e98a6",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Monthly Payroll Burn
          </span>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#08090b",
              fontFamily: "var(--mono)",
              letterSpacing: "-0.5px",
              marginTop: 2,
            }}
          >
            ${monthlyBurn.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 500, color: "#64707f" }}>USDC</span>
          </div>
          <span style={{ fontSize: 10, color: "#8e98a6", fontFamily: "var(--mono)" }}>
            {recipientCount} active team members
          </span>
        </div>

        <div>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 9.5,
              color: "#8e98a6",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Estimated Runway
          </span>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#059669",
              fontFamily: "var(--mono)",
              letterSpacing: "-0.5px",
              marginTop: 2,
            }}
          >
            {runwayMonths} <span style={{ fontSize: 11, fontWeight: 500, color: "#059669" }}>Months</span>
          </div>
          <span style={{ fontSize: 10, color: "#8e98a6", fontFamily: "var(--mono)" }}>
            Healthy startup runway
          </span>
        </div>
      </div>

      {/* Active Settlement Rails list */}
      <div>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 9.5,
            color: "#8e98a6",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            display: "block",
            marginBottom: 8,
          }}
        >
          Connected Cross-Border Rails
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            {
              icon: <IconFlagNG width={14} height={10} />,
              name: "NGN Direct Interbank",
              detail: "Providus Bank · Kuda Microfinance",
              status: "Live Spot Rail",
              statusCol: "#059669",
            },
            {
              icon: <IconFlagKE width={14} height={10} />,
              name: "KES Mobile Money",
              detail: "Safaricom M-Pesa STK Rail",
              status: "Live Spot Rail",
              statusCol: "#d97706",
            },
            {
              icon: <IconShield size={12} style={{ color: "#0066ff" }} />,
              name: "Shielded UTXO",
              detail: "Ephemeral Rollup State",
              status: "100% Confidential",
              statusCol: "#0066ff",
            },
          ].map((r, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 10px",
                borderRadius: 8,
                background: "#ffffff",
                border: "1px solid #f0f1f4",
                fontFamily: "var(--mono)",
                fontSize: 10.5,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ display: "inline-flex", alignItems: "center" }}>{r.icon}</span>
                <span style={{ color: "#08090b", fontWeight: 600 }}>{r.name}</span>
                <span style={{ color: "#8e98a6", fontSize: 9.5 }}>· {r.detail}</span>
              </div>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: r.statusCol,
                  background: `${r.statusCol}12`,
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                {r.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer / Validator info */}
      <div
        style={{
          borderTop: "1px solid #f0f1f4",
          paddingTop: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "var(--mono)",
          fontSize: 9.5,
          color: "#8e98a6",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <IconBolt size={11} style={{ color: "#059669" }} />
          <span>Settlement Enclave: <strong>MagicBlock PER (Intel TDX)</strong></span>
        </span>
        <span style={{ color: "#059669", fontWeight: 600 }}>Sub-50ms Slots</span>
      </div>
    </div>
  );
}
