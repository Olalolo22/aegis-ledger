import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  buildBatchMerkleTree,
  computeLeafCommitment,
  verifyBatchCompleteness,
  verifyMerkleInclusionProof,
  generateNoteSalt,
  type MerkleLeafInput,
} from "../src/lib/merkle";
import {
  buildViewingKeyScopeAad,
  decryptViewingKey,
  deriveJwtSigningKey,
  encryptViewingKey,
} from "../src/lib/crypto";
import {
  buildEnvelopeAad,
  decryptManifestClientSide,
  encryptManifestClientSide,
  generateAuditKeyPair,
  reWrapDekForAuditor,
} from "../src/lib/e2ee";
import { computeMagicBlockSplitPlan } from "../src/lib/denominate";
import {
  DEVNET_USDC_MINT,
  MAGICBLOCK_CLUSTER,
  buildBatchRootAttestationTx,
  buildMagicBlockSplDeposit,
  buildMagicBlockSplTransfer,
  checkMagicBlockHealth,
  deserializeMagicBlockTx,
  planPrivatePayrollBatch,
  queryMagicBlockSplBalance,
} from "../src/lib/magicblock";
import {
  MAGICBLOCK_EPHEMERAL_SPL_PROGRAM_ID,
  MAGICBLOCK_PRIVATE_TRANSFER_DISCRIMINANT,
  decodeAnchorMemoFromTransaction,
  decodeMagicBlockTransferFromTransaction,
} from "../src/lib/onchainVerify";
import { computeFiatPayoutFromQuote, fetchLiveFxQuote } from "../src/lib/fx";
import { SandboxOfframpProvider } from "../src/lib/offramp/sandbox";

async function run() {
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
    const expectedSum = entries.reduce((acc, e) => acc + BigInt(e.amountBaseUnits), 0n);
    assert.equal(tree.leafCount, size);
    assert.equal(tree.totalSum, expectedSum);

    for (let i = 0; i < size; i++) {
      const proof = tree.getProof(i);
      assert.equal(verifyMerkleInclusionProof(proof, tree.root), true);
      assert.equal(
        verifyMerkleInclusionProof(
          { ...proof, amountBaseUnits: (BigInt(proof.amountBaseUnits) + 1n).toString() },
          tree.root
        ),
        false
      );
      if (proof.siblings.length > 0) {
        assert.equal(
          verifyMerkleInclusionProof(
            {
              ...proof,
              siblings: [{ ...proof.siblings[0], sum: "-100" }, ...proof.siblings.slice(1)],
            },
            tree.root
          ),
          false
        );
      }
    }

    assert.equal(verifyBatchCompleteness(entries, tree.root, expectedSum, size).valid, true);
    if (size > 1) {
      assert.equal(
        verifyBatchCompleteness(entries.slice(0, size - 1), tree.root, expectedSum, size).valid,
        false
      );
    }
    const modified = entries.map((e, idx) =>
      idx === 0 ? { ...e, amountBaseUnits: BigInt(e.amountBaseUnits) + 1n } : e
    );
    assert.equal(verifyBatchCompleteness(modified, tree.root, expectedSum, size).valid, false);
  }
  console.log("   ✓ Binary Merkle Sum Tree verified across sizes 1, 2, 3, 5, 8.");

  console.log("2. Testing Zero-Knowledge Client-Side E2EE Audit Envelopes (Option B)...");
  const orgId = randomUUID();
  const runId = randomUUID();
  const keyId = randomUUID();

  // Verify GCM scope AAD tamper rejection + domain-separated JWT key
  const jwtKey = deriveJwtSigningKey();
  assert.notEqual(Buffer.from(jwtKey).toString("hex"), process.env.AEGIS_MASTER_SECRET);
  const scopeAad = buildViewingKeyScopeAad({
    orgId,
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2026-12-31T23:59:59.000Z",
    allowedTokens: ["USDC", "SOL"],
  });
  const sealedScope = encryptViewingKey(Buffer.from("scope-attestation"), keyId, scopeAad);
  assert.equal(decryptViewingKey(sealedScope, keyId, scopeAad).toString(), "scope-attestation");
  assert.throws(() =>
    decryptViewingKey(
      sealedScope,
      keyId,
      buildViewingKeyScopeAad({
        orgId,
        validFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2028-01-01T00:00:00.000Z",
        allowedTokens: ["USDC", "SOL"],
      })
    )
  );

  // Client-side org & auditor RSA-OAEP-256 keypairs (server never sees private keys)
  const orgKeys = await generateAuditKeyPair();
  const auditorKeys = await generateAuditKeyPair();
  const attackerServerKeys = await generateAuditKeyPair();

  const recipientA = Keypair.generate().publicKey.toBase58();
  const recipientB = Keypair.generate().publicKey.toBase58();
  const plan = planPrivatePayrollBatch(
    [
      {
        wallet: recipientA,
        amountLamports: 3_800_000_000n,
        token: "USDC",
        settlementRail: "onchain_shielded",
      },
      {
        wallet: recipientB,
        amountLamports: 2_600_000_000n,
        token: "USDC",
        settlementRail: "kes_mpesa",
        destinationAccount: "+254712901844",
      },
    ],
    DEVNET_USDC_MINT.toBase58(),
    runId
  );

  const manifestJson = JSON.stringify({
    version: 2,
    payrollRunId: runId,
    orgId,
    merkleRoot: plan.merkleTree.root,
    entries: plan.manifestEntries,
  });

  const { envelope } = await encryptManifestClientSide(
    manifestJson,
    orgKeys.publicKeySpkiBase64,
    {
      orgId,
      payrollRunId: runId,
      merkleRoot: plan.merkleTree.root,
      tokenSymbol: "USDC",
    }
  );

  // Org decrypts locally
  const orgPlaintext = await decryptManifestClientSide(envelope, orgKeys.privateKeyPkcs8Base64);
  assert.equal(orgPlaintext, manifestJson);

  // Compromised server / attacker CANNOT decrypt E2EE envelope
  await assert.rejects(
    () => decryptManifestClientSide(envelope, attackerServerKeys.privateKeyPkcs8Base64),
    "Server/attacker key must NOT decrypt customer payroll envelope"
  );

  // Org re-wraps DEK strictly client-side for authorized auditor
  const auditorWrappedDek = await reWrapDekForAuditor(
    envelope.orgWrappedDek,
    orgKeys.privateKeyPkcs8Base64,
    auditorKeys.publicKeySpkiBase64
  );

  const expectedAad = buildEnvelopeAad({
    orgId,
    payrollRunId: runId,
    merkleRoot: plan.merkleTree.root,
    tokenSymbol: "USDC",
  });

  const auditorPlaintext = await decryptManifestClientSide(
    envelope,
    auditorKeys.privateKeyPkcs8Base64,
    { wrappedDekBase64: auditorWrappedDek, expectedAad }
  );
  const parsedManifest = JSON.parse(auditorPlaintext);
  assert.equal(
    verifyBatchCompleteness(
      parsedManifest.entries,
      plan.merkleTree.root,
      plan.merkleTree.totalSum,
      plan.merkleTree.leafCount
    ).valid,
    true
  );

  // Mismatched L1-anchored root AAD must be rejected before decryption
  await assert.rejects(() =>
    decryptManifestClientSide(envelope, auditorKeys.privateKeyPkcs8Base64, {
      wrappedDekBase64: auditorWrappedDek,
      expectedAad: buildEnvelopeAad({
        orgId,
        payrollRunId: runId,
        merkleRoot: "0".repeat(64),
        tokenSymbol: "USDC",
      }),
    })
  );
  console.log("   ✓ Client-side RSA-OAEP-256 + AES-256-GCM E2EE, re-wrapping, and attacker rejection verified.");

  console.log("3. Testing Solana L1 Root Anchor & MagicBlock Private SPL Wire Decoder...");
  const payer = Keypair.generate();
  const anchorTx = buildBatchRootAttestationTx(
    payer.publicKey,
    plan.merkleTree.root,
    plan.merkleTree.leafCount,
    "11111111111111111111111111111111"
  );
  const decodedAnchor = decodeAnchorMemoFromTransaction(anchorTx);
  assert.ok(decodedAnchor, "L1 anchor memo must decode");
  assert.equal(decodedAnchor.anchor.merkleRoot, plan.merkleTree.root);
  assert.equal(decodedAnchor.anchor.leafCount, plan.merkleTree.leafCount);
  assert.ok(decodedAnchor.signers.includes(payer.publicKey.toBase58()));

  // Live MagicBlock Private SPL API + Wire Decoder + Settlement-to-Leaf Binding
  const health = await checkMagicBlockHealth();
  assert.equal(health.status, "ok");

  const bal = await queryMagicBlockSplBalance(
    payer.publicKey.toBase58(),
    DEVNET_USDC_MINT.toBase58(),
    MAGICBLOCK_CLUSTER
  );
  assert.equal(bal.address, payer.publicKey.toBase58());

  const depResp = await buildMagicBlockSplDeposit(
    payer.publicKey.toBase58(),
    10_000_000n,
    DEVNET_USDC_MINT.toBase58(),
    MAGICBLOCK_CLUSTER
  );
  const depTx = deserializeMagicBlockTx(depResp);
  assert.ok(depTx instanceof Transaction || depTx instanceof VersionedTransaction);

  const onChainEntry = plan.manifestEntries[0];
  const splitPlan = computeMagicBlockSplitPlan(BigInt(onChainEntry.amountBaseUnits), 6);
  const xferResp = await buildMagicBlockSplTransfer({
    from: payer.publicKey.toBase58(),
    to: onChainEntry.recipient,
    amount: BigInt(onChainEntry.amountBaseUnits),
    mint: onChainEntry.tokenMint,
    fromBalance: "ephemeral",
    toBalance: "base",
    split: splitPlan.split,
    minDelayMs: splitPlan.minDelayMs,
    maxDelayMs: splitPlan.maxDelayMs,
    memo: `aegis:leaf:${onChainEntry.commitmentHash.slice(0, 16)}`,
    cluster: MAGICBLOCK_CLUSTER,
  });
  const xferTx = deserializeMagicBlockTx(xferResp);
  const decodedXfer = decodeMagicBlockTransferFromTransaction(xferTx);
  assert.ok(decodedXfer, "MagicBlock Private SPL transfer must decode");
  assert.equal(decodedXfer.programId, MAGICBLOCK_EPHEMERAL_SPL_PROGRAM_ID);
  assert.equal(decodedXfer.discriminant, MAGICBLOCK_PRIVATE_TRANSFER_DISCRIMINANT);
  assert.equal(decodedXfer.sender, payer.publicKey.toBase58());
  assert.equal(decodedXfer.recipient, onChainEntry.recipient);
  assert.equal(decodedXfer.mint, onChainEntry.tokenMint);
  assert.equal(decodedXfer.amountBaseUnits, BigInt(onChainEntry.amountBaseUnits));
  assert.equal(decodedXfer.split, splitPlan.split);
  assert.equal(decodedXfer.memo, `aegis:leaf:${onChainEntry.commitmentHash.slice(0, 16)}`);

  // Recompute leaf strictly from ON-CHAIN DECODED transfer fields -> must match committed leaf
  const leafFromChain = computeLeafCommitment({
    recipient: decodedXfer.recipient,
    amountBaseUnits: decodedXfer.amountBaseUnits,
    tokenMint: decodedXfer.mint,
    settlementRail: "onchain_shielded",
    saltHex: onChainEntry.saltHex,
    runNonce: runId,
  });
  assert.equal(leafFromChain, onChainEntry.commitmentHash);

  // Buggy signer paying 300 USDC while manifest claims 3,800 USDC MUST fail leaf match!
  const underpaidResp = await buildMagicBlockSplTransfer({
    from: payer.publicKey.toBase58(),
    to: onChainEntry.recipient,
    amount: 300_000_000n, // 300 USDC instead of 3,800 USDC!
    mint: onChainEntry.tokenMint,
    fromBalance: "ephemeral",
    toBalance: "base",
    split: 2,
    minDelayMs: "500",
    maxDelayMs: "1500",
    memo: `aegis:leaf:${onChainEntry.commitmentHash.slice(0, 16)}`,
    cluster: MAGICBLOCK_CLUSTER,
  });
  const decodedUnderpaid = decodeMagicBlockTransferFromTransaction(
    deserializeMagicBlockTx(underpaidResp)
  );
  assert.ok(decodedUnderpaid);
  const underpaidLeaf = computeLeafCommitment({
    recipient: decodedUnderpaid.recipient,
    amountBaseUnits: decodedUnderpaid.amountBaseUnits,
    tokenMint: decodedUnderpaid.mint,
    settlementRail: "onchain_shielded",
    saltHex: onChainEntry.saltHex,
    runNonce: runId,
  });
  assert.notEqual(
    underpaidLeaf,
    onChainEntry.commitmentHash,
    "Underpaid transfer (300 vs 3,800) MUST fail Merkle leaf binding"
  );
  console.log("   ✓ L1 anchor decoder, live MagicBlock wire decoder, and underpayment rejection verified.");

  console.log("4. Testing Live Server-Side FX Quoting & Receipt Stamping...");
  const liveQuote = await fetchLiveFxQuote({ bypassCache: true });
  assert.ok(liveQuote.quoteId.startsWith("fx_"));
  assert.ok(liveQuote.rates.NGN > 0 && liveQuote.rates.KES > 0);
  const ngnPayout = computeFiatPayoutFromQuote(3800, "NGN", liveQuote);
  const kesPayout = computeFiatPayoutFromQuote(2600, "KES", liveQuote);
  assert.equal(ngnPayout.amountLocal, Math.round(3800 * liveQuote.rates.NGN * 100) / 100);
  assert.equal(kesPayout.amountLocal, Math.round(2600 * liveQuote.rates.KES * 100) / 100);

  const sandbox = new SandboxOfframpProvider();
  const receipt = await sandbox.disburse(
    {
      recipientId: recipientB,
      wallet: recipientB,
      amountUsd: kesPayout.amountUsd,
      amountLocal: kesPayout.amountLocal,
      currency: "KES",
      rail: "kes_mpesa",
      destinationAccount: "+254712901844",
      noteCommitment: plan.manifestEntries[1].commitmentHash,
      exchangeRate: kesPayout.exchangeRate,
      fxProvider: kesPayout.fxProvider,
      fxQuotedAt: kesPayout.fxQuotedAt,
      fxQuoteId: kesPayout.quoteId,
    },
    plan.merkleTree.root
  );
  assert.equal(receipt.exchangeRate, liveQuote.rates.KES);
  assert.equal(receipt.fxProvider, liveQuote.provider);
  assert.equal(receipt.fxQuoteId, liveQuote.quoteId);
  assert.ok(receipt.fxQuotedAt);
  console.log(
    `   ✓ Live server FX quote verified (${liveQuote.provider}: NGN=${liveQuote.rates.NGN}, KES=${liveQuote.rates.KES}, quoteId=${liveQuote.quoteId}).`
  );

  console.log("\nALL PASS 2 SECURITY, SETTLEMENT, E2EE & FX INVARIANTS PASSED ✓");
}

run().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
