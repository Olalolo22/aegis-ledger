import {
  DisbursementRecipient,
  DisbursementReceipt,
  OfframpProvider,
} from "./types";
import { SandboxOfframpProvider } from "./sandbox";

export class KotaniPayProvider implements OfframpProvider {
  name = "Kotani Pay B2C Gateway";
  isSandbox = false;

  private apiKey: string;
  private baseUrl: string;
  private sandboxFallback: SandboxOfframpProvider;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.KOTANI_API_KEY || "";
    this.baseUrl =
      baseUrl || process.env.KOTANI_BASE_URL || "https://sandbox.kotanipay.com/api/v2";
    this.sandboxFallback = new SandboxOfframpProvider();
    if (!this.apiKey) {
      this.isSandbox = true;
    }
  }

  async disburse(
    recipient: DisbursementRecipient,
    batchRoot: string
  ): Promise<DisbursementReceipt> {
    if (this.isSandbox || !this.apiKey) {
      return this.sandboxFallback.disburse(recipient, batchRoot);
    }

    const isMpesa = recipient.rail === "kes_mpesa";
    const payload = isMpesa
      ? {
          phoneNumber: recipient.destinationAccount.replace(/\s+/g, ""),
          amount: recipient.amountLocal,
          currency: "KES",
          reference: recipient.noteCommitment.slice(0, 12),
        }
      : {
          accountNumber:
            recipient.destinationAccount.split("·")[1]?.trim() ||
            recipient.destinationAccount,
          amount: recipient.amountLocal,
          currency: "NGN",
          reference: recipient.noteCommitment.slice(0, 12),
        };

    const res = await fetch(`${this.baseUrl}/disbursements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    // Fail loud when live API key is configured — never silently fake a live disbursement
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`KotaniPay live disbursement failed (${res.status}): ${body || res.statusText}`);
    }

    const data = await res.json();
    const exchangeRate =
      recipient.exchangeRate ??
      (recipient.amountUsd > 0 ? recipient.amountLocal / recipient.amountUsd : 0);

    return {
      disbursementId: data.id || `kotani_${Date.now()}`,
      batchRoot,
      noteCommitment: recipient.noteCommitment,
      recipientWallet: recipient.wallet,
      maskedAccount: recipient.destinationAccount,
      fiatAmount: recipient.amountLocal,
      fiatCurrency: recipient.currency,
      usdAmount: recipient.amountUsd,
      exchangeRate,
      fxProvider: recipient.fxProvider,
      fxQuotedAt: recipient.fxQuotedAt,
      fxQuoteId: recipient.fxQuoteId,
      railReference: data.reference || `KP-${Date.now()}`,
      settledAt: new Date().toISOString(),
      status: "SETTLED",
      network: "solana-devnet",
      provider: "Kotani Pay (Live)",
      privacyProof: {
        teeAttestation: `aegis:merkle:v1:${batchRoot}`,
        onChainTrace: "NONE (Attested in TEE Merkle Root)",
        solscanStatus: "CONFIDENTIAL",
        hashSignature: recipient.noteCommitment,
      },
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
