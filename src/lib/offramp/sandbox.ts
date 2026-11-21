import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import {
  DisbursementRecipient,
  DisbursementReceipt,
  FxRateSource,
  OfframpProvider,
  PrivacyProofDetails,
} from "./types";
import { validatePartnerAppliedRate } from "../fx";

function maskDestination(dest: string): string {
  if (dest.includes("·")) {
    const [bank, acct] = dest.split("·").map((s) => s.trim());
    if (acct && acct.length >= 8) {
      const masked = `${acct.slice(0, 4)}****${acct.slice(-2)}`;
      return `${bank} · ${masked}`;
    }
    return dest;
  }

  const cleaned = dest.replace(/\s+/g, "");
  if (cleaned.length >= 10) {
    return `${cleaned.slice(0, 6)} *** ${cleaned.slice(-2)}`;
  }

  return dest;
}

function generateRailReference(
  rail: "ngn_bank" | "kes_mpesa",
  noteCommitment: string
): string {
  const shortHash = noteCommitment.slice(0, 8).toUpperCase();
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");

  if (rail === "ngn_bank") {
    return `NIBSS/${dateStr}/${shortHash}`;
  }
  return `MPESA/${shortHash}${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Computes a cryptographic receipt digest binding the off-ramp disbursement,
 * partner-applied execution rate, rate source, mid-market sanity spread,
 * quote timestamp, and L1-anchored Merkle root.
 */
export function computeSettlementReceiptProof(params: {
  batchRoot: string;
  noteCommitment: string;
  fiatAmount: number;
  appliedRate: number;
  fxRateSource: FxRateSource;
  referenceMidMarketRate?: number;
  fxSpreadBps?: number;
  fxProvider: string;
  fxQuotedAt: string;
  fxQuoteId: string;
}): PrivacyProofDetails {
  const payload = new TextEncoder().encode(
    `aegis:settlement:v3:${params.batchRoot}:${params.noteCommitment}:${params.fiatAmount}:${params.appliedRate}:${params.fxRateSource}:${params.referenceMidMarketRate ?? "none"}:${params.fxSpreadBps ?? 0}:${params.fxProvider}:${params.fxQuotedAt}:${params.fxQuoteId}`
  );
  const hashSignature = bytesToHex(sha256(payload));

  return {
    teeAttestation: `aegis:merkle:v1:${params.batchRoot}`,
    onChainTrace: "NONE (Attested in TEE Merkle Root)",
    solscanStatus: "CONFIDENTIAL",
    hashSignature,
  };
}

/** Simulated institutional partner spread in bps for sandbox mode (never pretends mid-market is bank execution). */
const SANDBOX_PARTNER_SPREAD_BPS: Record<"NGN" | "KES", number> = {
  NGN: -45, // -0.45% institutional off-ramp spread vs mid-market benchmark
  KES: -35, // -0.35% M-Pesa B2C spread vs mid-market benchmark
};

export class SandboxOfframpProvider implements OfframpProvider {
  name = "Aegis Sandbox Gateway (Kotani / YellowCard Protocol)";
  isSandbox = true;

  async disburse(
    recipient: DisbursementRecipient,
    batchRoot: string
  ): Promise<DisbursementReceipt> {
    const disbursementId = `disb_${Date.now()}_${recipient.noteCommitment.slice(0, 8)}`;
    const railRef = generateRailReference(recipient.rail, recipient.noteCommitment);
    const maskedAccount = maskDestination(recipient.destinationAccount);

    const referenceMidMarketRate =
      recipient.referenceMidMarketRate ??
      recipient.exchangeRate ??
      (recipient.amountUsd > 0 ? recipient.amountLocal / recipient.amountUsd : 0);

    // Derive transparent simulated partner applied rate with realistic spread vs mid-market reference
    const spreadBpsTarget = SANDBOX_PARTNER_SPREAD_BPS[recipient.currency];
    const simulatedPartnerRate = Number(
      (referenceMidMarketRate * (1 + spreadBpsTarget / 10_000)).toFixed(4)
    );

    const sanity = validatePartnerAppliedRate({
      appliedRate: simulatedPartnerRate,
      referenceMidMarketRate,
      currency: recipient.currency,
    });

    const settledFiatAmount =
      Math.round(recipient.amountUsd * sanity.appliedRate * 100) / 100;

    const fxProvider =
      recipient.rail === "kes_mpesa"
        ? "Kotani Pay Partner Quote (Sandbox Simulated)"
        : "Yellow Card / NIBSS Partner Quote (Sandbox Simulated)";
    const referenceFxProvider =
      recipient.referenceFxProvider ||
      recipient.fxProvider ||
      "ExchangeRate-API Mid-Market Reference (open.er-api.com)";
    const fxQuotedAt = recipient.fxQuotedAt || new Date().toISOString();
    const fxQuoteId = recipient.fxQuoteId || `fx_sbx_${Date.now()}`;

    const privacyProof = computeSettlementReceiptProof({
      batchRoot,
      noteCommitment: recipient.noteCommitment,
      fiatAmount: settledFiatAmount,
      appliedRate: sanity.appliedRate,
      fxRateSource: "sandbox_simulated_partner",
      referenceMidMarketRate: sanity.referenceMidMarketRate,
      fxSpreadBps: sanity.spreadBps,
      fxProvider,
      fxQuotedAt,
      fxQuoteId,
    });

    return {
      disbursementId,
      batchRoot,
      noteCommitment: recipient.noteCommitment,
      recipientWallet: recipient.wallet,
      maskedAccount,
      fiatAmount: settledFiatAmount,
      fiatCurrency: recipient.currency,
      usdAmount: recipient.amountUsd,
      exchangeRate: sanity.appliedRate,
      fxRateSource: "sandbox_simulated_partner",
      referenceMidMarketRate: sanity.referenceMidMarketRate,
      referenceFxProvider,
      fxSpreadBps: sanity.spreadBps,
      fxSanityCheckPassed: sanity.withinGuardrail,
      fxProvider,
      fxQuotedAt,
      fxQuoteId,
      railReference: railRef,
      settledAt: new Date().toISOString(),
      status: "SETTLED",
      network: "solana-devnet",
      provider:
        recipient.rail === "kes_mpesa"
          ? "Kotani Pay (M-Pesa B2C · Sandbox)"
          : "Yellow Card / NIBSS Rail · Sandbox",
      privacyProof,
    };
  }

  async disburseBatch(
    recipients: DisbursementRecipient[],
    batchRoot: string
  ): Promise<DisbursementReceipt[]> {
    const receipts: DisbursementReceipt[] = [];
    for (const r of recipients) {
      const receipt = await this.disburse(r, batchRoot);
      receipts.push(receipt);
    }
    return receipts;
  }
}
