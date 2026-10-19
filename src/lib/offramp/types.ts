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
