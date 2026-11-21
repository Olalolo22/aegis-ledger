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
  getErConnection,
  planPrivatePayrollBatch,
  queryMagicBlockSplBalance,
  type TeeBatchRecipient,
} from "../lib/magicblock";

/**
 * Custom hook encapsulating client-side non-custodial payroll execution over
 * MagicBlock Private Ephemeral Rollups (PER / Intel TDX TEE).
 *
 * Security invariants:
 * - Zero plaintext L1 SPL/SOL salary transfers from treasury to recipients.
 * - Every on-chain shielded transfer routes strictly through
 *   `buildMagicBlockSplTransfer` (`visibility: "private"`,
 *   `fromBalance: "ephemeral"`, randomized `split` and timing delays) and is
 *   broadcast strictly to the MagicBlock TEE RPC (`sendRpcEndpoint`).
 * - Never silently falls back to public L1 RPC or fabricates `sim_` signatures.
 * - Commits every batch to a domain-separated Binary SHA-256 Merkle Sum Tree
 *   and submits the manifest to `/api/payroll/confirm` for completeness
 *   verification and HKDF/AES-256-GCM encryption at rest.
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
  recipients: Array<{
    wallet: string;
    amount: string;
    token?: "USDC" | "USDT" | "SOL";
    settlementRail?: "onchain_shielded" | "ngn_bank" | "kes_mpesa";
    destinationAccount?: string;
  }>;
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

      setError(null);
      setPayrollRunId(null);
      setTxSignatures([]);
      setSigningParams(null);
      setProofProgress(null);
      setBatchRoot(null);
      setOfframpReceipts({});
      setRecipientProgress(null);

      try {
        const batchStartTime = Date.now();
        setStatus("preparing");
        setProofProgress("Coordinating batch payroll with MagicBlock PER...");

        // 1. Server coordination (fail loud — never swallow non-2xx or mock params)
        const prepareRes = await fetch("/api/payroll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...request,
            rail: "tee",
            initiated_by: publicKey.toBase58(),
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
        const cluster: string = prepareData.magicblock?.cluster || MAGICBLOCK_CLUSTER;

        setPayrollRunId(runId);
        setSigningParams(params);

        const totalRecipients = params.recipients.length;

        // 2. Build Binary SHA-256 Merkle Sum Tree + MagicBlock split/delay schedule
        setStatus("proving");
        setProofProgress(
          "Computing Binary SHA-256 Merkle Sum Tree & MagicBlock Private SPL split plan..."
        );

        const batchRecipients: TeeBatchRecipient[] = params.recipients.map((r) => ({
          wallet: r.wallet,
          amountLamports: BigInt(r.amount),
          token: r.token,
          settlementRail: r.settlementRail || "onchain_shielded",
          destinationAccount: r.destinationAccount,
        }));

        const plan = planPrivatePayrollBatch(batchRecipients, params.token_mint, runId);
        setBatchRoot(plan.merkleTree.root);

        const collectedSignatures: string[] = [];

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
            setProofProgress("Broadcasting private TEE deposit & delegation transaction...");
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
            collectedSignatures.push(depositSig);
          }
        }

        // 4. Execute each on-chain shielded transfer strictly via MagicBlock Private SPL
        if (plan.onChainTransfers.length > 0) {
          setRecipientProgress({ current: 0, total: plan.onChainTransfers.length });

          for (let i = 0; i < plan.onChainTransfers.length; i++) {
            const transfer = plan.onChainTransfers[i];
            setRecipientProgress({ current: i + 1, total: plan.onChainTransfers.length });

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
              // Blinded commitment prefix only — zero salary/role metadata
              memo: `aegis:leaf:${transfer.commitmentHash.slice(0, 16)}`,
              cluster,
            });

            const tx = deserializeMagicBlockTx(transferTxResp);

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
            collectedSignatures.push(sig);
          }
        } else {
          // 100% off-ramp fiat batch: anchor ONLY the Binary Merkle Sum Tree root
          // (no recipient wallets, no individual salaries) on MagicBlock ER
          setStatus("signing");
          setProofProgress(
            "Requesting wallet signature to anchor batch Merkle Sum Tree root on MagicBlock TEE..."
          );
          const erConn = getErConnection(params.relay_url);
          const { blockhash } = await erConn.getLatestBlockhash("confirmed");
          const anchorTx = buildBatchRootAttestationTx(
            publicKey,
            plan.merkleTree.root,
            plan.merkleTree.leafCount,
            blockhash
          );
          const signedAnchor = await signTransaction(anchorTx);

          setStatus("broadcasting");
          setProofProgress("Broadcasting Merkle Sum Tree root attestation to MagicBlock TEE...");
          const anchorSig = await erConn.sendRawTransaction(signedAnchor.serialize(), {
            skipPreflight: false,
            maxRetries: 3,
          });
          collectedSignatures.push(anchorSig);
        }

        // 5. Confirm payroll run & persist HKDF/AES-256-GCM encrypted audit manifest
        setStatus("confirming");
        setProofProgress(
          "Verifying Binary Merkle Sum Tree completeness & sealing encrypted audit manifest..."
        );

        const confirmRes = await fetch("/api/payroll/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payroll_run_id: runId,
            tx_signatures: collectedSignatures,
            commitment_hashes: plan.merkleTree.leaves,
            merkle_root: plan.merkleTree.root,
            manifest: plan.manifestEntries.map(({ splitPlan: _ignored, ...entry }) => entry),
          }),
        });

        const confirmData = await confirmRes.json().catch(() => ({}));
        if (!confirmRes.ok) {
          throw new Error(
            confirmData.error ||
              `Payroll confirmation failed (HTTP ${confirmRes.status})`
          );
        }

        // 6. Dispatch fiat off-ramp settlements (NGN Bank / KES M-Pesa) anchored to Merkle root
        if (plan.offRampRecipients.length > 0) {
          const offrampPayload = plan.offRampRecipients.map((r) => {
            const decimals = r.tokenSymbol === "SOL" ? 9 : 6;
            const amountWhole = Number(r.amountBaseUnits) / 10 ** decimals;
            return {
              recipientId: r.recipient,
              wallet: r.recipient,
              amountUsd: amountWhole,
              amountLocal:
                r.settlementRail === "kes_mpesa"
                  ? Math.round(amountWhole * 130)
                  : Math.round(amountWhole * 1331),
              currency: r.settlementRail === "kes_mpesa" ? "KES" : "NGN",
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

        setTxSignatures(collectedSignatures);
        const durationSec = ((Date.now() - batchStartTime) / 1000).toFixed(1);
        setProofProgress(
          `✓ Payroll complete — ${totalRecipients} recipients settled via MagicBlock PER in ${durationSec}s (Merkle root ${plan.merkleTree.root.slice(0, 12)}...)`
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
    signingParams,
    recipientProgress,
    activeRail,
    setActiveRail,
    batchRoot,
    offrampReceipts,
  };
}
