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
 * Security invariants enforced:
 * 1. L1 Root Anchoring: every payroll batch anchors `aegis:merkle:v1:<root>:<count>`
 *    on Solana L1. Both `/api/payroll/confirm` and `/api/audit/decrypt` pull that
 *    memo directly off Solana L1 RPC rather than trusting Postgres.
 * 2. Strict Full 64-Hex Leaf Memo & Wire Decoding: every MagicBlock Private SPL
 *    transfer (`SPLxh1LVZz...`, discriminant `0x10`) MUST carry the full 64-hex
 *    leaf commitment (`aegis:leaf:<64-hex>`). Stripping or truncating the memo
 *    fails verification unconditionally. Auditors run wire decoding client-side
 *    after decrypting `e2ee_envelope` so Aegis servers never see salaries or salts.
 * 3. Cross-Batch Completeness (Zero Withheld Batches): `enumerateTreasuryAnchorsOnL1`
 *    scans all `aegis:merkle:v1` memos signed by the org's treasury wallet on L1
 *    within `[validFrom, validUntil]` and reconciles them against delivered batches.
 *    Any anchored-but-undisclosed batch is flagged as a hard audit finding.
 */

export const MAGICBLOCK_EPHEMERAL_SPL_PROGRAM_ID =
  "SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2";

export const MAGICBLOCK_PRIVATE_TRANSFER_DISCRIMINANT = 0x10; // 16

const ANCHOR_MEMO_REGEX = /^aegis:merkle:v1:([0-9a-fA-F]{64}):(\d+)$/;
const LEAF_MEMO_REGEX = /^aegis:leaf:([0-9a-fA-F]{64})$/;

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
  signers?: string[];
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

export interface EnumeratedL1Anchor {
  signature: string;
  slot: number;
  blockTime: number | null;
  blockTimeIso: string | null;
  merkleRoot: string;
  leafCount: number;
  treasuryPubkey: string;
}

export interface AuditorTreasurySetResolution {
  /** Authoritative union of auditor-entered pubkeys and decrypted manifest initiatedBy pubkeys (never server-sourced). */
  enumerationPubkeys: string[];
  auditorEnteredPubkeys: string[];
  manifestPubkeys: string[];
  /** Pubkeys in `enumerationPubkeys` that the server omitted from its advisory `treasury_pubkeys` list. */
  serverOmittedPubkeys: string[];
  /** True when the server's advisory list omitted at least one authoritative treasury wallet. */
  serverListWasStrictSubset: boolean;
}

export interface WalletEnumerationStat {
  treasuryPubkey: string;
  source: "auditor_declared" | "manifest" | "both";
  scannedSignatureCount: number;
  anchorsFound: number;
  truncated: boolean;
}

export interface CrossBatchReconciliation {
  verdictStatus: "complete" | "incomplete" | "not_evaluated" | "no_anchors_in_window";
  treasuryPubkeysChecked: string[];
  perWalletStats: WalletEnumerationStat[];
  zeroActivityDeclaredWallets: string[];
  scannedSignatureCount: number;
  scanTruncated: boolean;
  serverOmittedTreasuryPubkeys: string[];
  serverTreasuryListWasSubset: boolean;
  missingAuditorDeclaredTreasury: boolean;
  totalL1AnchorsInWindow: number;
  deliveredMatchedCount: number;
  undisclosedAnchors: EnumeratedL1Anchor[];
  unanchoredDeliveredRunIds: string[];
  completeZeroOmissions: boolean | null;
}

/**
 * Formats the canonical full 64-hex leaf memo tag required on every MagicBlock
 * Private SPL transfer: `aegis:leaf:<64-char-hex-sha256>`.
 */
export function formatLeafMemo(commitmentHash: string): string {
  const normalized = commitmentHash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Leaf commitmentHash must be a 64-character hex SHA-256 digest.");
  }
  return `aegis:leaf:${normalized}`;
}

/**
 * Parses a canonical full 64-hex leaf memo (`aegis:leaf:<64-hex>`).
 * Returns `null` for missing, truncated (e.g. 16-hex), or malformed memos.
 */
export function parseLeafMemo(memoText: string | undefined): string | null {
  if (!memoText) return null;
  const match = memoText.trim().match(LEAF_MEMO_REGEX);
  if (!match) return null;
  return match[1].toLowerCase();
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
        signers: decoded.signers,
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
        signers: decoded.signers,
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
        signers: decoded.signers,
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
      signers: decoded.signers,
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
 * Pure verification of a decoded MagicBlock Private SPL transfer against a
 * committed Merkle Sum Tree leaf. Enforces:
 * 1. Sender + signer match `expectedSender`.
 * 2. Companion Memo is PRESENT (cannot be stripped!) and equals the FULL 64-hex
 *    leaf commitment (`aegis:leaf:<64-hex>`).
 * 3. Recomputing `computeLeafCommitment` strictly from settled on-chain
 *    `(recipient, amountBaseUnits, mint)` + `saltHex` matches `expectedCommitmentHash`.
 * 4. Settled `amountBaseUnits` matches `merkleProof.amountBaseUnits` and the
 *    O(log N) Merkle Sum Tree proof verifies against `anchoredMerkleRoot`.
 */
export function verifyDecodedMagicBlockTransfer(
  decoded: DecodedMagicBlockTransfer,
  params: {
    signature: string;
    leafIndex: number;
    expectedSender: string;
    expectedCommitmentHash: string;
    saltHex: string;
    runNonce: string;
    merkleProof: MerkleInclusionProof;
    anchoredMerkleRoot: string;
    slot?: number;
  }
): OnChainTransferVerification {
  const expectedHash = params.expectedCommitmentHash.toLowerCase();

  if (
    decoded.sender !== params.expectedSender ||
    !decoded.signerPubkeys.includes(params.expectedSender)
  ) {
    return {
      verified: false,
      signature: params.signature,
      leafIndex: params.leafIndex,
      slot: params.slot,
      decoded,
      error: `Transfer sender mismatch: expected signed transfer from ${params.expectedSender}, got ${decoded.sender}.`,
    };
  }

  // STRICT memo verification: missing OR truncated OR mismatched memo ALWAYS fails!
  const expectedMemo = formatLeafMemo(expectedHash);
  const parsedMemoLeaf = parseLeafMemo(decoded.memo);
  if (!decoded.memo || !parsedMemoLeaf || decoded.memo.trim() !== expectedMemo) {
    return {
      verified: false,
      signature: params.signature,
      leafIndex: params.leafIndex,
      slot: params.slot,
      decoded,
      error: !decoded.memo
        ? `Missing required full 64-hex leaf memo: expected ${expectedMemo}.`
        : `Transfer memo (${decoded.memo}) does not match expected full 64-hex leaf commitment (${expectedMemo}).`,
    };
  }

  // Recompute leaf commitment strictly from the ON-CHAIN DECODED (recipient, amount, mint).
  // Paying 300 while claiming 3,800 (or diverting to another recipient) WILL NOT MATCH.
  const recomputedLeafFromChain = computeLeafCommitment({
    recipient: decoded.recipient,
    amountBaseUnits: decoded.amountBaseUnits,
    tokenMint: decoded.mint,
    settlementRail: "onchain_shielded",
    saltHex: params.saltHex,
    runNonce: params.runNonce,
  });

  if (recomputedLeafFromChain !== expectedHash || parsedMemoLeaf !== recomputedLeafFromChain) {
    return {
      verified: false,
      signature: params.signature,
      leafIndex: params.leafIndex,
      slot: params.slot,
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
      slot: params.slot,
      decoded,
      error: `Settled on-chain amount (${decoded.amountBaseUnits.toString()}) !== Merkle proof amount (${params.merkleProof.amountBaseUnits}).`,
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
      slot: params.slot,
      decoded,
      error:
        "Settled transfer leaf failed Binary Merkle Sum Tree inclusion check against L1-anchored root.",
    };
  }

  return {
    verified: true,
    signature: params.signature,
    leafIndex: params.leafIndex,
    slot: params.slot,
    decoded,
  };
}

/**
 * Fetches a MagicBlock Private SPL transfer transaction from the ER RPC,
 * decodes its exact on-chain `(sender, recipient, mint, amountBaseUnits, memo)`,
 * and cryptographically proves that those settled on-chain values match the
 * full 64-hex leaf memo and L1-anchored Binary Merkle Sum Tree.
 *
 * Executed CLIENT-SIDE by the auditor's browser (and signer self-check) so
 * Aegis servers never receive individual salaries, salts, or ER transfer sigs.
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
        error:
          "Transaction does not contain a valid MagicBlock Private SPL transfer instruction (0x10).",
      };
    }

    return verifyDecodedMagicBlockTransfer(decoded, {
      ...params,
      slot: tx.slot,
    });
  } catch (err) {
    return {
      verified: false,
      signature: params.signature,
      leafIndex: params.leafIndex,
      error:
        err instanceof Error ? err.message : "Failed to verify MagicBlock transfer on-chain.",
    };
  }
}

/**
 * Parses and validates comma/whitespace/newline-separated Solana treasury pubkeys
 * supplied directly by an auditor (e.g. from the client's engagement letter or
 * corporate resolution). Throws on any malformed base58 public key.
 */
export function parseExpectedTreasuryPubkeys(rawInput?: string): string[] {
  if (!rawInput || !rawInput.trim()) return [];
  const tokens = rawInput
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const unique = new Set<string>();
  for (const token of tokens) {
    try {
      unique.add(new PublicKey(token).toBase58());
    } catch {
      throw new Error(
        `Invalid Solana treasury public key supplied by auditor: "${token}".`
      );
    }
  }
  return Array.from(unique);
}

/**
 * Derives the auditor's authoritative Solana L1 treasury enumeration set WITHOUT
 * trusting the server's advisory `data.audit.treasury_pubkeys` list:
 *
 *   enumerationPubkeys = unique(auditorEnteredPubkeys ∪ manifestInitiatedByPubkeys)
 *
 * Also checks whether the server's advisory list omitted any wallet present in
 * `enumerationPubkeys` (i.e. server list was a strict subset / withheld a wallet).
 */
export function resolveAuditorTreasuryEnumerationSet(params: {
  auditorEnteredPubkeys: string[];
  manifestInitiatedByPubkeys: string[];
  serverAdvisoryPubkeys: string[];
}): AuditorTreasurySetResolution {
  const normalizeList = (list: string[]): string[] => {
    const out = new Set<string>();
    for (const raw of list) {
      const trimmed = raw?.trim();
      if (!trimmed) continue;
      try {
        out.add(new PublicKey(trimmed).toBase58());
      } catch {
        // Ignore malformed non-Solana strings from untrusted sources
      }
    }
    return Array.from(out);
  };

  const auditorEnteredPubkeys = normalizeList(params.auditorEnteredPubkeys);
  const manifestPubkeys = normalizeList(params.manifestInitiatedByPubkeys);
  const serverSet = new Set(normalizeList(params.serverAdvisoryPubkeys));

  const enumerationSet = new Set<string>([
    ...auditorEnteredPubkeys,
    ...manifestPubkeys,
  ]);
  const enumerationPubkeys = Array.from(enumerationSet);

  const serverOmittedPubkeys = enumerationPubkeys.filter(
    (pk) => !serverSet.has(pk)
  );

  return {
    enumerationPubkeys,
    auditorEnteredPubkeys,
    manifestPubkeys,
    serverOmittedPubkeys,
    serverListWasStrictSubset: serverOmittedPubkeys.length > 0,
  };
}

/**
 * Enumerates EVERY `aegis:merkle:v1:<root>:<count>` memo signed by `treasuryPubkey`
 * on Solana L1 within `[validFromIso, validUntilIso]`.
 *
 * Paginates across `getSignaturesForAddress` (up to Solana's 1,000-sig page size)
 * until reaching `validFromIso`, account genesis, or `maxSignatures`.
 *
 * Honesty invariant: if the scan hits `maxSignatures` before passing `validFromIso`
 * or reaching end-of-history, returns `truncated: true` so callers NEVER claim
 * `completeZeroOmissions: true` on a partial scan.
 */
export async function enumerateTreasuryAnchorsOnL1(
  l1Connection: Connection,
  treasuryPubkey: string,
  options?: {
    validFromIso?: string;
    validUntilIso?: string;
    maxSignatures?: number;
    pageLimit?: number;
  }
): Promise<{
  treasuryPubkey: string;
  scannedSignatureCount: number;
  maxSignatures: number;
  truncated: boolean;
  anchors: EnumeratedL1Anchor[];
}> {
  const pubkey = new PublicKey(treasuryPubkey);
  const validFromSec = options?.validFromIso
    ? Math.floor(new Date(options.validFromIso).getTime() / 1000)
    : 0;
  const validUntilSec = options?.validUntilIso
    ? Math.ceil(new Date(options.validUntilIso).getTime() / 1000)
    : Number.MAX_SAFE_INTEGER;
  const maxSignatures = options?.maxSignatures ?? 5000;
  const pageLimit = Math.min(1000, Math.max(1, options?.pageLimit ?? 1000));

  const candidateSigs: Array<{ signature: string; slot: number; blockTime: number | null }> = [];
  let before: string | undefined;
  let scannedSignatureCount = 0;
  let reachedEndOfWindow = false;

  while (scannedSignatureCount < maxSignatures) {
    const batchLimit = Math.min(pageLimit, maxSignatures - scannedSignatureCount);
    const sigInfos = await l1Connection.getSignaturesForAddress(pubkey, {
      limit: batchLimit,
      before,
    });

    if (sigInfos.length === 0) {
      reachedEndOfWindow = true;
      break;
    }
    scannedSignatureCount += sigInfos.length;

    let passedLowerBound = false;
    for (const info of sigInfos) {
      const bt = info.blockTime ?? null;
      if (bt !== null && bt < validFromSec) {
        passedLowerBound = true;
        break;
      }
      if (info.err !== null) continue;
      if (bt !== null && bt > validUntilSec) {
        continue;
      }
      // Fast pre-filter when RPC returns inline memo summary, otherwise inspect tx
      if (info.memo && !info.memo.includes("aegis:merkle:v1:")) {
        continue;
      }
      candidateSigs.push({
        signature: info.signature,
        slot: info.slot,
        blockTime: bt,
      });
    }

    if (passedLowerBound || sigInfos.length < batchLimit) {
      reachedEndOfWindow = true;
      break;
    }
    before = sigInfos[sigInfos.length - 1].signature;
  }

  const truncated = !reachedEndOfWindow;

  const anchors: EnumeratedL1Anchor[] = [];
  for (const cand of candidateSigs) {
    const tx = await l1Connection.getTransaction(cand.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx || tx.meta?.err !== null) continue;

    const decoded = decodeAnchorMemoFromTransaction(tx);
    if (!decoded) continue;
    if (!decoded.signers.includes(treasuryPubkey)) continue;

    const blockTime = tx.blockTime ?? cand.blockTime ?? null;
    anchors.push({
      signature: cand.signature,
      slot: tx.slot,
      blockTime,
      blockTimeIso: blockTime ? new Date(blockTime * 1000).toISOString() : null,
      merkleRoot: decoded.anchor.merkleRoot,
      leafCount: decoded.anchor.leafCount,
      treasuryPubkey,
    });
  }

  return {
    treasuryPubkey,
    scannedSignatureCount,
    maxSignatures,
    truncated,
    anchors,
  };
}

/**
 * Reconciles every Solana L1 `aegis:merkle:v1` anchor signed by the treasury
 * during the audit window against the batches delivered to the auditor.
 *
 * Forces `completeZeroOmissions = false` if ANY of the following holds:
 * 1. One or more L1 anchors were withheld from disclosure (`undisclosedAnchors`).
 * 2. One or more delivered runs lacked a verified L1 anchor (`unanchoredDeliveredRunIds`).
 * 3. L1 signature scanning hit its cap before reaching `validFromIso` (`scanTruncated`).
 * 4. The server's advisory treasury list omitted an authoritative treasury wallet
 *    (`serverOmittedTreasuryPubkeys.length > 0`).
 * 5. `requireAuditorDeclaredTreasury` is enabled and the auditor did not supply
 *    at least one out-of-band treasury wallet (`missingAuditorDeclaredTreasury` -> `not_evaluated`).
 * 6. An auditor-declared treasury wallet returned `0` lifetime signatures on L1
 *    (`zeroActivityDeclaredWallets.length > 0` -> likely typo or wrong cluster).
 * 7. Zero L1 anchors were found across the audit window (`totalL1AnchorsInWindow === 0`
 *    -> neutral `no_anchors_in_window` state with `completeZeroOmissions: null`, never vacuous green).
 */
export function reconcileAuditedBatchesAgainstL1(
  l1Anchors: EnumeratedL1Anchor[],
  deliveredBatches: Array<{
    payroll_run_id: string;
    anchor_tx_signature: string | null;
    merkle_root: string;
    anchor_verified: boolean;
  }>,
  meta?: {
    treasuryPubkeysChecked?: string[];
    perWalletStats?: WalletEnumerationStat[];
    scannedSignatureCount?: number;
    scanTruncated?: boolean;
    serverOmittedTreasuryPubkeys?: string[];
    requireAuditorDeclaredTreasury?: boolean;
    auditorDeclaredTreasuryPubkeys?: string[];
  }
): CrossBatchReconciliation {
  const deliveredAnchorKeys = new Set<string>();
  const unanchoredDeliveredRunIds: string[] = [];

  for (const batch of deliveredBatches) {
    if (!batch.anchor_verified || !batch.anchor_tx_signature || !batch.merkle_root) {
      unanchoredDeliveredRunIds.push(batch.payroll_run_id);
      continue;
    }
    deliveredAnchorKeys.add(
      `${batch.anchor_tx_signature}:${batch.merkle_root.toLowerCase()}`
    );
  }

  // Deduplicate L1 anchors by signature:root in case multiple treasury pubkeys were checked
  const uniqueL1Anchors = new Map<string, EnumeratedL1Anchor>();
  for (const anchor of l1Anchors) {
    const key = `${anchor.signature}:${anchor.merkleRoot.toLowerCase()}`;
    if (!uniqueL1Anchors.has(key)) {
      uniqueL1Anchors.set(key, anchor);
    }
  }

  const undisclosedAnchors: EnumeratedL1Anchor[] = [];
  let deliveredMatchedCount = 0;

  for (const [key, anchor] of uniqueL1Anchors.entries()) {
    if (deliveredAnchorKeys.has(key)) {
      deliveredMatchedCount += 1;
    } else {
      undisclosedAnchors.push(anchor);
    }
  }

  const scanTruncated = Boolean(meta?.scanTruncated);
  const serverOmittedTreasuryPubkeys = meta?.serverOmittedTreasuryPubkeys ?? [];
  const serverTreasuryListWasSubset = serverOmittedTreasuryPubkeys.length > 0;
  const perWalletStats = meta?.perWalletStats ?? [];
  const zeroActivityDeclaredWallets = perWalletStats
    .filter(
      (w) =>
        (w.source === "auditor_declared" || w.source === "both") &&
        w.scannedSignatureCount === 0
    )
    .map((w) => w.treasuryPubkey);
  const missingAuditorDeclaredTreasury = Boolean(
    meta?.requireAuditorDeclaredTreasury &&
      (!meta?.auditorDeclaredTreasuryPubkeys ||
        meta.auditorDeclaredTreasuryPubkeys.length === 0)
  );

  // Hard rule: with no auditor-declared treasury wallet, refuse to emit ANY
  // whole-org zero-omission verdict or anchor count (per-batch view only).
  if (missingAuditorDeclaredTreasury) {
    return {
      verdictStatus: "not_evaluated",
      treasuryPubkeysChecked: [],
      perWalletStats: [],
      zeroActivityDeclaredWallets: [],
      scannedSignatureCount: 0,
      scanTruncated: false,
      serverOmittedTreasuryPubkeys: [],
      serverTreasuryListWasSubset: false,
      missingAuditorDeclaredTreasury: true,
      totalL1AnchorsInWindow: 0,
      deliveredMatchedCount: 0,
      undisclosedAnchors: [],
      unanchoredDeliveredRunIds,
      completeZeroOmissions: null,
    };
  }

  const hasFinding =
    scanTruncated ||
    serverTreasuryListWasSubset ||
    zeroActivityDeclaredWallets.length > 0 ||
    undisclosedAnchors.length > 0 ||
    unanchoredDeliveredRunIds.length > 0;

  const treasuryPubkeysChecked =
    meta?.treasuryPubkeysChecked ??
    Array.from(new Set(l1Anchors.map((a) => a.treasuryPubkey)));
  const scannedSignatureCount = meta?.scannedSignatureCount ?? l1Anchors.length;

  if (hasFinding) {
    return {
      verdictStatus: "incomplete",
      treasuryPubkeysChecked,
      perWalletStats,
      zeroActivityDeclaredWallets,
      scannedSignatureCount,
      scanTruncated,
      serverOmittedTreasuryPubkeys,
      serverTreasuryListWasSubset,
      missingAuditorDeclaredTreasury: false,
      totalL1AnchorsInWindow: uniqueL1Anchors.size,
      deliveredMatchedCount,
      undisclosedAnchors,
      unanchoredDeliveredRunIds,
      completeZeroOmissions: false,
    };
  }

  // Vacuous-green guard: 0 anchors in window is neutral (nothing to reconcile), never green.
  if (uniqueL1Anchors.size === 0) {
    return {
      verdictStatus: "no_anchors_in_window",
      treasuryPubkeysChecked,
      perWalletStats,
      zeroActivityDeclaredWallets: [],
      scannedSignatureCount,
      scanTruncated: false,
      serverOmittedTreasuryPubkeys: [],
      serverTreasuryListWasSubset: false,
      missingAuditorDeclaredTreasury: false,
      totalL1AnchorsInWindow: 0,
      deliveredMatchedCount: 0,
      undisclosedAnchors: [],
      unanchoredDeliveredRunIds: [],
      completeZeroOmissions: null,
    };
  }

  return {
    verdictStatus: "complete",
    treasuryPubkeysChecked,
    perWalletStats,
    zeroActivityDeclaredWallets: [],
    scannedSignatureCount,
    scanTruncated: false,
    serverOmittedTreasuryPubkeys: [],
    serverTreasuryListWasSubset: false,
    missingAuditorDeclaredTreasury: false,
    totalL1AnchorsInWindow: uniqueL1Anchors.size,
    deliveredMatchedCount,
    undisclosedAnchors: [],
    unanchoredDeliveredRunIds: [],
    completeZeroOmissions: true,
  };
}
