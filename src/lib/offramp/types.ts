export type SupportedRail = "ngn_bank" | "kes_mpesa";

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
  /** Server-quoted FX rate stamped at dispatch time */
  exchangeRate?: number;
  /** Live FX quote provider attribution */
  fxProvider?: string;
  /** ISO-8601 timestamp when the FX quote was locked server-side */
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
  exchangeRate: number;
  /** Attribution for the live FX quote provider */
  fxProvider?: string;
  /** ISO-8601 timestamp when the FX rate was quoted at dispatch */
  fxQuotedAt?: string;
  /** Server-generated FX quote ID for audit trail */
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
