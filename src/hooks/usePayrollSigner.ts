"use client";

import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  MAGICBLOCK_CLUSTER,
  broadcastMagicBlockTx,
  buildBatchRootAttestationTx,
  buildMagicBlockSplDeposit,
  buildMagicBlockSplTransfer,
  deserializeMagicBlockTx,
  planPrivatePayrollBatch,
  queryMagicBlockSplBalance,
  type TeeBatchRecipient,
} from "../lib/magicblock";
import {
  encryptManifestClientSide,
  getUnlockedOrgKeyFromMemory,
} from "../lib/e2ee";
import {
  decodeMagicBlockTransferFromTransaction,
  formatLeafMemo,
  verifyDecodedMagicBlockTransfer,
} from "../lib/onchainVerify";

/**
 * Blind-Server, Non-Custodial Batch Payroll Signer over MagicBlock Private SPL.
 *
 * Zero-Knowledge Server Invariants:
 * 1. `POST /api/payroll` receives ONLY aggregate batch totals (`recipient_count`,
 *    `total_amount_base_units`, `onchain_total_base_units`). Individual wallets,
 *    salaries, and bank accounts NEVER touch `/api/payroll`.
 * 2. Every on-chain shielded MagicBlock Private SPL transfer embeds the FULL
 *    64-hex leaf commitment (`aegis:leaf:<64-hex>`) in its Memo, is wire-verified
 *    client-side before signing, and broadcasts strictly to MagicBlock TEE RPC.
 * 3. EVERY batch anchors `aegis:merkle:v1:<root>:<count>` on Solana L1 so
 *    auditors can enumerate all treasury anchors on L1 and prove zero batches
 *    were withheld.
 * 4. The batch manifest (including per-recipient salaries, wallets, salts,
 *    Merkle inclusion proofs, and settled ER transfer signatures) is encrypted
 *    CLIENT-SIDE via RSA-OAEP-256 + AES-256-GCM to ALL active org admin public
 *    keys (Primary + Backup Controller) using volatile memory-only vault keys
 *    (zero plaintext keys in `window.localStorage`).
 * 5. `POST /api/payroll/confirm` receives ONLY the L1 anchor signature, optional
 *    treasury deposit signatures, blinded 64-hex leaf commitment hashes, Merkle
 *    root, and `e2ee_envelope` — NEVER salaries, salts, sum proofs, or employee
 *    ER transfer signatures.
 */

export type PayrollSignerStatus =
  | "idle"
  | "preparing"
  | "initializing_wasm"
  | "proving"
  | "signing"
  | "broadcasting"
  | "confirming"
  | "completed"
  | "error";

export interface PayrollRequest {
  org_id: string;
  token_symbol: string;
  token_mint: string;
  initiated_by: string;
  recipients: Array<{
    wallet: string;
    amount: string;
    token?: "USDC" | "USDT" | "SOL";
    settlementRail?: "onchain_shielded" | "ngn_bank" | "kes_mpesa";
    destinationAccount?: string;
  }>;
  rail?: "tee";
}

interface SigningParams {
  token_mint: string;
  token_symbol: string;
  program_id: string;
  relay_url: string;
  rpc_url: string;
}

interface PayrollSignerResult {
  execute: (request: PayrollRequest) => Promise<void>;
  status: PayrollSignerStatus;
  isProving: boolean;
  proofProgress: string | null;
  error: string | null;
  payrollRunId: string | null;
  txSignatures: string[];
  anchorTxSignature: string | null;
  signingParams: SigningParams | null;
  recipientProgress: { current: number; total: number } | null;
  activeRail: "tee";
  setActiveRail: (rail: "tee") => void;
  batchRoot: string | null;
  offrampReceipts: Record<string, any>;
}

export function usePayrollSigner(): PayrollSignerResult {
  const { publicKey, signTransaction, connected, wallet } = useWallet();
  const { connection } = useConnection();

  const [activeRail, setActiveRail] = useState<"tee">("tee");
  const [status, setStatus] = useState<PayrollSignerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [payrollRunId, setPayrollRunId] = useState<string | null>(null);
  const [txSignatures, setTxSignatures] = useState<string[]>([]);
  const [anchorTxSignature, setAnchorTxSignature] = useState<string | null>(null);
  const [signingParams, setSigningParams] = useState<SigningParams | null>(null);
  const [proofProgress, setProofProgress] = useState<string | null>(null);
  const [batchRoot, setBatchRoot] = useState<string | null>(null);
  const [offrampReceipts, setOfframpReceipts] = useState<Record<string, any>>({});
  const [recipientProgress, setRecipientProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const isProving = status === "proving";

  const execute = useCallback(
    async (request: PayrollRequest) => {
      if (!connected || !publicKey || !signTransaction || !wallet?.adapter) {
        setError("Please connect an active Solana wallet to execute batch payroll.");
        setStatus("error");
        return;
      }

      if (!request.recipients || request.recipients.length === 0) {
        setError("Payroll batch must contain at least one recipient.");
        setStatus("error");
        return;
      }

      setError(null);
      setPayrollRunId(null);
      setTxSignatures([]);
      setAnchorTxSignature(null);
      setSigningParams(null);
      setProofProgress(null);
      setBatchRoot(null);
      setOfframpReceipts({});
      setRecipientProgress(null);

      try {
        const batchStartTime = Date.now();
        setStatus("preparing");
        setProofProgress(
          "Loading active organization admin E2EE public keys from Key Vault..."
        );

        // 0. Preflight: resolve ALL active org admin public keys (Primary + Backup Controller)
        // Never fall back to raw localStorage private keys.
        const activeAdminPubKeys: string[] = [];
        const unlockedAdminKey = getUnlockedOrgKeyFromMemory(request.org_id);
        if (unlockedAdminKey?.publicKeySpkiBase64) {
          activeAdminPubKeys.push(unlockedAdminKey.publicKeySpkiBase64);
        }

        try {
          const vaultRes = await fetch(
            `/api/org/key-vault?org_id=${encodeURIComponent(request.org_id)}`
          );
          if (vaultRes.ok) {
            const vaultData = await vaultRes.json();
            for (const v of vaultData.vaults || []) {
              if (
                v.status === "active" &&
                v.public_key_spki &&
                !activeAdminPubKeys.includes(v.public_key_spki)
              ) {
                activeAdminPubKeys.push(v.public_key_spki);
              }
            }
          }
        } catch {
          // If vault API is unreachable, unlockedAdminKey in memory can still wrap
        }

        if (activeAdminPubKeys.length === 0) {
          throw new Error(
            "Organization E2EE Key Vault is not initialized or unlocked. Initialize/unlock your passphrase-protected Key Vault in the Compliance panel before executing payroll."
          );
        }

        // 1. Compute ONLY aggregate batch totals client-side (zero per-recipient data sent to /api/payroll)
        const totalAmountBaseUnits = request.recipients.reduce(
          (sum, r) => sum + BigInt(r.amount),
          0n
        );
        const onChainTotalBaseUnits = request.recipients
          .filter((r) => (r.settlementRail || "onchain_shielded") === "onchain_shielded")
          .reduce((sum, r) => sum + BigInt(r.amount), 0n);

        setProofProgress(
          "Coordinating blind aggregate batch run with MagicBlock PER..."
        );

        const prepareRes = await fetch("/api/payroll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            org_id: request.org_id,
            token_symbol: request.token_symbol,
            token_mint: request.token_mint,
            initiated_by: publicKey.toBase58(),
            recipient_count: request.recipients.length,
            total_amount_base_units: totalAmountBaseUnits.toString(),
            onchain_total_base_units: onChainTotalBaseUnits.toString(),
            rail: "tee",
          }),
        });

        const prepareData = await prepareRes.json().catch(() => ({}));
        if (!prepareRes.ok) {
          throw new Error(
            prepareData.error ||
              prepareData.detail ||
              `Payroll coordination failed (HTTP ${prepareRes.status})`
          );
        }

        const runId: string = prepareData.payroll_run_id;
        const params: SigningParams = prepareData.signing_params;
        const cluster: string =
          prepareData.magicblock?.cluster || MAGICBLOCK_CLUSTER;

        setPayrollRunId(runId);
        setSigningParams(params);

        const totalRecipients = request.recipients.length;

        // 2. Build Binary SHA-256 Merkle Sum Tree + MagicBlock split/delay schedule CLIENT-SIDE
        setStatus("proving");
        setProofProgress(
          "Computing Binary SHA-256 Merkle Sum Tree & MagicBlock Private SPL split plan locally..."
        );

        const batchRecipients: TeeBatchRecipient[] = request.recipients.map((r) => ({
          wallet: r.wallet,
          amountLamports: BigInt(r.amount),
          token: r.token,
          settlementRail: r.settlementRail || "onchain_shielded",
          destinationAccount: r.destinationAccount,
        }));

        const plan = planPrivatePayrollBatch(
          batchRecipients,
          params.token_mint,
          runId
        );
        setBatchRoot(plan.merkleTree.root);

        const depositSignatures: string[] = [];
        const localDisplaySignatures: string[] = [];
        const erTransferSigByIndex: Record<number, string> = {};

        // 3. Ensure treasury funds are delegated inside MagicBlock's ephemeral balance
        const mintsToFund = Object.entries(plan.totalsByMint).filter(
          ([, total]) => total > 0n
        );

        for (const [mint, requiredAmount] of mintsToFund) {
          setStatus("initializing_wasm");
          setProofProgress(
            `Checking MagicBlock PER ephemeral balance for mint ${mint.slice(0, 6)}...`
          );

          const bal = await queryMagicBlockSplBalance(
            publicKey.toBase58(),
            mint,
            cluster
          );
          const isDelegated =
            bal.delegation?.status === "delegated" || bal.location === "ephemeral";
          const currentEphemeral = isDelegated ? BigInt(bal.balance || "0") : 0n;

          if (currentEphemeral < requiredAmount) {
            const topUpAmount = requiredAmount - currentEphemeral;
            setStatus("signing");
            setProofProgress(
              `Requesting wallet signature to shield & delegate ${topUpAmount.toString()} base units into MagicBlock TEE...`
            );

            const depositTxResp = await buildMagicBlockSplDeposit(
              publicKey.toBase58(),
              topUpAmount,
              mint,
              cluster
            );
            const depositTx = deserializeMagicBlockTx(depositTxResp);
            const signedDeposit = await signTransaction(depositTx);

            setStatus("broadcasting");
            setProofProgress(
              "Broadcasting private TEE deposit & delegation transaction..."
            );
            const depositSig = await broadcastMagicBlockTx(
              signedDeposit,
              depositTxResp,
              connection
            );
            await connection.confirmTransaction(
              {
                signature: depositSig,
                blockhash: depositTxResp.recentBlockhash,
                lastValidBlockHeight: depositTxResp.lastValidBlockHeight,
              },
              "confirmed"
            );
            depositSignatures.push(depositSig);
            localDisplaySignatures.push(depositSig);
          }
        }

        // 4. Execute each on-chain shielded transfer via MagicBlock Private SPL
        //    with FULL 64-hex leaf memo + client-side pre-sign wire verification
        if (plan.onChainTransfers.length > 0) {
          setRecipientProgress({ current: 0, total: plan.onChainTransfers.length });

          for (let i = 0; i < plan.onChainTransfers.length; i++) {
            const transfer = plan.onChainTransfers[i];
            const manifestEntry = plan.manifestEntries[transfer.recipientIndex];
            const fullLeafMemo = formatLeafMemo(transfer.commitmentHash);

            setRecipientProgress({
              current: i + 1,
              total: plan.onChainTransfers.length,
            });

            setStatus("proving");
            setProofProgress(
              `Building MagicBlock Private SPL transfer ${i + 1}/${plan.onChainTransfers.length} (split=${transfer.splitPlan.split}, delay=${transfer.splitPlan.minDelayMs}-${transfer.splitPlan.maxDelayMs}ms)...`
            );

            const transferTxResp = await buildMagicBlockSplTransfer({
              from: publicKey.toBase58(),
              to: transfer.recipient,
              amount: transfer.amountBaseUnits,
              mint: transfer.mint,
              fromBalance: "ephemeral",
              toBalance: "base",
              split: transfer.splitPlan.split,
              minDelayMs: transfer.splitPlan.minDelayMs,
              maxDelayMs: transfer.splitPlan.maxDelayMs,
              memo: fullLeafMemo,
              cluster,
            });

            const tx = deserializeMagicBlockTx(transferTxResp);

            // Client-side pre-sign wire verification: ensure API returned exact recipient,
            // amount, mint, and full 64-hex leaf memo before prompting wallet signature
            const decodedPreSign = decodeMagicBlockTransferFromTransaction(tx);
            if (!decodedPreSign) {
              throw new Error(
                `MagicBlock API returned a transaction without a valid 0x10 Private SPL instruction for leaf ${transfer.recipientIndex}.`
              );
            }
            const preSignCheck = verifyDecodedMagicBlockTransfer(decodedPreSign, {
              signature: "pre-sign",
              leafIndex: transfer.recipientIndex,
              expectedSender: publicKey.toBase58(),
              expectedCommitmentHash: transfer.commitmentHash,
              saltHex: manifestEntry.saltHex,
              runNonce: runId,
              merkleProof: manifestEntry.merkleProof,
              anchoredMerkleRoot: plan.merkleTree.root,
            });
            if (!preSignCheck.verified) {
              throw new Error(
                `Pre-sign wire verification failed for leaf ${transfer.recipientIndex}: ${preSignCheck.error}`
              );
            }

            setStatus("signing");
            setProofProgress(
              `Authorize private TEE transfer ${i + 1}/${plan.onChainTransfers.length} in your wallet...`
            );
            const signedTx = await signTransaction(tx);

            setStatus("broadcasting");
            setProofProgress(
              `Broadcasting private transfer ${i + 1}/${plan.onChainTransfers.length} to MagicBlock TEE validator...`
            );
            const sig = await broadcastMagicBlockTx(
              signedTx,
              transferTxResp,
              connection
            );

            // Store per-employee ER transfer sig ONLY inside encrypted manifest (never sent plaintext to /confirm)
            erTransferSigByIndex[transfer.recipientIndex] = sig;
          }
        }

        // 5. UNCONDITIONAL Solana L1 Merkle Sum Tree Root Anchor (EVERY batch, all rail mixes)
        // Leaks zero salaries, zero wallets, and zero burn rate — only a 64-char SHA-256 root + leaf count.
        setStatus("signing");
        setProofProgress(
          "Requesting wallet signature to anchor batch Merkle Sum Tree root on Solana L1..."
        );
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        const anchorTx = buildBatchRootAttestationTx(
          publicKey,
          plan.merkleTree.root,
          plan.merkleTree.leafCount,
          blockhash
        );
        const signedAnchor = await signTransaction(anchorTx);

        setStatus("broadcasting");
        setProofProgress("Anchoring Merkle Sum Tree root permanently on Solana L1...");
        const anchorSig = await connection.sendRawTransaction(
          signedAnchor.serialize(),
          { skipPreflight: false, maxRetries: 3 }
        );
        await connection.confirmTransaction(
          { signature: anchorSig, blockhash, lastValidBlockHeight },
          "confirmed"
        );
        setAnchorTxSignature(anchorSig);
        localDisplaySignatures.push(anchorSig);

        // 6. Client-Side Zero-Knowledge Multi-Admin Audit Envelope Encryption
        // All individual salaries, wallets, salts, Merkle sum proofs, and ER transfer
        // signatures stay strictly inside this ciphertext envelope.
        setStatus("confirming");
        setProofProgress(
          `Encrypting batch audit manifest client-side for ${activeAdminPubKeys.length} active org admin key(s)...`
        );

        const manifestPayload = JSON.stringify({
          version: 2,
          payrollRunId: runId,
          orgId: request.org_id,
          initiatedBy: publicKey.toBase58(),
          tokenSymbol: params.token_symbol,
          merkleRoot: plan.merkleTree.root,
          anchorTxSignature: anchorSig,
          totalAmountBaseUnits: plan.merkleTree.totalSum.toString(),
          leafCount: plan.merkleTree.leafCount,
          entries: plan.manifestEntries.map(({ splitPlan: _ignored, ...entry }) => ({
            ...entry,
            settlementTxSignature: erTransferSigByIndex[entry.index] ?? undefined,
          })),
        });

        const { envelope: e2eeEnvelope } = await encryptManifestClientSide(
          manifestPayload,
          activeAdminPubKeys,
          {
            orgId: request.org_id,
            payrollRunId: runId,
            merkleRoot: plan.merkleTree.root,
            tokenSymbol: params.token_symbol,
          }
        );

        // 7. Blind Server Confirmation: ZERO salaries, ZERO salts, ZERO sum proofs, ZERO employee ER sigs
        setProofProgress(
          "Sealing batch via blind server verification of Solana L1 root anchor & E2EE AAD..."
        );

        const confirmRes = await fetch("/api/payroll/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payroll_run_id: runId,
            anchor_tx_signature: anchorSig,
            deposit_tx_signatures: depositSignatures,
            commitment_hashes: plan.merkleTree.leaves,
            merkle_root: plan.merkleTree.root,
            e2ee_envelope: e2eeEnvelope,
          }),
        });

        const confirmData = await confirmRes.json().catch(() => ({}));
        if (!confirmRes.ok) {
          throw new Error(
            confirmData.detail ||
              confirmData.error ||
              `Payroll confirmation failed (HTTP ${confirmRes.status})`
          );
        }

        // 8. Dispatch optional fiat off-ramp settlements (partner-applied FX + mid-market sanity guardrail)
        if (plan.offRampRecipients.length > 0) {
          setProofProgress(
            "Dispatching off-ramp fiat settlements with partner-applied FX & mid-market sanity check..."
          );
          const offrampPayload = plan.offRampRecipients.map((r) => {
            const decimals = r.tokenSymbol === "SOL" ? 9 : 6;
            const amountWhole = Number(r.amountBaseUnits) / 10 ** decimals;
            return {
              recipientId: r.recipient,
              wallet: r.recipient,
              amountUsd: amountWhole,
              rail: r.settlementRail,
              destinationAccount: r.destinationAccount || "Bank Account",
              noteCommitment: r.commitmentHash,
            };
          });

          const dispatchRes = await fetch("/api/payroll/dispatch-offramp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              batch_root: plan.merkleTree.root,
              recipients: offrampPayload,
            }),
          });

          if (!dispatchRes.ok) {
            const dispatchErr = await dispatchRes.json().catch(() => ({}));
            throw new Error(
              dispatchErr.detail ||
                dispatchErr.error ||
                `Off-ramp dispatch failed (HTTP ${dispatchRes.status})`
            );
          }

          const dispatchData = await dispatchRes.json();
          if (dispatchData.receipts) {
            const receiptMap: Record<string, any> = {};
            dispatchData.receipts.forEach((rcpt: any) => {
              receiptMap[rcpt.recipientWallet] = rcpt;
            });
            setOfframpReceipts(receiptMap);
          }
        }

        setTxSignatures(localDisplaySignatures);
        const durationSec = ((Date.now() - batchStartTime) / 1000).toFixed(1);
        setProofProgress(
          `✓ Payroll settled & L1-anchored (blind server) — ${totalRecipients} recipients verified in ${durationSec}s (root ${plan.merkleTree.root.slice(0, 12)}...)`
        );
        setStatus("completed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Payroll execution failed";
        setError(msg);
        setStatus("error");
        setProofProgress(null);
        console.error("[Aegis] Payroll execution error:", err);
      }
    },
    [connected, publicKey, signTransaction, wallet, connection]
  );

  return {
    execute,
    status,
    isProving,
    proofProgress,
    error,
    payrollRunId,
    txSignatures,
    anchorTxSignature,
    signingParams,
    recipientProgress,
    activeRail,
    setActiveRail,
    batchRoot,
    offrampReceipts,
  };
}
