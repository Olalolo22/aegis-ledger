import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

/**
 * Domain-separated Binary SHA-256 Merkle Sum Tree for Aegis payroll batches.
 *
 * Why a Merkle Sum Tree instead of a flat hash:
 * 1. Per-note inclusion proofs: any recipient or auditor can verify a single
 *    payout leaf against the anchored batch root in O(log N) hashes.
 * 2. Completeness & conservation: every internal node commits to BOTH its
 *    children's hashes AND their cumulative (sum, count). An auditor decrypting
 *    a batch manifest can prove that no recipient was omitted or altered —
 *    dropping or editing even a single entry changes the root, count, and sum.
 * 3. No leaf-duplication malleability: odd tree levels are padded with a
 *    canonical domain-separated empty node (sum = 0, count = 0).
 */

const LEAF_DOMAIN = "aegis:leaf:v1";
const NODE_DOMAIN = "aegis:node:v1";
const ROOT_DOMAIN = "aegis:root:v1";
const EMPTY_DOMAIN = "aegis:empty:v1";

const encoder = new TextEncoder();

function sha256Hex(payload: string): string {
  return bytesToHex(sha256(encoder.encode(payload)));
}

export const EMPTY_NODE_HASH = sha256Hex(EMPTY_DOMAIN);

export interface MerkleLeafInput {
  /** Recipient Solana wallet pubkey (base58) */
  recipient: string;
  /** Amount in token base units (non-negative integer bigint or decimal string) */
  amountBaseUnits: bigint | string;
  /** SPL token mint address (base58) */
  tokenMint: string;
  /** Settlement rail for this recipient */
  settlementRail: "onchain_shielded" | "ngn_bank" | "kes_mpesa";
  /** Per-recipient random 16-byte hex salt (blinds leaf commitment from brute-force) */
  saltHex: string;
  /** Payroll run ID / batch nonce binding the commitment to a single run */
  runNonce: string;
}

export interface MerkleProofSibling {
  hash: string;
  sum: string;
  count: number;
  position: "left" | "right";
}

export interface MerkleInclusionProof {
  leafIndex: number;
  leafHash: string;
  amountBaseUnits: string;
  siblings: MerkleProofSibling[];
  root: string;
  totalSum: string;
  leafCount: number;
}

interface TreeNode {
  hash: string;
  sum: bigint;
  count: number;
}

export interface BatchMerkleTree {
  /** Domain-separated root committing to all leaves, totalSum, and leafCount */
  root: string;
  /** Aggregate sum across all leaves in token base units */
  totalSum: bigint;
  /** Total number of recipient leaves in this batch */
  leafCount: number;
  /** Ordered leaf commitment hashes */
  leaves: string[];
  /** Per-leaf O(log N) inclusion proofs indexed by leafIndex */
  proofs: MerkleInclusionProof[];
  /** Retrieve the inclusion proof for a specific leaf index */
  getProof: (index: number) => MerkleInclusionProof;
}

export interface BatchCompletenessResult {
  valid: boolean;
  computedRoot: string;
  totalSum: string;
  leafCount: number;
  errors: string[];
}

/**
 * Generates a cryptographically secure 16-byte hex salt (works in both Node & browser).
 */
export function generateNoteSalt(): string {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }
  throw new Error("Cryptographically secure random source (crypto.getRandomValues) is unavailable.");
}

/**
 * Computes a domain-separated SHA-256 leaf commitment for a single recipient note.
 * Formula: SHA256("aegis:leaf:v1" | recipient | amountBaseUnits | tokenMint | settlementRail | saltHex | runNonce)
 */
export function computeLeafCommitment(input: MerkleLeafInput): string {
  const amount = typeof input.amountBaseUnits === "bigint"
    ? input.amountBaseUnits
    : BigInt(input.amountBaseUnits);

  if (amount <= 0n) {
    throw new Error("Leaf amountBaseUnits must be a positive integer.");
  }
  if (!input.saltHex || input.saltHex.length < 16) {
    throw new Error("Leaf saltHex must be at least 16 hex characters.");
  }

  return sha256Hex(
    `${LEAF_DOMAIN}:${input.recipient}:${amount.toString()}:${input.tokenMint}:${input.settlementRail}:${input.saltHex}:${input.runNonce}`
  );
}

function hashInternalNode(left: TreeNode, right: TreeNode): TreeNode {
  const sum = left.sum + right.sum;
  const count = left.count + right.count;
  const hash = sha256Hex(
    `${NODE_DOMAIN}:${left.hash}:${left.sum.toString()}:${left.count}:${right.hash}:${right.sum.toString()}:${right.count}`
  );
  return { hash, sum, count };
}

function finalizeRoot(top: TreeNode): string {
  return sha256Hex(
    `${ROOT_DOMAIN}:${top.hash}:${top.sum.toString()}:${top.count}`
  );
}

const EMPTY_NODE: TreeNode = {
  hash: EMPTY_NODE_HASH,
  sum: 0n,
  count: 0,
};

/**
 * Builds a complete Binary SHA-256 Merkle Sum Tree from ordered leaf inputs.
 */
export function buildBatchMerkleTree(inputs: MerkleLeafInput[]): BatchMerkleTree {
  if (inputs.length === 0) {
    throw new Error("Cannot build a Merkle tree from an empty recipient list.");
  }

  const leafNodes: TreeNode[] = inputs.map((input) => {
    const amount = typeof input.amountBaseUnits === "bigint"
      ? input.amountBaseUnits
      : BigInt(input.amountBaseUnits);
    const hash = computeLeafCommitment(input);
    return { hash, sum: amount, count: 1 };
  });

  // Store every tree level (levels[0] = leaves, levels[last] = [topNode])
  const levels: TreeNode[][] = [leafNodes];
  let currentLevel = leafNodes;

  while (currentLevel.length > 1) {
    const nextLevel: TreeNode[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : EMPTY_NODE;
      nextLevel.push(hashInternalNode(left, right));
    }
    levels.push(nextLevel);
    currentLevel = nextLevel;
  }

  const topNode = currentLevel[0];
  const root = finalizeRoot(topNode);
  const leaves = leafNodes.map((n) => n.hash);

  const proofs: MerkleInclusionProof[] = leafNodes.map((leaf, leafIndex) => {
    const siblings: MerkleProofSibling[] = [];
    let idx = leafIndex;

    for (let level = 0; level < levels.length - 1; level++) {
      const levelNodes = levels[level];
      const isRightNode = idx % 2 === 1;
      const siblingIdx = isRightNode ? idx - 1 : idx + 1;
      const siblingNode = siblingIdx < levelNodes.length ? levelNodes[siblingIdx] : EMPTY_NODE;

      siblings.push({
        hash: siblingNode.hash,
        sum: siblingNode.sum.toString(),
        count: siblingNode.count,
        position: isRightNode ? "left" : "right",
      });

      idx = Math.floor(idx / 2);
    }

    return {
      leafIndex,
      leafHash: leaf.hash,
      amountBaseUnits: leaf.sum.toString(),
      siblings,
      root,
      totalSum: topNode.sum.toString(),
      leafCount: topNode.count,
    };
  });

  return {
    root,
    totalSum: topNode.sum,
    leafCount: topNode.count,
    leaves,
    proofs,
    getProof(index: number): MerkleInclusionProof {
      if (index < 0 || index >= proofs.length) {
        throw new RangeError(`Leaf index ${index} out of bounds [0, ${proofs.length - 1}].`);
      }
      return proofs[index];
    },
  };
}

/**
 * Verifies a single recipient's O(log N) Merkle Sum Tree inclusion proof
 * against an anchored batch root.
 */
export function verifyMerkleInclusionProof(
  proof: MerkleInclusionProof,
  expectedRoot?: string
): boolean {
  try {
    const leafAmount = BigInt(proof.amountBaseUnits);
    const expectedTotalSum = BigInt(proof.totalSum);
    if (leafAmount <= 0n || expectedTotalSum <= 0n || proof.leafCount <= 0) {
      return false;
    }

    let current: TreeNode = {
      hash: proof.leafHash,
      sum: leafAmount,
      count: 1,
    };

    for (const sibling of proof.siblings) {
      const sibSum = BigInt(sibling.sum);
      if (sibSum < 0n || sibling.count < 0) {
        return false;
      }
      const sibNode: TreeNode = {
        hash: sibling.hash,
        sum: sibSum,
        count: sibling.count,
      };
      current = sibling.position === "left"
        ? hashInternalNode(sibNode, current)
        : hashInternalNode(current, sibNode);
    }

    const computedRoot = finalizeRoot(current);
    const targetRoot = expectedRoot ?? proof.root;

    return (
      computedRoot === targetRoot &&
      computedRoot === proof.root &&
      current.sum === expectedTotalSum &&
      current.count === proof.leafCount
    );
  } catch {
    return false;
  }
}

/**
 * Verifies FULL batch completeness for an auditor:
 * Rebuilds the entire Merkle Sum Tree from decrypted manifest entries and checks
 * that no recipient was omitted, duplicated, or modified relative to the
 * anchored root, total amount, and recipient count.
 */
export function verifyBatchCompleteness(
  entries: Array<MerkleLeafInput & { commitmentHash?: string }>,
  anchoredRoot: string,
  expectedTotalSum?: bigint | string,
  expectedLeafCount?: number
): BatchCompletenessResult {
  const errors: string[] = [];

  if (entries.length === 0) {
    return {
      valid: false,
      computedRoot: "",
      totalSum: "0",
      leafCount: 0,
      errors: ["Manifest contains zero entries."],
    };
  }

  let tree: BatchMerkleTree;
  try {
    tree = buildBatchMerkleTree(entries);
  } catch (err) {
    return {
      valid: false,
      computedRoot: "",
      totalSum: "0",
      leafCount: entries.length,
      errors: [err instanceof Error ? err.message : "Failed to reconstruct Merkle tree."],
    };
  }

  entries.forEach((entry, idx) => {
    if (entry.commitmentHash && entry.commitmentHash !== tree.leaves[idx]) {
      errors.push(`Leaf ${idx} commitment mismatch.`);
    }
  });

  if (tree.root !== anchoredRoot) {
    errors.push(`Merkle root mismatch: computed ${tree.root} !== anchored ${anchoredRoot}.`);
  }

  if (expectedTotalSum !== undefined) {
    const targetSum = typeof expectedTotalSum === "bigint"
      ? expectedTotalSum
      : BigInt(expectedTotalSum);
    if (tree.totalSum !== targetSum) {
      errors.push(`Total sum mismatch: computed ${tree.totalSum.toString()} !== expected ${targetSum.toString()}.`);
    }
  }

  if (expectedLeafCount !== undefined && tree.leafCount !== expectedLeafCount) {
    errors.push(`Leaf count mismatch: computed ${tree.leafCount} !== expected ${expectedLeafCount}.`);
  }

  return {
    valid: errors.length === 0,
    computedRoot: tree.root,
    totalSum: tree.totalSum.toString(),
    leafCount: tree.leafCount,
    errors,
  };
}
