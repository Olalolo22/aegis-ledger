import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import {
  buildBatchMerkleTree,
  computeLeafCommitment,
  generateNoteSalt,
  verifyBatchCompleteness,
  verifyMerkleInclusionProof,
  type BatchMerkleTree,
  type MerkleInclusionProof,
  type MerkleLeafInput,
} from "./merkle";
import { computeMagicBlockSplitPlan, type MagicBlockSplitPlan } from "./denominate";

/**
 * MagicBlock Private Ephemeral Rollups (PER / Intel TDX TEE) Client.
 *
 * Execution Architecture:
 * - On-chain shielded payouts NEVER emit plaintext L1 SPL/SOL transfers from
 *   the treasury to employees.
 * - Instead, treasury funds are delegated into MagicBlock's Private Ephemeral
 *   Rollup (`POST /v1/spl/deposit` with `private: true`) and disbursed via
 *   `POST /v1/spl/transfer` with `visibility: "private"`, `fromBalance: "ephemeral"`,
 *   randomized sub-transfer `split`, and `minDelayMs`/`maxDelayMs` timing jitter.
 * - Every batch (both on-chain shielded and fiat off-ramp recipients) is committed
 *   into a domain-separated Binary SHA-256 Merkle Sum Tree (`src/lib/merkle.ts`)
 *   so recipients can verify inclusion and auditors can verify full completeness.
 */

export const MAGICBLOCK_API_URL =
  process.env.NEXT_PUBLIC_MAGICBLOCK_API_URL || "https://api.magicblock.app";

export const MAGICBLOCK_CLUSTER =
  process.env.NEXT_PUBLIC_MAGICBLOCK_CLUSTER || "devnet-private";

export const ER_RPC =
  process.env.NEXT_PUBLIC_ER_RPC || "https://devnet-tee.magicblock.app";

export const TEE_VALIDATOR = new PublicKey(
  process.env.NEXT_PUBLIC_TEE_VALIDATOR || "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"
);

export const L1_DEVNET_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";

export const DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

export const MAINNET_USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

export const NATIVE_SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

export const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

export {
  buildBatchMerkleTree,
  computeLeafCommitment,
  generateNoteSalt,
  verifyBatchCompleteness,
  verifyMerkleInclusionProof,
  type BatchMerkleTree,
  type MerkleInclusionProof,
  type MerkleLeafInput,
};

let _erConnection: Connection | null = null;

export function getErConnection(endpoint: string = ER_RPC): Connection {
  if (endpoint !== ER_RPC) {
    return new Connection(endpoint, "confirmed");
  }
  if (!_erConnection) {
    _erConnection = new Connection(ER_RPC, "confirmed");
  }
  return _erConnection;
}

export interface MagicBlockBalanceResponse {
  address: string;
  mint: string;
  ata: string;
  location: "base" | "ephemeral" | string;
  balance: string;
  delegation: {
    status: "delegated" | "undelegated" | string;
    validator?: string;
  };
}

export interface MagicBlockTxResponse {
  kind: "deposit" | "transfer" | "withdraw" | string;
  version: "legacy" | "v0";
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  sendRpcEndpoint?: string;
  from?: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator: string;
  fees?: {
    lamports: string;
    tokens: string;
  };
}

export interface TeeBatchRecipient {
  wallet: string;
  amountLamports: bigint;
  token?: "USDC" | "USDT" | "SOL";
  tokenMint?: string;
  settlementRail?: "onchain_shielded" | "ngn_bank" | "kes_mpesa";
  destinationAccount?: string;
  memo?: string;
}

export interface BatchManifestEntry {
  index: number;
  recipient: string;
  amountBaseUnits: string;
  tokenSymbol: "USDC" | "USDT" | "SOL";
  tokenMint: string;
  settlementRail: "onchain_shielded" | "ngn_bank" | "kes_mpesa";
  saltHex: string;
  runNonce: string;
  commitmentHash: string;
  splitPlan?: MagicBlockSplitPlan;
  merkleProof: MerkleInclusionProof;
}

export interface PrivateBatchPlan {
  merkleTree: BatchMerkleTree;
  manifestEntries: BatchManifestEntry[];
  onChainTransfers: Array<{
    recipientIndex: number;
    recipient: string;
    mint: string;
    amountBaseUnits: bigint;
    splitPlan: MagicBlockSplitPlan;
    commitmentHash: string;
  }>;
  offRampRecipients: Array<{
    recipientIndex: number;
    recipient: string;
    amountBaseUnits: bigint;
    tokenSymbol: "USDC" | "USDT" | "SOL";
    settlementRail: "ngn_bank" | "kes_mpesa";
    destinationAccount?: string;
    commitmentHash: string;
    merkleProof: MerkleInclusionProof;
  }>;
  totalsByMint: Record<string, bigint>;
}

/**
 * Resolves the SPL mint address for a recipient row.
 */
export function resolveMintForToken(
  token: "USDC" | "USDT" | "SOL" | undefined,
  defaultMint: string
): string {
  if (token === "SOL") return NATIVE_SOL_MINT.toBase58();
  if (token === "USDC") return defaultMint || DEVNET_USDC_MINT.toBase58();
  return defaultMint || DEVNET_USDC_MINT.toBase58();
}

/**
 * Plans a confidential payroll batch:
 * 1. Generates per-recipient random 16-byte salts.
 * 2. Builds a real Binary SHA-256 Merkle Sum Tree over ALL recipients
 *    (on-chain shielded + fiat off-ramp) for inclusion & completeness proofs.
 * 3. Computes MagicBlock PER split/delay parameters for each on-chain transfer.
 */
export function planPrivatePayrollBatch(
  recipients: TeeBatchRecipient[],
  defaultTokenMint: string,
  runNonce: string
): PrivateBatchPlan {
  if (recipients.length === 0) {
    throw new Error("Payroll batch must contain at least one recipient.");
  }

  const leafInputs: MerkleLeafInput[] = [];
  const salts: string[] = [];
  const resolvedMints: string[] = [];
  const resolvedRails: Array<"onchain_shielded" | "ngn_bank" | "kes_mpesa"> = [];
  const resolvedSymbols: Array<"USDC" | "USDT" | "SOL"> = [];

  for (const r of recipients) {
    // Validate recipient pubkey eagerly before building any tree/tx
    new PublicKey(r.wallet);

    const tokenSymbol = r.token || (defaultTokenMint === NATIVE_SOL_MINT.toBase58() ? "SOL" : "USDC");
    const tokenMint = r.tokenMint || resolveMintForToken(tokenSymbol, defaultTokenMint);
    const rail = r.settlementRail || "onchain_shielded";
    const saltHex = generateNoteSalt();

    salts.push(saltHex);
    resolvedMints.push(tokenMint);
    resolvedRails.push(rail);
    resolvedSymbols.push(tokenSymbol);

    leafInputs.push({
      recipient: r.wallet,
      amountBaseUnits: r.amountLamports,
      tokenMint,
      settlementRail: rail,
      saltHex,
      runNonce,
    });
  }

  const merkleTree = buildBatchMerkleTree(leafInputs);
  const manifestEntries: BatchManifestEntry[] = [];
  const onChainTransfers: PrivateBatchPlan["onChainTransfers"] = [];
  const offRampRecipients: PrivateBatchPlan["offRampRecipients"] = [];
  const totalsByMint: Record<string, bigint> = {};

  recipients.forEach((r, index) => {
    const tokenSymbol = resolvedSymbols[index];
    const tokenMint = resolvedMints[index];
    const rail = resolvedRails[index];
    const decimals = tokenSymbol === "SOL" ? 9 : 6;
    const commitmentHash = merkleTree.leaves[index];
    const merkleProof = merkleTree.getProof(index);

    const isOffRamp = rail === "ngn_bank" || rail === "kes_mpesa";
    const splitPlan = isOffRamp
      ? undefined
      : computeMagicBlockSplitPlan(r.amountLamports, decimals);

    manifestEntries.push({
      index,
      recipient: r.wallet,
      amountBaseUnits: r.amountLamports.toString(),
      tokenSymbol,
      tokenMint,
      settlementRail: rail,
      saltHex: salts[index],
      runNonce,
      commitmentHash,
      splitPlan,
      merkleProof,
    });

    if (isOffRamp) {
      offRampRecipients.push({
        recipientIndex: index,
        recipient: r.wallet,
        amountBaseUnits: r.amountLamports,
        tokenSymbol,
        settlementRail: rail,
        destinationAccount: r.destinationAccount,
        commitmentHash,
        merkleProof,
      });
    } else {
      onChainTransfers.push({
        recipientIndex: index,
        recipient: r.wallet,
        mint: tokenMint,
        amountBaseUnits: r.amountLamports,
        splitPlan: splitPlan!,
        commitmentHash,
      });
      totalsByMint[tokenMint] = (totalsByMint[tokenMint] ?? 0n) + r.amountLamports;
    }
  });

  return {
    merkleTree,
    manifestEntries,
    onChainTransfers,
    offRampRecipients,
    totalsByMint,
  };
}

/**
 * Anchors a pure Merkle Sum Tree root attestation on the MagicBlock TEE
 * (used for 100% off-ramp fiat batches where no on-chain SPL transfers occur).
 * Contains zero recipient addresses and zero individual salary amounts.
 */
export function buildBatchRootAttestationTx(
  payer: PublicKey,
  merkleRoot: string,
  leafCount: number,
  recentBlockhash: string
): Transaction {
  const tx = new Transaction({ recentBlockhash, feePayer: payer });
  const memoData = `aegis:merkle:v1:${merkleRoot}:${leafCount}`;
  tx.add(
    new TransactionInstruction({
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoData, "utf-8"),
    })
  );
  return tx;
}

/**
 * Deserializes a base64 transaction returned by the MagicBlock Private SPL API
 * into a Solana Legacy Transaction or VersionedTransaction.
 */
export function deserializeMagicBlockTx(
  txResponse: MagicBlockTxResponse
): Transaction | VersionedTransaction {
  if (!txResponse.transactionBase64) {
    throw new Error("MagicBlock API response is missing transactionBase64.");
  }
  const rawBytes = Buffer.from(txResponse.transactionBase64, "base64");
  if (txResponse.version === "v0") {
    return VersionedTransaction.deserialize(rawBytes);
  }
  return Transaction.from(rawBytes);
}

/**
 * Broadcasts a signed MagicBlock Private SPL transaction strictly to the RPC
 * designated by `txResponse.sendTo`.
 *
 * SECURITY INVARIANT:
 * - Ephemeral private transfers (`sendTo === "ephemeral"`) are broadcast ONLY
 *   to the MagicBlock TEE validator (`sendRpcEndpoint || ER_RPC`).
 * - NEVER silently fall back to public L1 Solana RPC if the TEE validator fails.
 */
export async function broadcastMagicBlockTx(
  signedTx: Transaction | VersionedTransaction,
  txResponse: MagicBlockTxResponse,
  baseConnection: Connection
): Promise<string> {
  const serialized = signedTx.serialize();

  if (txResponse.sendTo === "ephemeral") {
    const erConn = getErConnection(txResponse.sendRpcEndpoint || ER_RPC);
    return erConn.sendRawTransaction(serialized, {
      skipPreflight: false,
      maxRetries: 3,
    });
  }

  return baseConnection.sendRawTransaction(serialized, {
    skipPreflight: false,
    maxRetries: 3,
  });
}

/**
 * Checks MagicBlock Private SPL API health.
 */
export async function checkMagicBlockHealth(): Promise<{ status: string }> {
  const res = await fetch(`${MAGICBLOCK_API_URL}/health`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`MagicBlock API health check failed (${res.status})`);
  }
  return res.json();
}

/**
 * MagicBlock Private SPL API: Checks account balance & TEE delegation status.
 */
export async function queryMagicBlockSplBalance(
  address: string,
  mint: string = DEVNET_USDC_MINT.toBase58(),
  cluster: string = MAGICBLOCK_CLUSTER
): Promise<MagicBlockBalanceResponse> {
  const url = new URL(`${MAGICBLOCK_API_URL}/v1/spl/balance`);
  url.searchParams.set("address", address);
  url.searchParams.set("mint", mint);
  url.searchParams.set("cluster", cluster);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MagicBlock balance query failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

/**
 * MagicBlock Private SPL API: Builds a delegated private TEE deposit transaction
 * (Base L1 -> MagicBlock Ephemeral Rollup enclave).
 */
export async function buildMagicBlockSplDeposit(
  owner: string,
  amount: number | bigint,
  mint: string = DEVNET_USDC_MINT.toBase58(),
  cluster: string = MAGICBLOCK_CLUSTER
): Promise<MagicBlockTxResponse> {
  const numericAmount = typeof amount === "bigint" ? Number(amount) : amount;
  if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0) {
    throw new Error(`Invalid MagicBlock deposit amount: ${amount.toString()}`);
  }

  const res = await fetch(`${MAGICBLOCK_API_URL}/v1/spl/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner,
      amount: numericAmount,
      cluster,
      mint,
      initIfMissing: true,
      initAtasIfMissing: true,
      private: true,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MagicBlock deposit builder failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

/**
 * MagicBlock Private SPL API: Builds a private transfer executed inside the
 * MagicBlock TEE enclave with randomized splits and timing delays.
 */
export async function buildMagicBlockSplTransfer(params: {
  from: string;
  to: string;
  amount: number | bigint;
  mint?: string;
  fromBalance?: "ephemeral" | "base";
  toBalance?: "base" | "ephemeral";
  split?: number;
  minDelayMs?: string;
  maxDelayMs?: string;
  memo?: string;
  cluster?: string;
}): Promise<MagicBlockTxResponse> {
  const numericAmount = typeof params.amount === "bigint" ? Number(params.amount) : params.amount;
  if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0) {
    throw new Error(`Invalid MagicBlock transfer amount: ${params.amount.toString()}`);
  }

  const res = await fetch(`${MAGICBLOCK_API_URL}/v1/spl/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: params.from,
      to: params.to,
      mint: params.mint || DEVNET_USDC_MINT.toBase58(),
      amount: numericAmount,
      cluster: params.cluster || MAGICBLOCK_CLUSTER,
      visibility: "private",
      fromBalance: params.fromBalance || "ephemeral",
      toBalance: params.toBalance || "base",
      split: params.split || 1,
      minDelayMs: params.minDelayMs || "500",
      maxDelayMs: params.maxDelayMs || "2500",
      memo: params.memo || "aegis:per:payroll",
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MagicBlock transfer builder failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}
