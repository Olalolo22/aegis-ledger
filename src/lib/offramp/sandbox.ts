import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import {
  DisbursementRecipient,
  DisbursementReceipt,
  OfframpProvider,
  PrivacyProofDetails,
} from "./types";

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
 * server-quoted FX rate, FX provider, quote timestamp, and L1-anchored Merkle root.
 */
function computePrivacyProof(
  batchRoot: string,
  noteCommitment: string,
  fiatAmount: number,
  exchangeRate: number,
  fxProvider: string,
  fxQuotedAt: string,
  fxQuoteId: string
): PrivacyProofDetails {
  const payload = new TextEncoder().encode(
    `aegis:settlement:v2:${batchRoot}:${noteCommitment}:${fiatAmount}:${exchangeRate}:${fxProvider}:${fxQuotedAt}:${fxQuoteId}`
  );
  const hashSignature = bytesToHex(sha256(payload));

  return {
    teeAttestation: `aegis:merkle:v1:${batchRoot}`,
    onChainTrace: "NONE (Attested in TEE Merkle Root)",
    solscanStatus: "CONFIDENTIAL",
    hashSignature,
  };
}

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
    const exchangeRate =
      recipient.exchangeRate ??
      (recipient.amountUsd > 0
        ? Math.round((recipient.amountLocal / recipient.amountUsd) * 100) / 100
        : 0);
    const fxProvider = recipient.fxProvider || "Server-Quoted Live Spot FX";
    const fxQuotedAt = recipient.fxQuotedAt || new Date().toISOString();
    const fxQuoteId = recipient.fxQuoteId || `fx_local_${Date.now()}`;

    const privacyProof = computePrivacyProof(
      batchRoot,
      recipient.noteCommitment,
      recipient.amountLocal,
      exchangeRate,
      fxProvider,
      fxQuotedAt,
      fxQuoteId
    );

    return {
      disbursementId,
      batchRoot,
      noteCommitment: recipient.noteCommitment,
      recipientWallet: recipient.wallet,
      maskedAccount,
      fiatAmount: recipient.amountLocal,
      fiatCurrency: recipient.currency,
      usdAmount: recipient.amountUsd,
      exchangeRate,
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
