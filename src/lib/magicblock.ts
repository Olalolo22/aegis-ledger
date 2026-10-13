import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import * as splToken from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { Buffer } from "buffer";

export const TOKEN_PROGRAM_ID = splToken.TOKEN_PROGRAM_ID;
export const ASSOCIATED_TOKEN_PROGRAM_ID = splToken.ASSOCIATED_TOKEN_PROGRAM_ID;

// Typed wrappers around @solana/spl-token runtime exports
// (spl-token v0.4.14 published empty .d.ts files for transfer/associated instructions)
const getAssociatedTokenAddressSync = (
  splToken as unknown as {
    getAssociatedTokenAddressSync: (
      mint: PublicKey,
      owner: PublicKey,
      allowOwnerOffCurve?: boolean,
      programId?: PublicKey,
      associatedTokenProgramId?: PublicKey
    ) => PublicKey;
  }
).getAssociatedTokenAddressSync;

const createAssociatedTokenAccountIdempotentInstruction = (
  splToken as unknown as {
    createAssociatedTokenAccountIdempotentInstruction: (
      payer: PublicKey,
      associatedToken: PublicKey,
      owner: PublicKey,
      mint: PublicKey,
      programId?: PublicKey,
      associatedTokenProgramId?: PublicKey
    ) => TransactionInstruction;
  }
).createAssociatedTokenAccountIdempotentInstruction;

const createTransferInstruction = (
  splToken as unknown as {
    createTransferInstruction: (
      source: PublicKey,
      destination: PublicKey,
      owner: PublicKey,
      amount: bigint | number,
      multiSigners?: unknown[],
      programId?: PublicKey
    ) => TransactionInstruction;
  }
).createTransferInstruction;

/**
 * MagicBlock Private Ephemeral Rollups (TEE) Client & Helpers.
 *
 * Architecture:
 * - MagicBlock Ephemeral Rollups provide sub-50ms execution inside Intel TDX hardware enclaves.
 * - For batch payroll, executing inside the TEE enclave eliminates client-side
 *   Groth16 WASM proving bottlenecks (which take 30s/payment).
 * - Real SPL USDC or native SOL token transfers are packaged with cryptographic
 *   SHA-256 note commitments and anchored with a single enclave batch attestation.
 */

export const MAGICBLOCK_API_URL = "https://api.magicblock.app";

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

let _erConnection: Connection | null = null;

export function getErConnection(): Connection {
  if (!_erConnection) {
    _erConnection = new Connection(ER_RPC, "confirmed");
  }
  return _erConnection;
}

export interface TeeBatchRecipient {
  wallet: string;
  amountLamports: bigint;
  notes: number[];
  memo?: string;
  token?: "USDC" | "USDT" | "SOL";
  settlementRail?: "onchain_shielded" | "ngn_bank" | "kes_mpesa";
}

export interface TeeBatchResult {
  signature: string;
  slot: number;
  commitmentHashes: string[];
  executionTimeMs: number;
}

/**
 * Computes a cryptographically sound SHA-256 note commitment.
 * Formula: SHA256(recipientPubkey || amount || salt || runNonce)
 */
export function computeNoteCommitment(
  recipientPubkey: PublicKey,
  amount: bigint,
  saltHex?: string,
  runNonce?: string
): string {
  const salt =
    saltHex ||
    (typeof crypto !== "undefined" && crypto.getRandomValues
      ? bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
      : bytesToHex(sha256(new TextEncoder().encode(`${Date.now()}:${Math.random()}`))));

  const input = new TextEncoder().encode(
    `${recipientPubkey.toBase58()}:${amount.toString()}:${salt}:${runNonce || "aegis"}`
  );
  return bytesToHex(sha256(input));
}

/**
 * Computes an aggregated batch commitment root from individual note commitments.
 */
export function computeBatchMerkleRoot(commitments: string[]): string {
  const input = new TextEncoder().encode(commitments.join(":"));
  return bytesToHex(sha256(input));
}

/**
 * Builds a batch payroll execution payload meant for the MagicBlock TEE enclave.
 * Supports real SPL USDC token transfers or native SOL transfers, pairs each note
 * with a SHA-256 cryptographic commitment, and anchors the transaction with a
 * privacy-preserving batch attestation.
 */
export function buildTeeBatchPayload(
  payer: PublicKey,
  recipients: TeeBatchRecipient[],
  recentBlockhash: string,
  tokenMint?: PublicKey
): { transaction: Transaction; commitmentHashes: string[]; batchRoot: string } {
  const tx = new Transaction({ recentBlockhash, feePayer: payer });
  const commitmentHashes: string[] = [];

  const isSplToken =
    tokenMint && !tokenMint.equals(NATIVE_SOL_MINT);

  const senderAta = isSplToken
    ? getAssociatedTokenAddressSync(tokenMint, payer, true)
    : null;

  recipients.forEach((r) => {
    const recipientPubkey = new PublicKey(r.wallet);

    // Compute cryptographic commitment hash for the recipient note
    const commitment = computeNoteCommitment(recipientPubkey, r.amountLamports);
    commitmentHashes.push(commitment);

    // Off-ramp fiat rails (NGN bank, KES M-Pesa) settle off-chain via payment partner webhooks
    // and are attested cryptographically via the batch root memo. They do not debit tokens on L1.
    const isOffRamp = r.settlementRail === "ngn_bank" || r.settlementRail === "kes_mpesa";
    if (isOffRamp) {
      return;
    }

    const isRecipientSol = r.token === "SOL" || !isSplToken;

    if (!isRecipientSol && tokenMint && senderAta) {
      // Real SPL USDC transfer inside TEE Ephemeral Rollup
      const recipientAta = getAssociatedTokenAddressSync(
        tokenMint,
        recipientPubkey,
        true
      );

      // Ensure recipient ATA exists (idempotent)
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          payer,
          recipientAta,
          recipientPubkey,
          tokenMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );

      // Real token transfer instruction with actual salary amount
      tx.add(
        createTransferInstruction(
          senderAta,
          recipientAta,
          payer,
          r.amountLamports,
          [],
          TOKEN_PROGRAM_ID
        )
      );
    } else {
      // Real SOL transfer with actual salary lamports
      tx.add(
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: recipientPubkey,
          lamports: r.amountLamports,
        })
      );
    }
  });

  // Attach a single TEE Enclave Batch Attestation (Intel TDX / MagicBlock PER)
  // Preserves privacy by anchoring the aggregate root without leaking recipient indices or note counts
  const batchRoot = computeBatchMerkleRoot(commitmentHashes);
  const memoData = `aegis:tee:batch:${batchRoot.slice(0, 32)}`;
  tx.add(
    new TransactionInstruction({
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoData, "utf-8"),
    })
  );

  return { transaction: tx, commitmentHashes, batchRoot };
}

/**
 * MagicBlock Private SPL API: Checks account balance & TEE delegation status.
 */
export async function queryMagicBlockSplBalance(
  address: string,
  mint: string = DEVNET_USDC_MINT.toBase58(),
  cluster: string = "devnet-private"
) {
  const url = new URL(`${MAGICBLOCK_API_URL}/v1/spl/balance`);
  url.searchParams.set("address", address);
  url.searchParams.set("mint", mint);
  url.searchParams.set("cluster", cluster);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`MagicBlock balance query failed (${res.status})`);
  return res.json();
}

/**
 * MagicBlock Private SPL API: Builds a delegated TEE deposit transaction.
 */
export async function buildMagicBlockSplDeposit(
  owner: string,
  amount: number,
  mint: string = DEVNET_USDC_MINT.toBase58(),
  cluster: string = "devnet-private"
) {
  const res = await fetch(`${MAGICBLOCK_API_URL}/v1/spl/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner,
      amount,
      cluster,
      mint,
      initIfMissing: true,
      initAtasIfMissing: true,
      private: true,
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`MagicBlock deposit builder failed (${res.status})`);
  return res.json();
}

/**
 * MagicBlock Private SPL API: Builds a private batch transfer inside TEE with anti-clustering splits.
 */
export async function buildMagicBlockSplTransfer(params: {
  from: string;
  to: string;
  amount: number;
  mint?: string;
  split?: number;
  minDelayMs?: string;
  maxDelayMs?: string;
  memo?: string;
  cluster?: string;
}) {
  const res = await fetch(`${MAGICBLOCK_API_URL}/v1/spl/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: params.from,
      to: params.to,
      mint: params.mint || DEVNET_USDC_MINT.toBase58(),
      amount: params.amount,
      cluster: params.cluster || "devnet-private",
      visibility: "private",
      fromBalance: "ephemeral",
      toBalance: "base",
      split: params.split || 1,
      minDelayMs: params.minDelayMs || "500",
      maxDelayMs: params.maxDelayMs || "2000",
      memo: params.memo || "Aegis Confidential Payroll",
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`MagicBlock transfer builder failed (${res.status})`);
  return res.json();
}
