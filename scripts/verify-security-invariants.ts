import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { SignJWT } from "jose";
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
  buildSessionLoginMessage,
  buildVaultActionMessage,
  deriveAdminSessionJwtKey,
  generateAuthNonce,
  mintOrgAdminSessionToken,
  verifyAndConsumeChallengeWithStore,
  verifyOrgAdminSessionToken,
  verifySolanaWalletSignature,
  type WalletChallengeRecord,
  type WalletChallengeStore,
} from "../src/lib/auth";
import {
  buildEnvelopeAad,
  decryptManifestClientSide,
  decryptPrivateKeyWithPassphrase,
  encryptManifestClientSide,
  encryptPrivateKeyWithPassphrase,
  generateAuditKeyPair,
  parseRecoveryKit,
  reWrapDekForAuditor,
  reWrapDekForNewAdmin,
  resolveAdminWrappedDek,
  serializeRecoveryKit,
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
  enumerateTreasuryAnchorsOnL1,
  formatLeafMemo,
  parseExpectedTreasuryPubkeys,
  parseLeafMemo,
  reconcileAuditedBatchesAgainstL1,
  resolveAuditorTreasuryEnumerationSet,
  verifyDecodedMagicBlockTransfer,
  type EnumeratedL1Anchor,
} from "../src/lib/onchainVerify";
import { isDemoTokenAllowed } from "../src/hooks/useAuditorEngine";
import {
  FxSanityCheckError,
  computeFiatPayoutFromQuote,
  fetchLiveFxQuote,
  validatePartnerAppliedRate,
} from "../src/lib/fx";
import { SandboxOfframpProvider } from "../src/lib/offramp/sandbox";
import {
  generateKeyRequestSchema,
  payrollConfirmSchema,
  payrollRequestSchema,
  registerOrgKeyVaultSchema,
  rotateOrgKeyVaultSchema,
  swapQuoteRequestSchema,
} from "../src/lib/validation";

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

  console.log("2. Testing Blind-Server .strict() Schemas (Zero Salaries/Salts/Proofs & Zero Caller org_id)...");
  const orgId = randomUUID();
  const runId = randomUUID();
  const keyId = randomUUID();
  const payer = Keypair.generate();
  const fakeAnchorSig = "5".repeat(88);

  // POST /api/payroll MUST REJECT plaintext recipients[] AND caller-supplied org_id
  const badInitWithRecipients = payrollRequestSchema.safeParse({
    token_symbol: "USDC",
    token_mint: DEVNET_USDC_MINT.toBase58(),
    initiated_by: payer.publicKey.toBase58(),
    recipient_count: 2,
    total_amount_base_units: "6400000000",
    recipients: [{ wallet: payer.publicKey.toBase58(), amount: "3800000000" }],
  });
  assert.equal(badInitWithRecipients.success, false, "POST /api/payroll MUST reject plaintext recipients[]");

  const badInitWithOrgId = payrollRequestSchema.safeParse({
    org_id: orgId,
    token_symbol: "USDC",
    token_mint: DEVNET_USDC_MINT.toBase58(),
    initiated_by: payer.publicKey.toBase58(),
    recipient_count: 2,
    total_amount_base_units: "6400000000",
  });
  assert.equal(badInitWithOrgId.success, false, "POST /api/payroll MUST reject caller-supplied org_id");

  const goodInit = payrollRequestSchema.safeParse({
    token_symbol: "USDC",
    token_mint: DEVNET_USDC_MINT.toBase58(),
    initiated_by: payer.publicKey.toBase58(),
    recipient_count: 2,
    total_amount_base_units: "6400000000",
    onchain_total_base_units: "3800000000",
    rail: "tee",
  });
  assert.equal(goodInit.success, true, "Blind session-scoped /api/payroll payload must pass");

  // Prepare E2EE envelope & multi-admin key vaults
  const primaryAdminKeys = await generateAuditKeyPair();
  const backupAdminKeys = await generateAuditKeyPair();
  const replacementAdminKeys = await generateAuditKeyPair();
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
    initiatedBy: payer.publicKey.toBase58(),
    merkleRoot: plan.merkleTree.root,
    entries: plan.manifestEntries,
  });

  const { envelope } = await encryptManifestClientSide(
    manifestJson,
    [primaryAdminKeys.publicKeySpkiBase64, backupAdminKeys.publicKeySpkiBase64],
    {
      orgId,
      payrollRunId: runId,
      merkleRoot: plan.merkleTree.root,
      tokenSymbol: "USDC",
    }
  );

  // POST /api/payroll/confirm MUST REJECT leaf_proofs (amountBaseUnits) & onchain_settlements (saltHex)
  const badConfirmWithProofs = payrollConfirmSchema.safeParse({
    payroll_run_id: runId,
    anchor_tx_signature: fakeAnchorSig,
    commitment_hashes: plan.merkleTree.leaves,
    merkle_root: plan.merkleTree.root,
    leaf_proofs: plan.merkleTree.proofs,
    e2ee_envelope: envelope,
  });
  assert.equal(badConfirmWithProofs.success, false, "POST /api/payroll/confirm MUST reject leaf_proofs/amountBaseUnits");

  const badConfirmWithSalts = payrollConfirmSchema.safeParse({
    payroll_run_id: runId,
    anchor_tx_signature: fakeAnchorSig,
    commitment_hashes: plan.merkleTree.leaves,
    merkle_root: plan.merkleTree.root,
    onchain_settlements: [{ leafIndex: 0, signature: fakeAnchorSig, saltHex: plan.manifestEntries[0].saltHex }],
    e2ee_envelope: envelope,
  });
  assert.equal(badConfirmWithSalts.success, false, "POST /api/payroll/confirm MUST reject onchain_settlements/saltHex");

  const goodBlindConfirm = payrollConfirmSchema.safeParse({
    payroll_run_id: runId,
    anchor_tx_signature: fakeAnchorSig,
    deposit_tx_signatures: [],
    commitment_hashes: plan.merkleTree.leaves,
    merkle_root: plan.merkleTree.root,
    e2ee_envelope: envelope,
  });
  assert.equal(goodBlindConfirm.success, true, "Blind /api/payroll/confirm payload must pass");
  console.log("   ✓ Blind-server .strict() schemas rejected recipients[], leaf_proofs, and saltHex.");

  console.log("3. Testing Passphrase-Encrypted Multi-Admin Key Vault, Rotation & E2EE Audits...");
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

  // Weak passphrase rejected
  await assert.rejects(() =>
    encryptPrivateKeyWithPassphrase(primaryAdminKeys, "short", {
      orgId,
      adminLabel: "CFO",
      role: "primary",
    })
  );

  // Passphrase-encrypted key vault + Recovery Kit export/restore
  const vaultPassphrase = "correct-horse-battery-staple-aegis-2026";
  const encryptedVault = await encryptPrivateKeyWithPassphrase(
    primaryAdminKeys,
    vaultPassphrase,
    { orgId, adminLabel: "Primary Finance Admin", role: "primary", iterations: 120_000 }
  );
  const recoveryJson = serializeRecoveryKit(encryptedVault);
  const parsedVault = parseRecoveryKit(recoveryJson);
  const restoredPrimary = await decryptPrivateKeyWithPassphrase(parsedVault, vaultPassphrase);
  assert.equal(restoredPrimary.privateKeyPkcs8Base64, primaryAdminKeys.privateKeyPkcs8Base64);

  // Wrong passphrase or tampered vault AAD MUST fail
  await assert.rejects(() =>
    decryptPrivateKeyWithPassphrase(parsedVault, "wrong-passphrase-123456")
  );
  await assert.rejects(() =>
    decryptPrivateKeyWithPassphrase(
      { ...parsedVault, role: "backup_controller" },
      vaultPassphrase
    )
  );

  // Multi-admin: BOTH Primary Admin AND Backup Controller decrypt the same batch envelope
  const primaryPlaintext = await decryptManifestClientSide(
    envelope,
    primaryAdminKeys.privateKeyPkcs8Base64,
    { adminFingerprint: primaryAdminKeys.fingerprint }
  );
  const backupPlaintext = await decryptManifestClientSide(
    envelope,
    backupAdminKeys.privateKeyPkcs8Base64,
    { adminFingerprint: backupAdminKeys.fingerprint }
  );
  assert.equal(primaryPlaintext, manifestJson);
  assert.equal(backupPlaintext, manifestJson);

  // Admin offboarding rotation: Backup Controller re-wraps historical DEK to Replacement Admin
  const backupWrappedDek = resolveAdminWrappedDek(envelope, backupAdminKeys.fingerprint);
  assert.ok(backupWrappedDek);
  const replacementWrappedDek = await reWrapDekForNewAdmin(
    backupWrappedDek,
    backupAdminKeys.privateKeyPkcs8Base64,
    replacementAdminKeys.publicKeySpkiBase64
  );
  const replacementPlaintext = await decryptManifestClientSide(
    envelope,
    replacementAdminKeys.privateKeyPkcs8Base64,
    { wrappedDekBase64: replacementWrappedDek }
  );
  assert.equal(replacementPlaintext, manifestJson);

  // Compromised server / attacker CANNOT decrypt E2EE envelope
  await assert.rejects(
    () => decryptManifestClientSide(envelope, attackerServerKeys.privateKeyPkcs8Base64),
    "Server/attacker key must NOT decrypt customer payroll envelope"
  );

  // Org re-wraps DEK strictly client-side for authorized auditor
  const auditorWrappedDek = await reWrapDekForAuditor(
    backupWrappedDek,
    backupAdminKeys.privateKeyPkcs8Base64,
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
  assert.equal(
    verifyBatchCompleteness(
      JSON.parse(auditorPlaintext).entries,
      plan.merkleTree.root,
      plan.merkleTree.totalSum,
      plan.merkleTree.leafCount
    ).valid,
    true
  );
  console.log("   ✓ Passphrase vault, Recovery Kit, 2-admin DEK wrapping, rotation, and E2EE audits verified.");

  console.log("4. Testing Full 64-Hex Leaf Memo, Missing-Memo Rejection & Live MagicBlock Wire Decoder...");
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
  const fullLeafMemo = formatLeafMemo(onChainEntry.commitmentHash);
  assert.equal(fullLeafMemo.length, 75); // "aegis:leaf:" (11) + 64 hex
  assert.equal(parseLeafMemo(fullLeafMemo), onChainEntry.commitmentHash);
  assert.equal(parseLeafMemo(`aegis:leaf:${onChainEntry.commitmentHash.slice(0, 16)}`), null);

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
    memo: fullLeafMemo,
    cluster: MAGICBLOCK_CLUSTER,
  });
  const xferTx = deserializeMagicBlockTx(xferResp);
  const decodedXfer = decodeMagicBlockTransferFromTransaction(xferTx);
  assert.ok(decodedXfer, "MagicBlock Private SPL transfer must decode");
  assert.equal(decodedXfer.programId, MAGICBLOCK_EPHEMERAL_SPL_PROGRAM_ID);
  assert.equal(decodedXfer.discriminant, MAGICBLOCK_PRIVATE_TRANSFER_DISCRIMINANT);
  assert.equal(decodedXfer.memo, fullLeafMemo);

  // Full valid check passes
  const validTransferRes = verifyDecodedMagicBlockTransfer(decodedXfer, {
    signature: fakeAnchorSig,
    leafIndex: 0,
    expectedSender: payer.publicKey.toBase58(),
    expectedCommitmentHash: onChainEntry.commitmentHash,
    saltHex: onChainEntry.saltHex,
    runNonce: runId,
    merkleProof: onChainEntry.merkleProof,
    anchoredMerkleRoot: plan.merkleTree.root,
  });
  assert.equal(validTransferRes.verified, true);

  // Stripping the memo MUST FAIL (closes missing-memo bypass!)
  const strippedMemoRes = verifyDecodedMagicBlockTransfer(
    { ...decodedXfer, memo: undefined },
    {
      signature: fakeAnchorSig,
      leafIndex: 0,
      expectedSender: payer.publicKey.toBase58(),
      expectedCommitmentHash: onChainEntry.commitmentHash,
      saltHex: onChainEntry.saltHex,
      runNonce: runId,
      merkleProof: onChainEntry.merkleProof,
      anchoredMerkleRoot: plan.merkleTree.root,
    }
  );
  assert.equal(strippedMemoRes.verified, false, "Stripped memo MUST fail verification");

  // Truncated 16-hex memo MUST FAIL
  const truncatedMemoRes = verifyDecodedMagicBlockTransfer(
    { ...decodedXfer, memo: `aegis:leaf:${onChainEntry.commitmentHash.slice(0, 16)}` },
    {
      signature: fakeAnchorSig,
      leafIndex: 0,
      expectedSender: payer.publicKey.toBase58(),
      expectedCommitmentHash: onChainEntry.commitmentHash,
      saltHex: onChainEntry.saltHex,
      runNonce: runId,
      merkleProof: onChainEntry.merkleProof,
      anchoredMerkleRoot: plan.merkleTree.root,
    }
  );
  assert.equal(truncatedMemoRes.verified, false, "16-hex truncated memo MUST fail verification");

  // Underpayment (300 USDC vs 3,800 USDC) with valid full 64-hex memo MUST FAIL
  const underpaidResp = await buildMagicBlockSplTransfer({
    from: payer.publicKey.toBase58(),
    to: onChainEntry.recipient,
    amount: 300_000_000n,
    mint: onChainEntry.tokenMint,
    fromBalance: "ephemeral",
    toBalance: "base",
    split: 2,
    minDelayMs: "500",
    maxDelayMs: "1500",
    memo: fullLeafMemo,
    cluster: MAGICBLOCK_CLUSTER,
  });
  const decodedUnderpaid = decodeMagicBlockTransferFromTransaction(
    deserializeMagicBlockTx(underpaidResp)
  );
  assert.ok(decodedUnderpaid);
  const underpaidCheck = verifyDecodedMagicBlockTransfer(decodedUnderpaid, {
    signature: fakeAnchorSig,
    leafIndex: 0,
    expectedSender: payer.publicKey.toBase58(),
    expectedCommitmentHash: onChainEntry.commitmentHash,
    saltHex: onChainEntry.saltHex,
    runNonce: runId,
    merkleProof: onChainEntry.merkleProof,
    anchoredMerkleRoot: plan.merkleTree.root,
  });
  assert.equal(underpaidCheck.verified, false, "Underpaid transfer (300 vs 3,800) MUST fail");
  console.log("   ✓ Full 64-hex leaf memo, stripped/truncated rejection, and 300-vs-3,800 rejection verified.");

  console.log("5. Testing Cross-Batch Solana L1 Completeness Reconciliation ('Nothing Withheld')...");
  const l1Anchors: EnumeratedL1Anchor[] = [
    {
      signature: "A".repeat(88),
      slot: 1001,
      blockTime: 1760000000,
      blockTimeIso: new Date(1760000000 * 1000).toISOString(),
      merkleRoot: "a".repeat(64),
      leafCount: 4,
      treasuryPubkey: payer.publicKey.toBase58(),
    },
    {
      signature: "B".repeat(88),
      slot: 1002,
      blockTime: 1760086400,
      blockTimeIso: new Date(1760086400 * 1000).toISOString(),
      merkleRoot: "b".repeat(64),
      leafCount: 6,
      treasuryPubkey: payer.publicKey.toBase58(),
    },
    {
      signature: "C".repeat(88),
      slot: 1003,
      blockTime: 1760172800,
      blockTimeIso: new Date(1760172800 * 1000).toISOString(),
      merkleRoot: "c".repeat(64),
      leafCount: 2,
      treasuryPubkey: payer.publicKey.toBase58(),
    },
  ];

  const completeRecon = reconcileAuditedBatchesAgainstL1(l1Anchors, [
    { payroll_run_id: "run-1", anchor_tx_signature: "A".repeat(88), merkle_root: "a".repeat(64), anchor_verified: true },
    { payroll_run_id: "run-2", anchor_tx_signature: "B".repeat(88), merkle_root: "b".repeat(64), anchor_verified: true },
    { payroll_run_id: "run-3", anchor_tx_signature: "C".repeat(88), merkle_root: "c".repeat(64), anchor_verified: true },
  ]);
  assert.equal(completeRecon.completeZeroOmissions, true);
  assert.equal(completeRecon.undisclosedAnchors.length, 0);
  assert.equal(completeRecon.deliveredMatchedCount, 3);

  // Withhold batch C -> reconciliation MUST surface C as an undisclosed finding!
  const withheldRecon = reconcileAuditedBatchesAgainstL1(l1Anchors, [
    { payroll_run_id: "run-1", anchor_tx_signature: "A".repeat(88), merkle_root: "a".repeat(64), anchor_verified: true },
    { payroll_run_id: "run-2", anchor_tx_signature: "B".repeat(88), merkle_root: "b".repeat(64), anchor_verified: true },
  ]);
  assert.equal(withheldRecon.completeZeroOmissions, false);
  assert.equal(withheldRecon.undisclosedAnchors.length, 1);
  assert.equal(withheldRecon.undisclosedAnchors[0].signature, "C".repeat(88));
  assert.equal(withheldRecon.undisclosedAnchors[0].merkleRoot, "c".repeat(64));

  // Zero-trust treasury enumeration set: derived strictly from manifests + auditor input (NEVER server-trusted)
  const hiddenTreasury = Keypair.generate().publicKey.toBase58();
  const parsedAuditorWallets = parseExpectedTreasuryPubkeys(
    `${hiddenTreasury}, ${payer.publicKey.toBase58()}`
  );
  assert.deepEqual(parsedAuditorWallets, [hiddenTreasury, payer.publicKey.toBase58()]);
  assert.throws(
    () => parseExpectedTreasuryPubkeys("not-a-valid-solana-pubkey"),
    /Invalid Solana treasury public key/
  );

  // Server omits `hiddenTreasury` from its advisory list -> MUST flag strict subset!
  const subsetResolution = resolveAuditorTreasuryEnumerationSet({
    auditorEnteredPubkeys: [hiddenTreasury],
    manifestInitiatedByPubkeys: [payer.publicKey.toBase58()],
    serverAdvisoryPubkeys: [payer.publicKey.toBase58()],
  });
  assert.equal(subsetResolution.serverListWasStrictSubset, true);
  assert.deepEqual(subsetResolution.serverOmittedPubkeys, [hiddenTreasury]);
  assert.equal(subsetResolution.enumerationPubkeys.includes(hiddenTreasury), true);
  assert.equal(subsetResolution.enumerationPubkeys.includes(payer.publicKey.toBase58()), true);

  // Even if all seen anchors matched, server-omitted wallet MUST force completeZeroOmissions = false
  const omittedWalletRecon = reconcileAuditedBatchesAgainstL1(
    l1Anchors,
    [
      { payroll_run_id: "run-1", anchor_tx_signature: "A".repeat(88), merkle_root: "a".repeat(64), anchor_verified: true },
      { payroll_run_id: "run-2", anchor_tx_signature: "B".repeat(88), merkle_root: "b".repeat(64), anchor_verified: true },
      { payroll_run_id: "run-3", anchor_tx_signature: "C".repeat(88), merkle_root: "c".repeat(64), anchor_verified: true },
    ],
    {
      treasuryPubkeysChecked: subsetResolution.enumerationPubkeys,
      scannedSignatureCount: 42,
      scanTruncated: false,
      serverOmittedTreasuryPubkeys: subsetResolution.serverOmittedPubkeys,
    }
  );
  assert.equal(omittedWalletRecon.serverTreasuryListWasSubset, true);
  assert.equal(omittedWalletRecon.completeZeroOmissions, false);

  // Truncated L1 scan MUST force completeZeroOmissions = false & preserve scannedSignatureCount
  const truncatedRecon = reconcileAuditedBatchesAgainstL1(
    l1Anchors,
    [
      { payroll_run_id: "run-1", anchor_tx_signature: "A".repeat(88), merkle_root: "a".repeat(64), anchor_verified: true },
      { payroll_run_id: "run-2", anchor_tx_signature: "B".repeat(88), merkle_root: "b".repeat(64), anchor_verified: true },
      { payroll_run_id: "run-3", anchor_tx_signature: "C".repeat(88), merkle_root: "c".repeat(64), anchor_verified: true },
    ],
    {
      treasuryPubkeysChecked: [payer.publicKey.toBase58()],
      scannedSignatureCount: 5000,
      scanTruncated: true,
    }
  );
  assert.equal(truncatedRecon.scanTruncated, true);
  assert.equal(truncatedRecon.scannedSignatureCount, 5000);
  assert.equal(truncatedRecon.completeZeroOmissions, false);

  // Requiring auditor-declared treasury wallet MUST refuse whole-org verdict when blank
  const unevaluatedRecon = reconcileAuditedBatchesAgainstL1(
    l1Anchors,
    [
      { payroll_run_id: "run-1", anchor_tx_signature: "A".repeat(88), merkle_root: "a".repeat(64), anchor_verified: true },
      { payroll_run_id: "run-2", anchor_tx_signature: "B".repeat(88), merkle_root: "b".repeat(64), anchor_verified: true },
      { payroll_run_id: "run-3", anchor_tx_signature: "C".repeat(88), merkle_root: "c".repeat(64), anchor_verified: true },
    ],
    {
      treasuryPubkeysChecked: [payer.publicKey.toBase58()],
      scannedSignatureCount: 15,
      scanTruncated: false,
      requireAuditorDeclaredTreasury: true,
      auditorDeclaredTreasuryPubkeys: [],
    }
  );
  assert.equal(unevaluatedRecon.verdictStatus, "not_evaluated");
  assert.equal(unevaluatedRecon.missingAuditorDeclaredTreasury, true);
  assert.equal(
    unevaluatedRecon.completeZeroOmissions,
    null,
    "Missing auditor-declared treasury wallet MUST refuse whole-org verdict (null)"
  );
  assert.equal(unevaluatedRecon.deliveredMatchedCount, 0);
  assert.equal(unevaluatedRecon.totalL1AnchorsInWindow, 0);

  const declaredScopeRecon = reconcileAuditedBatchesAgainstL1(
    l1Anchors,
    [
      { payroll_run_id: "run-1", anchor_tx_signature: "A".repeat(88), merkle_root: "a".repeat(64), anchor_verified: true },
      { payroll_run_id: "run-2", anchor_tx_signature: "B".repeat(88), merkle_root: "b".repeat(64), anchor_verified: true },
      { payroll_run_id: "run-3", anchor_tx_signature: "C".repeat(88), merkle_root: "c".repeat(64), anchor_verified: true },
    ],
    {
      treasuryPubkeysChecked: [payer.publicKey.toBase58()],
      scannedSignatureCount: 15,
      scanTruncated: false,
      requireAuditorDeclaredTreasury: true,
      auditorDeclaredTreasuryPubkeys: [payer.publicKey.toBase58()],
    }
  );
  assert.equal(declaredScopeRecon.verdictStatus, "complete");
  assert.equal(declaredScopeRecon.missingAuditorDeclaredTreasury, false);
  assert.equal(declaredScopeRecon.completeZeroOmissions, true);

  // Direct test of enumerateTreasuryAnchorsOnL1 pagination + truncation detection
  const mockSigHistory = [
    { signature: "sig-5", slot: 500, err: null, blockTime: 1760500000, memo: "unrelated" },
    { signature: "sig-4", slot: 400, err: null, blockTime: 1760400000, memo: "unrelated" },
    { signature: "sig-3", slot: 300, err: null, blockTime: 1760300000, memo: "unrelated" },
    { signature: "sig-2", slot: 200, err: null, blockTime: 1760200000, memo: "unrelated" },
    { signature: "sig-1", slot: 100, err: null, blockTime: 1759000000, memo: "unrelated" }, // older than validFromSec
  ];
  const mockL1Conn = {
    async getSignaturesForAddress(_pubkey: unknown, opts?: { limit?: number; before?: string }) {
      const startIdx = opts?.before
        ? mockSigHistory.findIndex((s) => s.signature === opts.before) + 1
        : 0;
      return mockSigHistory.slice(startIdx, startIdx + (opts?.limit ?? 1000));
    },
    async getTransaction() {
      return null;
    },
  };
  const truncatedEnum = await enumerateTreasuryAnchorsOnL1(
    mockL1Conn as never,
    payer.publicKey.toBase58(),
    {
      validFromIso: new Date(1760000000 * 1000).toISOString(),
      validUntilIso: new Date(1761000000 * 1000).toISOString(),
      maxSignatures: 2,
      pageLimit: 2,
    }
  );
  assert.equal(truncatedEnum.scannedSignatureCount, 2);
  assert.equal(truncatedEnum.truncated, true, "Hitting maxSignatures before validFrom MUST set truncated: true");

  const fullPaginatedEnum = await enumerateTreasuryAnchorsOnL1(
    mockL1Conn as never,
    payer.publicKey.toBase58(),
    {
      validFromIso: new Date(1760000000 * 1000).toISOString(),
      validUntilIso: new Date(1761000000 * 1000).toISOString(),
      maxSignatures: 10,
      pageLimit: 2,
    }
  );
  assert.equal(fullPaginatedEnum.scannedSignatureCount, 5);
  assert.equal(fullPaginatedEnum.truncated, false, "Paginating past validFromSec MUST set truncated: false");

  // Demo mode MUST be disabled by default in production
  assert.equal(
    isDemoTokenAllowed("demo-token", undefined),
    false,
    "demo-token MUST be rejected when NEXT_PUBLIC_ENABLE_DEMO_MODE is unset"
  );
  assert.equal(
    isDemoTokenAllowed("demo-token", "false"),
    false,
    "demo-token MUST be rejected when NEXT_PUBLIC_ENABLE_DEMO_MODE is false"
  );
  assert.equal(
    isDemoTokenAllowed("demo-token", "true"),
    true,
    "demo-token is only allowed when NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true'"
  );
  console.log(
    "   ✓ Cross-batch L1 completeness, zero-trust treasury set, pagination/truncation honesty, and demo-mode build gate verified."
  );

  console.log("6. Testing Partner-Applied FX Receipts & Mid-Market Sanity Guardrail...");
  const refBenchmark = await fetchLiveFxQuote({ bypassCache: true });
  assert.ok(refBenchmark.quoteId.startsWith("fx_ref_"));
  assert.ok(refBenchmark.rates.NGN > 0 && refBenchmark.rates.KES > 0);

  const kesRefEstimate = computeFiatPayoutFromQuote(2600, "KES", refBenchmark);
  const sandbox = new SandboxOfframpProvider();
  const receipt = await sandbox.disburse(
    {
      recipientId: recipientB,
      wallet: recipientB,
      amountUsd: kesRefEstimate.amountUsd,
      amountLocal: kesRefEstimate.amountLocal,
      currency: "KES",
      rail: "kes_mpesa",
      destinationAccount: "+254712901844",
      noteCommitment: plan.manifestEntries[1].commitmentHash,
      referenceMidMarketRate: refBenchmark.rates.KES,
      referenceFxProvider: refBenchmark.provider,
      fxQuotedAt: refBenchmark.quotedAt,
      fxQuoteId: refBenchmark.quoteId,
    },
    plan.merkleTree.root
  );
  assert.equal(receipt.fxRateSource, "sandbox_simulated_partner");
  assert.equal(receipt.referenceMidMarketRate, refBenchmark.rates.KES);
  assert.notEqual(receipt.exchangeRate, refBenchmark.rates.KES, "Applied partner rate must include partner spread, not blind mid-market");
  assert.equal(receipt.fxSanityCheckPassed, true);
  assert.ok(typeof receipt.fxSpreadBps === "number" && receipt.fxSpreadBps < 0);

  // Wild partner rate (+15% off mid-market) MUST fail sanity guardrail
  assert.throws(
    () =>
      validatePartnerAppliedRate({
        appliedRate: refBenchmark.rates.NGN * 1.15,
        referenceMidMarketRate: refBenchmark.rates.NGN,
        currency: "NGN",
      }),
    FxSanityCheckError
  );
  console.log(
    `   ✓ Partner-applied FX (${receipt.exchangeRate} KES vs mid-market ref ${receipt.referenceMidMarketRate} KES, spread=${receipt.fxSpreadBps} bps) & outlier rejection verified.`
  );

  console.log("7. Testing Solana Wallet-Native SIWS, Per-Mutation Vault Sigs & Org Auth Isolation...");
  const adminWallet = Keypair.generate();
  const attackerWallet = Keypair.generate();
  const loginNonce = generateAuthNonce();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 300_000).toISOString();

  const loginMsg = buildSessionLoginMessage({
    domain: "aegis-ledger.app",
    walletPubkey: adminWallet.publicKey.toBase58(),
    nonce: loginNonce,
    issuedAt,
    expiresAt,
  });
  const loginSig = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(loginMsg), adminWallet.secretKey)
  );
  assert.equal(
    verifySolanaWalletSignature({
      walletPubkey: adminWallet.publicKey.toBase58(),
      message: loginMsg,
      signature: loginSig,
    }),
    true,
    "Valid Ed25519 SIWS signature must pass"
  );
  // Wrong wallet & tampered message MUST fail
  assert.equal(
    verifySolanaWalletSignature({
      walletPubkey: attackerWallet.publicKey.toBase58(),
      message: loginMsg,
      signature: loginSig,
    }),
    false,
    "Signature from adminWallet must NOT verify under attackerWallet"
  );
  assert.equal(
    verifySolanaWalletSignature({
      walletPubkey: adminWallet.publicKey.toBase58(),
      message: loginMsg + "\ntampered",
      signature: loginSig,
    }),
    false,
    "Tampered SIWS message must fail verification"
  );

  // Per-mutation Ed25519 vault authorization bound to (orgId, action, targetFingerprint, nonce)
  const vaultNonce = generateAuthNonce();
  const rotateMsg = buildVaultActionMessage({
    domain: "aegis-ledger.app",
    orgId,
    action: "vault_rotate",
    targetFingerprint: primaryAdminKeys.fingerprint,
    signerWallet: adminWallet.publicKey.toBase58(),
    nonce: vaultNonce,
    issuedAt,
    expiresAt,
  });
  const rotateSig = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(rotateMsg), adminWallet.secretKey)
  );
  assert.equal(
    verifySolanaWalletSignature({
      walletPubkey: adminWallet.publicKey.toBase58(),
      message: rotateMsg,
      signature: rotateSig,
    }),
    true
  );
  // Replaying same signature for a different orgId, action, or fingerprint MUST fail
  const wrongTargetMsg = buildVaultActionMessage({
    domain: "aegis-ledger.app",
    orgId,
    action: "vault_rotate",
    targetFingerprint: backupAdminKeys.fingerprint,
    signerWallet: adminWallet.publicKey.toBase58(),
    nonce: vaultNonce,
    issuedAt,
    expiresAt,
  });
  assert.equal(
    verifySolanaWalletSignature({
      walletPubkey: adminWallet.publicKey.toBase58(),
      message: wrongTargetMsg,
      signature: rotateSig,
    }),
    false,
    "Vault signature bound to primary fingerprint must NOT verify for backup fingerprint"
  );

  // Admin session JWT domain separation (isolated from auditor JWT key)
  assert.notEqual(
    Buffer.from(deriveAdminSessionJwtKey()).toString("hex"),
    Buffer.from(deriveJwtSigningKey()).toString("hex"),
    "Admin session JWT key must be domain-separated from auditor JWT key"
  );
  const adminToken = await mintOrgAdminSessionToken({
    walletPubkey: adminWallet.publicKey.toBase58(),
    orgId,
    role: "owner",
  });
  const verifiedAdmin = await verifyOrgAdminSessionToken(adminToken);
  assert.ok(verifiedAdmin);
  assert.equal(verifiedAdmin.orgId, orgId);
  assert.equal(verifiedAdmin.walletPubkey, adminWallet.publicKey.toBase58());
  assert.equal(verifiedAdmin.role, "owner");

  // Forged token signed with auditor JWT key MUST fail org admin verification
  const auditorSignedFake = await new SignJWT({ org_id: orgId, role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(attackerWallet.publicKey.toBase58())
    .setIssuer("aegis-ledger-admin")
    .setAudience("aegis-org-api")
    .setExpirationTime("1h")
    .sign(deriveJwtSigningKey());
  assert.equal(
    await verifyOrgAdminSessionToken(auditorSignedFake),
    null,
    "Token signed with auditor JWT key must be rejected by org admin verifier"
  );

  // Verify ALL org-scoped .strict() schemas reject caller-supplied org_id and require vault signatures
  assert.equal(
    registerOrgKeyVaultSchema.safeParse({
      org_id: orgId,
      admin_label: "Rogue",
      role: "primary",
      public_key_spki: primaryAdminKeys.publicKeySpkiBase64,
      fingerprint: primaryAdminKeys.fingerprint,
      auth_nonce: vaultNonce,
      wallet_signature: rotateSig,
    }).success,
    false,
    "registerOrgKeyVaultSchema MUST reject caller-supplied org_id"
  );
  assert.equal(
    registerOrgKeyVaultSchema.safeParse({
      admin_label: "Unsigned",
      role: "primary",
      public_key_spki: primaryAdminKeys.publicKeySpkiBase64,
      fingerprint: primaryAdminKeys.fingerprint,
    }).success,
    false,
    "registerOrgKeyVaultSchema MUST require auth_nonce & wallet_signature"
  );
  assert.equal(
    rotateOrgKeyVaultSchema.safeParse({
      revoke_fingerprint: primaryAdminKeys.fingerprint,
    }).success,
    false,
    "rotateOrgKeyVaultSchema MUST require auth_nonce & wallet_signature"
  );
  assert.equal(
    generateKeyRequestSchema.safeParse({
      org_id: orgId,
      auditor_identity: "CPA",
      auditor_public_key: auditorKeys.publicKeySpkiBase64,
      valid_from: issuedAt,
      valid_until: expiresAt,
      allowed_tokens: ["USDC"],
    }).success,
    false,
    "generateKeyRequestSchema MUST reject caller-supplied org_id"
  );
  assert.equal(
    swapQuoteRequestSchema.safeParse({
      org_id: orgId,
      amount_lamports: "1000000",
      initiated_by: adminWallet.publicKey.toBase58(),
    }).success,
    false,
    "swapQuoteRequestSchema MUST reject caller-supplied org_id"
  );

  // Verify-before-consume: a garbage signature MUST NOT burn a live challenge nonce,
  // while a valid signature consumes it atomically once and blocks replay!
  let mockConsumedAt: string | null = null;
  let consumeCalls = 0;
  const mockChallengeRow: WalletChallengeRecord = {
    nonce: loginNonce,
    purpose: "session_login",
    wallet_pubkey: adminWallet.publicKey.toBase58(),
    org_id: null,
    target_fingerprint: null,
    message: loginMsg,
  };
  const mockStore: WalletChallengeStore = {
    async findActive(q) {
      if (
        mockConsumedAt === null &&
        q.nonce === mockChallengeRow.nonce &&
        q.walletPubkey === mockChallengeRow.wallet_pubkey &&
        q.purpose === mockChallengeRow.purpose
      ) {
        return { data: mockChallengeRow, error: null };
      }
      return { data: null, error: null };
    },
    async consumeActive(q) {
      consumeCalls += 1;
      if (mockConsumedAt === null && q.nonce === mockChallengeRow.nonce) {
        mockConsumedAt = q.consumedAtIso;
        return { consumed: true, error: null };
      }
      return { consumed: false, error: null };
    },
  };

  // 1) Attacker sends garbage signature -> MUST fail AND leave nonce unconsumed!
  const garbageAttempt = await verifyAndConsumeChallengeWithStore(mockStore, {
    nonce: loginNonce,
    purpose: "session_login",
    walletPubkey: adminWallet.publicKey.toBase58(),
    signature: bs58.encode(randomBytes(64)),
  });
  assert.equal(garbageAttempt.ok, false, "Garbage signature MUST fail");
  assert.equal(consumeCalls, 0, "Garbage signature MUST NOT invoke consumeActive");
  assert.equal(mockConsumedAt, null, "Live nonce MUST remain unconsumed after garbage signature");

  // 2) Legitimate admin submits valid signature on that same live nonce -> MUST succeed & consume!
  const validAttempt = await verifyAndConsumeChallengeWithStore(mockStore, {
    nonce: loginNonce,
    purpose: "session_login",
    walletPubkey: adminWallet.publicKey.toBase58(),
    signature: loginSig,
  });
  assert.equal(validAttempt.ok, true, "Valid signature on surviving live nonce MUST succeed");
  assert.equal(consumeCalls, 1);
  assert.ok(mockConsumedAt !== null);

  // 3) Replay of valid signature -> MUST fail!
  const replayAttempt = await verifyAndConsumeChallengeWithStore(mockStore, {
    nonce: loginNonce,
    purpose: "session_login",
    walletPubkey: adminWallet.publicKey.toBase58(),
    signature: loginSig,
  });
  assert.equal(replayAttempt.ok, false, "Replayed valid signature MUST fail after single-use consumption");

  console.log(
    "   ✓ SIWS Ed25519 auth, verify-before-consume nonce safety, per-mutation vault signing, domain-separated JWTs, and zero caller org_id verified."
  );

  console.log("\nALL 7 SECURITY, BLIND-SERVER, WALLET AUTH, KEY VAULT, L1 RECONCILIATION & FX SUITES PASSED ✓");
}

run().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
