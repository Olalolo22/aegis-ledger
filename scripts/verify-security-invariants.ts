import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  buildBatchMerkleTree,
  verifyBatchCompleteness,
  verifyMerkleInclusionProof,
  generateNoteSalt,
  type MerkleLeafInput,
} from "../src/lib/merkle";
import {
  buildManifestAad,
  buildViewingKeyScopeAad,
  decryptBatchManifest,
  decryptViewingKey,
  deriveJwtSigningKey,
  deriveOrgAuditKey,
  encryptBatchManifest,
  encryptViewingKey,
} from "../src/lib/crypto";
import { computeMagicBlockSplitPlan } from "../src/lib/denominate";
import {
  DEVNET_USDC_MINT,
  MAGICBLOCK_CLUSTER,
  buildMagicBlockSplDeposit,
  buildMagicBlockSplTransfer,
  checkMagicBlockHealth,
  deserializeMagicBlockTx,
  planPrivatePayrollBatch,
  queryMagicBlockSplBalance,
} from "../src/lib/magicblock";

async function run() {
  // Set deterministic test master secret for crypto verification
  process.env.AEGIS_MASTER_SECRET = randomBytes(32).toString("hex");

  console.log("1. Testing Binary SHA-256 Merkle Sum Tree (inclusion + completeness)...");
  for (const size of [1, 2, 3, 5, 8]) {
    const runNonce = randomUUID();
    const entries: MerkleLeafInput[] = Array.from({ length: size }, (_, i) => ({
      recipient: Keypair.generate().publicKey.toBase58(),
      amountBaseUnits: BigInt((i + 1) * 1_250_000_000),
      tokenMint: DEVNET_USDC_MINT.toBase58(),
      settlementRail: i % 2 === 0 ? "onchain_shielded" : "ngn_bank",
      saltHex: generateNoteSalt(),
      runNonce,
    }));

    const tree = buildBatchMerkleTree(entries);
    assert.equal(tree.leafCount, size);
    const expectedSum = entries.reduce((acc, e) => acc + BigInt(e.amountBaseUnits), 0n);
    assert.equal(tree.totalSum, expectedSum);

    // Every leaf's O(log N) inclusion proof must verify
    for (let i = 0; i < size; i++) {
      const proof = tree.getProof(i);
      assert.equal(verifyMerkleInclusionProof(proof, tree.root), true, `Proof ${i}/${size} must verify`);

      // Tampering with amount by 1 base unit must fail proof verification
      const tamperedAmount = {
        ...proof,
        amountBaseUnits: (BigInt(proof.amountBaseUnits) + 1n).toString(),
      };
      assert.equal(verifyMerkleInclusionProof(tamperedAmount, tree.root), false, "Tampered amount must fail");

      // Negative sibling sum forgery must be rejected
      if (proof.siblings.length > 0) {
        const negativeSibling = {
          ...proof,
          siblings: [
            { ...proof.siblings[0], sum: "-100" },
            ...proof.siblings.slice(1),
          ],
        };
        assert.equal(verifyMerkleInclusionProof(negativeSibling, tree.root), false, "Negative sibling sum must fail");
      }
    }

    // Full completeness check passes on exact set
    const fullCheck = verifyBatchCompleteness(entries, tree.root, expectedSum, size);
    assert.equal(fullCheck.valid, true, "Full completeness must pass");

    // Omitting a single recipient must FAIL completeness
    if (size > 1) {
      const omitted = entries.slice(0, size - 1);
      const omittedCheck = verifyBatchCompleteness(omitted, tree.root, expectedSum, size);
      assert.equal(omittedCheck.valid, false, "Omitting 1 recipient must fail completeness");
    }

    // Editing a single recipient amount by 1 base unit must FAIL completeness
    const modified = entries.map((e, idx) =>
      idx === 0 ? { ...e, amountBaseUnits: BigInt(e.amountBaseUnits) + 1n } : e
    );
    const modifiedCheck = verifyBatchCompleteness(modified, tree.root, expectedSum, size);
    assert.equal(modifiedCheck.valid, false, "Altering 1 base unit must fail completeness");
  }
  console.log("   ✓ Binary Merkle Sum Tree verified across sizes 1, 2, 3, 5, 8 (tamper & omission rejected).");

  console.log("2. Testing HKDF + AES-256-GCM viewing keys, scope AAD, and manifest encryption...");
  const orgId = randomUUID();
  const keyId = randomUUID();
  const runId = randomUUID();
  const orgAuditKey = deriveOrgAuditKey(orgId);
  const jwtKey = deriveJwtSigningKey();
  assert.notEqual(
    Buffer.from(jwtKey).toString("hex"),
    process.env.AEGIS_MASTER_SECRET,
    "JWT signing key must be domain-separated from master secret"
  );

  const scopeAad = buildViewingKeyScopeAad({
    orgId,
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2026-12-31T23:59:59.000Z",
    allowedTokens: ["USDC", "SOL"],
  });

  const wrappedVk = encryptViewingKey(orgAuditKey, keyId, scopeAad);
  const unwrappedKey = decryptViewingKey(wrappedVk, keyId, scopeAad);
  assert.equal(unwrappedKey.equals(orgAuditKey), true, "Unwrapped orgAuditKey must match original");

  // Mutating allowed_tokens or valid_until in AAD MUST fail GCM auth
  const tamperedScopeAad = buildViewingKeyScopeAad({
    orgId,
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-12-31T23:59:59.000Z",
    allowedTokens: ["USDC", "SOL"],
  });
  assert.throws(
    () => decryptViewingKey(wrappedVk, keyId, tamperedScopeAad),
    "Altered temporal scope AAD must fail GCM authentication"
  );

  // Encrypt & decrypt real batch manifest with unwrapped auditor key
  const recipients = [
    {
      wallet: Keypair.generate().publicKey.toBase58(),
      amountLamports: 3_800_000_000n,
      token: "USDC" as const,
      settlementRail: "onchain_shielded" as const,
    },
    {
      wallet: Keypair.generate().publicKey.toBase58(),
      amountLamports: 2_600_000_000n,
      token: "USDC" as const,
      settlementRail: "kes_mpesa" as const,
      destinationAccount: "+254712901844",
    },
  ];
  const plan = planPrivatePayrollBatch(recipients, DEVNET_USDC_MINT.toBase58(), runId);
  const manifestAad = buildManifestAad({
    orgId,
    payrollRunId: runId,
    merkleRoot: plan.merkleTree.root,
    tokenSymbol: "USDC",
  });
  const manifestJson = JSON.stringify({
    version: 1,
    payrollRunId: runId,
    merkleRoot: plan.merkleTree.root,
    entries: plan.manifestEntries,
  });

  const ciphertext = encryptBatchManifest(manifestJson, orgAuditKey, runId, manifestAad);
  const decryptedJson = decryptBatchManifest(ciphertext, unwrappedKey, runId, manifestAad);
  const parsedManifest = JSON.parse(decryptedJson);
  const auditCompleteness = verifyBatchCompleteness(
    parsedManifest.entries,
    plan.merkleTree.root,
    plan.merkleTree.totalSum,
    plan.merkleTree.leafCount
  );
  assert.equal(auditCompleteness.valid, true, "Decrypted manifest must pass Merkle Sum Tree completeness");

  // Tampering with merkleRoot in manifest AAD must fail decryption
  const wrongRootAad = buildManifestAad({
    orgId,
    payrollRunId: runId,
    merkleRoot: "0".repeat(64),
    tokenSymbol: "USDC",
  });
  assert.throws(
    () => decryptBatchManifest(ciphertext, unwrappedKey, runId, wrongRootAad),
    "Manifest decryption with mismatched Merkle root AAD must fail"
  );
  console.log("   ✓ Scope AAD, manifest encryption/decryption, and auditor completeness verified.");

  console.log("3. Testing MagicBlock Private SPL split planner & live devnet-private API...");
  assert.equal(computeMagicBlockSplitPlan(5_000_000n, 6).split, 1);
  assert.equal(computeMagicBlockSplitPlan(500_000_000n, 6).split, 2);
  assert.equal(computeMagicBlockSplitPlan(3_800_000_000n, 6).split, 3);
  assert.equal(computeMagicBlockSplitPlan(10_000_000_000n, 6).split, 4);

  const health = await checkMagicBlockHealth();
  assert.equal(health.status, "ok", "MagicBlock API health should be ok");

  const sender = Keypair.generate().publicKey.toBase58();
  const recipient = Keypair.generate().publicKey.toBase58();
  const bal = await queryMagicBlockSplBalance(sender, DEVNET_USDC_MINT.toBase58(), MAGICBLOCK_CLUSTER);
  assert.equal(bal.address, sender);

  const depResp = await buildMagicBlockSplDeposit(sender, 10_000_000n, DEVNET_USDC_MINT.toBase58(), MAGICBLOCK_CLUSTER);
  assert.equal(depResp.kind, "deposit");
  const depTx = deserializeMagicBlockTx(depResp);
  assert.ok(depTx instanceof Transaction || depTx instanceof VersionedTransaction);

  const splitPlan = computeMagicBlockSplitPlan(3_800_000_000n, 6);
  const xferResp = await buildMagicBlockSplTransfer({
    from: sender,
    to: recipient,
    amount: 5_000_000n,
    mint: DEVNET_USDC_MINT.toBase58(),
    fromBalance: "ephemeral",
    toBalance: "base",
    split: splitPlan.split,
    minDelayMs: splitPlan.minDelayMs,
    maxDelayMs: splitPlan.maxDelayMs,
    memo: `aegis:leaf:${plan.merkleTree.leaves[0].slice(0, 16)}`,
    cluster: MAGICBLOCK_CLUSTER,
  });
  assert.equal(xferResp.kind, "transfer");
  assert.equal(xferResp.sendTo, "ephemeral");
  assert.ok(xferResp.sendRpcEndpoint?.includes("magicblock.app"));
  const xferTx = deserializeMagicBlockTx(xferResp);
  assert.ok(xferTx instanceof Transaction || xferTx instanceof VersionedTransaction);

  console.log("   ✓ Live MagicBlock Private SPL API (deposit + private ephemeral transfer + deserialize) verified.");
  console.log("\nALL SECURITY & EXECUTION INVARIANTS PASSED ✓");
}

run().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
