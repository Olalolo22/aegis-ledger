import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import {
  DisbursementRecipient,
  DisbursementReceipt,
  OfframpProvider,
  PrivacyProofDetails,
} from "./types";

/**
 * Mask destination account for zero-knowledge receipt exposure.
 * Examples:
 * - "Access Bank · 0123456789" -> "Access Bank · 0123****89"
 * - "+254712345678" -> "+254 712 *** 78"
 */
function maskDestination(dest: string): string {
  if (dest.includes("·")) {
    const [bank, acct] = dest.split("·").map((s) => s.trim());
    if (acct && acct.length >= 8) {
      const masked = `${acct.slice(0, 4)}****${acct.slice(-2)}`;
      return `${bank} · ${masked}`;
    }
    return dest;
  }

  // Phone number (e.g., Kenyan M-Pesa)
  const cleaned = dest.replace(/\s+/g, "");
  if (cleaned.length >= 10) {
    return `${cleaned.slice(0, 6)} *** ${cleaned.slice(-2)}`;
  }

  return dest;
}

/**
 * Deterministic reference generator simulating NIBSS / Safaricom M-Pesa rails
 */
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
 * Computes an immutable cryptographic verification proof tying the off-ramp
 * disbursement to the MagicBlock TEE batch root.
 */
function computePrivacyProof(
  batchRoot: string,
  noteCommitment: string,
  fiatAmount: number
): PrivacyProofDetails {
  const payload = new TextEncoder().encode(
    `aegis:settlement:${batchRoot}:${noteCommitment}:${fiatAmount}`
  );
  const hashSignature = bytesToHex(sha256(payload));

  return {
    teeAttestation: `aegis:tee:batch:${batchRoot.slice(0, 32)}`,
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
    const privacyProof = computePrivacyProof(
      batchRoot,
      recipient.noteCommitment,
      recipient.amountLocal
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
      exchangeRate:
        recipient.amountUsd > 0
          ? Math.round((recipient.amountLocal / recipient.amountUsd) * 100) / 100
          : 0,
      railReference: railRef,
      settledAt: new Date().toISOString(),
      status: "SETTLED",
      network: "solana-devnet",
      provider: recipient.rail === "kes_mpesa" ? "Kotani Pay (M-Pesa B2C)" : "Yellow Card / NIBSS Rail",
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
