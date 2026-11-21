export type SupportedRail = "ngn_bank" | "kes_mpesa";
export type FxRateSource = "partner_applied" | "sandbox_simulated_partner";

export interface DestinationAccountDetails {
  bankName?: string;
  bankCode?: string;
  accountNumber?: string;
  phoneNumber?: string;
  accountName?: string;
}

export interface DisbursementRecipient {
  recipientId: string;
  wallet: string;
  amountUsd: number;
  amountLocal: number;
  currency: "NGN" | "KES";
  rail: SupportedRail;
  destinationAccount: string;
  noteCommitment: string;
  /** Partner-applied FX execution rate (authoritative rate stamped on receipt) */
  exchangeRate?: number;
  /** Live mid-market benchmark rate used strictly as a sanity-check guardrail */
  referenceMidMarketRate?: number;
  /** Attribution for the reference mid-market sanity-check feed */
  referenceFxProvider?: string;
  /** Attribution for the authoritative FX rate source */
  fxProvider?: string;
  /** ISO-8601 timestamp when the FX quote / sanity benchmark was locked */
  fxQuotedAt?: string;
  /** Unique quote identifier for accounting & reconciliation */
  fxQuoteId?: string;
}

export interface PrivacyProofDetails {
  teeAttestation: string;
  onChainTrace: "NONE (Attested in TEE Merkle Root)";
  solscanStatus: "CONFIDENTIAL";
  hashSignature: string;
}

export interface DisbursementReceipt {
  disbursementId: string;
  batchRoot: string;
  noteCommitment: string;
  recipientWallet: string;
  maskedAccount: string;
  fiatAmount: number;
  fiatCurrency: "NGN" | "KES";
  usdAmount: number;
  /** Authoritative payout partner applied rate (reconciles 1:1 with partner statement) */
  exchangeRate: number;
  /** Explicitly indicates whether `exchangeRate` came from a live partner or sandbox simulation */
  fxRateSource: FxRateSource;
  /** Mid-market benchmark rate recorded strictly as a sanity-check reference */
  referenceMidMarketRate?: number;
  /** Provider for the mid-market sanity benchmark (e.g. open.er-api.com) */
  referenceFxProvider?: string;
  /** Basis-point spread between partner applied rate and mid-market benchmark */
  fxSpreadBps?: number;
  /** True when partner applied rate passed the mid-market deviation guardrail */
  fxSanityCheckPassed?: boolean;
  /** Attribution for the authoritative applied rate provider */
  fxProvider?: string;
  /** ISO-8601 timestamp when the rate was locked */
  fxQuotedAt?: string;
  /** Quote / partner execution reference ID for reconciliation */
  fxQuoteId?: string;
  railReference: string;
  settledAt: string;
  status: "PENDING" | "SETTLED" | "FAILED";
  network: "solana-devnet" | "solana-mainnet";
  provider: string;
  privacyProof: PrivacyProofDetails;
}

export interface OfframpProvider {
  name: string;
  isSandbox: boolean;
  disburse(
    recipient: DisbursementRecipient,
    batchRoot: string
  ): Promise<DisbursementReceipt>;
  disburseBatch(
    recipients: DisbursementRecipient[],
    batchRoot: string
  ): Promise<DisbursementReceipt[]>;
}
