import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { MEMO_PROGRAM_ID } from "./magicblock";
import {
  computeLeafCommitment,
  verifyMerkleInclusionProof,
  type MerkleInclusionProof,
} from "./merkle";

/**
 * On-chain Solana L1 & MagicBlock Ephemeral Rollup settlement verifier.
 *
 * Closes two critical audit gaps:
 * 1. Root anchoring: every payroll batch anchors `aegis:merkle:v1:<root>:<count>`
 *    on Solana L1. Both `/api/payroll/confirm` and `/api/audit/decrypt` pull
 *    that memo straight back off Solana L1 RPC rather than trusting Postgres.
 * 2. Settlement-to-leaf binding: before sealing a batch as `completed`,
 *    `/api/payroll/confirm` fetches every MagicBlock Private SPL transfer
 *    transaction, decodes the wire instruction (`SPLxh1LVZz...`, discriminant
 *    `0x10`), and verifies `(sender, recipient, mint, amountBaseUnits, memo)`
 *    against the leaf committed into the L1-anchored Merkle Sum Tree.
 */

export const MAGICBLOCK_EPHEMERAL_SPL_PROGRAM_ID =
  "SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2";

export const MAGICBLOCK_PRIVATE_TRANSFER_DISCRIMINANT = 0x10; // 16

const ANCHOR_MEMO_REGEX = /^aegis:merkle:v1:([0-9a-fA-F]{64}):(\d+)$/;

export interface ParsedAnchorMemo {
  merkleRoot: string;
  leafCount: number;
}

export interface DecodedMagicBlockTransfer {
  programId: string;
  discriminant: number;
  amountBaseUnits: bigint;
  minDelayMs: bigint;
  maxDelayMs: bigint;
  split: number;
  mint: string;
  senderAta: string;
  recipient: string;
  sender: string;
  signerPubkeys: string[];
  memo?: string;
}

export interface OnChainAnchorVerification {
  verified: boolean;
  signature: string;
  slot?: number;
  blockTime?: number | null;
  onChainRoot?: string;
  onChainLeafCount?: number;
  signerVerified?: boolean;
  error?: string;
}

export interface OnChainTransferVerification {
  verified: boolean;
  signature: string;
  leafIndex: number;
  slot?: number;
  decoded?: DecodedMagicBlockTransfer;
  error?: string;
}

/**
 * Parses a canonical L1 anchor memo string:
 *   `aegis:merkle:v1:<64-char-hex-merkle-root>:<leaf-count>`
 */
export function parseAnchorMemo(memoText: string): ParsedAnchorMemo | null {
  const match = memoText.trim().match(ANCHOR_MEMO_REGEX);
  if (!match) return null;
  const leafCount = Number(match[2]);
  if (!Number.isInteger(leafCount) || leafCount <= 0) return null;
  return {
    merkleRoot: match[1].toLowerCase(),
    leafCount,
  };
}

interface NormalizedInstruction {
  programId: string;
  accountPubkeys: string[];
  data: Uint8Array;
}

/**
 * Extracts normalized instructions & signer pubkeys from either a client-built
 * Transaction/VersionedTransaction or an RPC VersionedTransactionResponse.
 */
function extractInstructionsAndSigners(
  txOrResp: Transaction | VersionedTransaction | VersionedTransactionResponse
): { instructions: NormalizedInstruction[]; signers: string[] } {
  // Case 1: Legacy client Transaction
  if (txOrResp instanceof Transaction) {
    const signers = new Set<string>();
    if (txOrResp.feePayer) signers.add(txOrResp.feePayer.toBase58());
    for (const sig of txOrResp.signatures) {
      if (sig.publicKey) signers.add(sig.publicKey.toBase58());
    }
    const instructions: NormalizedInstruction[] = txOrResp.instructions.map((ix) => {
      for (const k of ix.keys) {
        if (k.isSigner) signers.add(k.pubkey.toBase58());
      }
      return {
        programId: ix.programId.toBase58(),
        accountPubkeys: ix.keys.map((k) => k.pubkey.toBase58()),
        data: new Uint8Array(ix.data),
      };
    });
    return { instructions, signers: Array.from(signers) };
  }

  // Case 2: Client VersionedTransaction
  if (txOrResp instanceof VersionedTransaction) {
    const msg = txOrResp.message;
    const staticKeys = msg.staticAccountKeys.map((k) => k.toBase58());
    const signers = staticKeys.slice(0, msg.header.numRequiredSignatures);
    const instructions: NormalizedInstruction[] = msg.compiledInstructions.map((ix) => ({
      programId: staticKeys[ix.programIdIndex] || "",
      accountPubkeys: ix.accountKeyIndexes.map((idx) => staticKeys[idx] || ""),
      data: new Uint8Array(ix.data),
    }));
    return { instructions, signers };
  }

  // Case 3: RPC VersionedTransactionResponse
  const message = txOrResp.transaction.message;
  const staticKeys = message.staticAccountKeys.map((k: PublicKey) => k.toBase58());
  const writableLoaded = (txOrResp.meta?.loadedAddresses?.writable ?? []).map((k: PublicKey) =>
    k.toBase58()
  );
  const readonlyLoaded = (txOrResp.meta?.loadedAddresses?.readonly ?? []).map((k: PublicKey) =>
    k.toBase58()
  );
  const allKeys = [...staticKeys, ...writableLoaded, ...readonlyLoaded];
  const signers = staticKeys.slice(0, message.header.numRequiredSignatures);

  const compiledIxs =
    "compiledInstructions" in message
      ? message.compiledInstructions
      : (message as unknown as {
          instructions: Array<{ programIdIndex: number; accounts: number[]; data: string }>;
        }).instructions;

  const instructions: NormalizedInstruction[] = compiledIxs.map((ix) => {
    const accountIndexes = "accountKeyIndexes" in ix ? ix.accountKeyIndexes : ix.accounts;
    const rawData =
      typeof ix.data === "string"
        ? bs58.decode(ix.data)
        : new Uint8Array(ix.data as Uint8Array);

    return {
      programId: allKeys[ix.programIdIndex] || "",
      accountPubkeys: accountIndexes.map((idx: number) => allKeys[idx] || ""),
      data: rawData,
    };
  });

  return { instructions, signers };
}

/**
 * Decodes a MagicBlock Private SPL transfer instruction (`SPLxh1LVZz...`,
 * discriminant `0x10`) and any companion Memo instruction from a transaction.
 *
 * Wire layout verified against live `api.magicblock.app/v1/spl/transfer`:
 * - byte [0]      : 0x10 (private ephemeral transfer discriminant)
 * - bytes [1..9]  : amountBaseUnits (little-endian uint64)
 * - bytes [9..12] : 3-byte nonce/salt
 * - bytes [12..20]: minDelayMs (little-endian uint64)
 * - bytes [20..28]: maxDelayMs (little-endian uint64)
 * - bytes [28..32]: split count (little-endian uint32)
 * - keys[2]       : token mint
 * - keys[3]       : sender ATA
 * - keys[5]       : recipient owner pubkey
 * - keys[6]       : sender authority pubkey (signer)
 */
export function decodeMagicBlockTransferFromTransaction(
  txOrResp: Transaction | VersionedTransaction | VersionedTransactionResponse
): DecodedMagicBlockTransfer | null {
  const { instructions, signers } = extractInstructionsAndSigners(txOrResp);

  let decodedTransfer: DecodedMagicBlockTransfer | null = null;
  let memoText: string | undefined;

  for (const ix of instructions) {
    if (ix.programId === MEMO_PROGRAM_ID.toBase58()) {
      memoText = Buffer.from(ix.data).toString("utf8");
    }

    if (
      ix.programId === MAGICBLOCK_EPHEMERAL_SPL_PROGRAM_ID &&
      ix.data.length >= 32 &&
      ix.data[0] === MAGICBLOCK_PRIVATE_TRANSFER_DISCRIMINANT &&
      ix.accountPubkeys.length >= 7
    ) {
      const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
      decodedTransfer = {
        programId: ix.programId,
        discriminant: view.getUint8(0),
        amountBaseUnits: view.getBigUint64(1, true),
        minDelayMs: view.getBigUint64(12, true),
        maxDelayMs: view.getBigUint64(20, true),
        split: view.getUint32(28, true),
        mint: ix.accountPubkeys[2],
        senderAta: ix.accountPubkeys[3],
        recipient: ix.accountPubkeys[5],
        sender: ix.accountPubkeys[6],
        signerPubkeys: signers,
      };
    }
  }

  if (decodedTransfer && memoText !== undefined) {
    decodedTransfer.memo = memoText;
  }

  return decodedTransfer;
}

/**
 * Extracts and parses an `aegis:merkle:v1:<root>:<count>` anchor memo from a transaction.
 */
export function decodeAnchorMemoFromTransaction(
  txOrResp: Transaction | VersionedTransaction | VersionedTransactionResponse
): { anchor: ParsedAnchorMemo; signers: string[] } | null {
  const { instructions, signers } = extractInstructionsAndSigners(txOrResp);
  for (const ix of instructions) {
    if (ix.programId === MEMO_PROGRAM_ID.toBase58()) {
      const text = Buffer.from(ix.data).toString("utf8");
      const parsed = parseAnchorMemo(text);
      if (parsed) {
        return { anchor: parsed, signers };
      }
    }
  }
  return null;
}

async function fetchConfirmedTxWithRetry(
  connection: Connection,
  signature: string,
  maxAttempts: number = 4
): Promise<VersionedTransactionResponse | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (tx) return tx;
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
    }
  }
  return null;
}

/**
 * Independently fetches an L1 root attestation transaction from Solana RPC and
 * verifies:
 * 1. Transaction exists and succeeded (`meta.err === null`).
 * 2. `expectedSigner` signed the transaction.
 * 3. Memo instruction parses to `aegis:merkle:v1:<expectedMerkleRoot>:<expectedLeafCount>`.
 */
export async function verifyAnchorTransactionOnChain(
  l1Connection: Connection,
  anchorSignature: string,
  expectedSigner: string,
  expectedMerkleRoot: string,
  expectedLeafCount: number
): Promise<OnChainAnchorVerification> {
  try {
    const tx = await fetchConfirmedTxWithRetry(l1Connection, anchorSignature);
    if (!tx) {
      return {
        verified: false,
        signature: anchorSignature,
        error: "Anchor transaction not found on Solana L1 RPC.",
      };
    }

    if (tx.meta?.err !== null) {
      return {
        verified: false,
        signature: anchorSignature,
        slot: tx.slot,
        error: `Anchor transaction failed on-chain: ${JSON.stringify(tx.meta?.err)}`,
      };
    }

    const decoded = decodeAnchorMemoFromTransaction(tx);
    if (!decoded) {
      return {
        verified: false,
        signature: anchorSignature,
        slot: tx.slot,
        error: "Anchor transaction does not contain a valid aegis:merkle:v1 memo instruction.",
      };
    }

    const signerVerified = decoded.signers.includes(expectedSigner);
    if (!signerVerified) {
      return {
        verified: false,
        signature: anchorSignature,
        slot: tx.slot,
        onChainRoot: decoded.anchor.merkleRoot,
        onChainLeafCount: decoded.anchor.leafCount,
        signerVerified: false,
        error: `Anchor transaction signer mismatch: expected ${expectedSigner}.`,
      };
    }

    if (decoded.anchor.merkleRoot !== expectedMerkleRoot.toLowerCase()) {
      return {
        verified: false,
        signature: anchorSignature,
        slot: tx.slot,
        onChainRoot: decoded.anchor.merkleRoot,
        onChainLeafCount: decoded.anchor.leafCount,
        signerVerified: true,
        error: `On-chain Merkle root (${decoded.anchor.merkleRoot}) does not match expected root (${expectedMerkleRoot}).`,
      };
    }

    if (decoded.anchor.leafCount !== expectedLeafCount) {
      return {
        verified: false,
        signature: anchorSignature,
        slot: tx.slot,
        onChainRoot: decoded.anchor.merkleRoot,
        onChainLeafCount: decoded.anchor.leafCount,
        signerVerified: true,
        error: `On-chain leaf count (${decoded.anchor.leafCount}) does not match expected count (${expectedLeafCount}).`,
      };
    }

    return {
      verified: true,
      signature: anchorSignature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      onChainRoot: decoded.anchor.merkleRoot,
      onChainLeafCount: decoded.anchor.leafCount,
      signerVerified: true,
    };
  } catch (err) {
    return {
      verified: false,
      signature: anchorSignature,
      error: err instanceof Error ? err.message : "Failed to verify anchor transaction on-chain.",
    };
  }
}

/**
 * Fetches a MagicBlock Private SPL transfer transaction from the ER RPC,
 * decodes its exact on-chain `(sender, recipient, mint, amountBaseUnits, memo)`,
 * and cryptographically proves that those settled on-chain values hash to the
 * exact Merkle leaf committed in the L1-anchored Binary Merkle Sum Tree.
 */
export async function verifyMagicBlockTransferOnChain(
  erConnection: Connection,
  params: {
    signature: string;
    leafIndex: number;
    expectedSender: string;
    expectedCommitmentHash: string;
    saltHex: string;
    runNonce: string;
    merkleProof: MerkleInclusionProof;
    anchoredMerkleRoot: string;
  }
): Promise<OnChainTransferVerification> {
  try {
    const tx = await fetchConfirmedTxWithRetry(erConnection, params.signature);
    if (!tx) {
      return {
        verified: false,
        signature: params.signature,
        leafIndex: params.leafIndex,
        error: `Transfer signature ${params.signature.slice(0, 12)}... not found on MagicBlock ER RPC.`,
      };
    }

    if (tx.meta?.err !== null) {
      return {
        verified: false,
        signature: params.signature,
        leafIndex: params.leafIndex,
        slot: tx.slot,
        error: `Transfer transaction failed on-chain: ${JSON.stringify(tx.meta?.err)}`,
      };
    }

    const decoded = decodeMagicBlockTransferFromTransaction(tx);
    if (!decoded) {
      return {
        verified: false,
        signature: params.signature,
        leafIndex: params.leafIndex,
        slot: tx.slot,
        error: "Transaction does not contain a valid MagicBlock Private SPL transfer instruction (0x10).",
      };
    }

    if (
      decoded.sender !== params.expectedSender ||
      !decoded.signerPubkeys.includes(params.expectedSender)
    ) {
      return {
        verified: false,
        signature: params.signature,
        leafIndex: params.leafIndex,
        slot: tx.slot,
        decoded,
        error: `Transfer sender mismatch: expected signed transfer from ${params.expectedSender}, got ${decoded.sender}.`,
      };
    }

    // Verify leaf commitment strictly from the ON-CHAIN DECODED (recipient, amount, mint).
    // If a buggy/malicious signer paid 300 while claiming 3,800 in the manifest, this hash WILL NOT MATCH.
    const recomputedLeafFromChain = computeLeafCommitment({
      recipient: decoded.recipient,
      amountBaseUnits: decoded.amountBaseUnits,
      tokenMint: decoded.mint,
      settlementRail: "onchain_shielded",
      saltHex: params.saltHex,
      runNonce: params.runNonce,
    });

    if (recomputedLeafFromChain !== params.expectedCommitmentHash) {
      return {
        verified: false,
        signature: params.signature,
        leafIndex: params.leafIndex,
        slot: tx.slot,
        decoded,
        error:
          "Settled on-chain transfer (recipient, amount, mint) does not match the Merkle leaf commitment.",
      };
    }

    if (decoded.amountBaseUnits.toString() !== params.merkleProof.amountBaseUnits) {
      return {
        verified: false,
        signature: params.signature,
        leafIndex: params.leafIndex,
        slot: tx.slot,
        decoded,
        error: `Settled on-chain amount (${decoded.amountBaseUnits.toString()}) !== Merkle proof amount (${params.merkleProof.amountBaseUnits}).`,
      };
    }

    const expectedMemo = `aegis:leaf:${params.expectedCommitmentHash.slice(0, 16)}`;
    if (decoded.memo && decoded.memo !== expectedMemo) {
      return {
        verified: false,
        signature: params.signature,
        leafIndex: params.leafIndex,
        slot: tx.slot,
        decoded,
        error: `Transfer memo (${decoded.memo}) does not match expected leaf tag (${expectedMemo}).`,
      };
    }

    const inclusionOk =
      params.merkleProof.leafIndex === params.leafIndex &&
      params.merkleProof.leafHash === recomputedLeafFromChain &&
      verifyMerkleInclusionProof(params.merkleProof, params.anchoredMerkleRoot);

    if (!inclusionOk) {
      return {
        verified: false,
        signature: params.signature,
        leafIndex: params.leafIndex,
        slot: tx.slot,
        decoded,
        error: "Settled transfer leaf failed Binary Merkle Sum Tree inclusion check against L1-anchored root.",
      };
    }

    return {
      verified: true,
      signature: params.signature,
      leafIndex: params.leafIndex,
      slot: tx.slot,
      decoded,
    };
  } catch (err) {
    return {
      verified: false,
      signature: params.signature,
      leafIndex: params.leafIndex,
      error: err instanceof Error ? err.message : "Failed to verify MagicBlock transfer on-chain.",
    };
  }
}
