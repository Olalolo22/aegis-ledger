"use client";

import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import {
  MAGICBLOCK_CLUSTER,
  broadcastMagicBlockTx,
  buildMagicBlockSplDeposit,
  deserializeMagicBlockTx,
} from "../lib/magicblock";

export type PrivateSwapStatus =
  | "idle"
  | "quoting"
  | "initializing_wasm"
  | "proving"
  | "signing"
  | "broadcasting"
  | "confirming"
  | "success"
  | "error";

interface SwapRequest {
  amount_lamports: string;
  slippage_bps?: number;
}

interface SwapParams {
  input_mint: string;
  output_mint: string;
  swap_amount_lamports: string;
  slippage_bps: number;
  quote: {
    estimatedOutputAmount: string;
    minOutputAmount: string;
    priceImpactPct: number;
    routePlan: string;
  };
  delegation_status?: string;
  program_id: string;
  relay_url: string;
  rpc_url: string;
}

export interface PrivateSwapResult {
  execute: (request: SwapRequest) => Promise<void>;
  status: PrivateSwapStatus;
  isProving: boolean;
  proofProgress: string | null;
  error: string | null;
  swapId: string | null;
  txSignature: string | null;
  swapParams: SwapParams | null;
  quote: SwapParams["quote"] | null;
}

/**
 * Non-custodial treasury runway top-up hook backed by MagicBlock Private SPL
 * deposit & delegation (`POST /v1/spl/deposit` with `private: true`).
 *
 * Fails loud on upstream or signing errors — never fabricates simulated tx hashes.
 */
export function usePrivateSwap(): PrivateSwapResult {
  const { publicKey, signTransaction, connected, wallet } = useWallet();
  const { connection } = useConnection();

  const [status, setStatus] = useState<PrivateSwapStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [swapId, setSwapId] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [swapParams, setSwapParams] = useState<SwapParams | null>(null);
  const [quote, setQuote] = useState<SwapParams["quote"] | null>(null);
  const [proofProgress, setProofProgress] = useState<string | null>(null);

  const isProving = status === "proving";

  const execute = useCallback(
    async (request: SwapRequest) => {
      if (!connected || !publicKey || !signTransaction || !wallet?.adapter) {
        setError("Invalid wallet state. Please connect a valid Solana wallet.");
        setStatus("error");
        return;
      }

      setError(null);
      setSwapId(null);
      setTxSignature(null);
      setSwapParams(null);
      setQuote(null);
      setProofProgress(null);

      try {
        setStatus("quoting");
        setProofProgress("Fetching live Jupiter quote & MagicBlock enclave delegation status...");

        const quoteRes = await fetch("/api/treasury/swap-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            amount_lamports: request.amount_lamports,
            slippage_bps: request.slippage_bps,
            initiated_by: publicKey.toBase58(),
          }),
        });

        const quoteData = await quoteRes.json().catch(() => ({}));
        if (!quoteRes.ok) {
          throw new Error(quoteData.error || "Failed to fetch treasury top-up quote");
        }

        const params: SwapParams = quoteData.swap_params;
        setSwapId(quoteData.swap_id);
        setSwapParams(params);
        setQuote(params.quote);

        setStatus("proving");
        setProofProgress("Building MagicBlock Private SPL delegated deposit transaction...");

        const depositTxResp = await buildMagicBlockSplDeposit(
          publicKey.toBase58(),
          BigInt(params.swap_amount_lamports),
          params.input_mint,
          MAGICBLOCK_CLUSTER
        );
        const depositTx = deserializeMagicBlockTx(depositTxResp);

        setStatus("signing");
        setProofProgress("Requesting wallet signature for MagicBlock TEE delegation deposit...");
        const signedTx = await signTransaction(depositTx);

        setStatus("broadcasting");
        setProofProgress("Broadcasting private delegation transaction...");
        const signature = await broadcastMagicBlockTx(
          signedTx,
          depositTxResp,
          connection
        );
        setTxSignature(signature);

        await connection.confirmTransaction(
          {
            signature,
            blockhash: depositTxResp.recentBlockhash,
            lastValidBlockHeight: depositTxResp.lastValidBlockHeight,
          },
          "confirmed"
        );

        const commitmentHash = bytesToHex(
          sha256(
            new TextEncoder().encode(
              `aegis:topup:v1:${quoteData.swap_id}:${publicKey.toBase58()}:${params.swap_amount_lamports}:${signature}`
            )
          )
        );

        setStatus("confirming");
        setProofProgress("Confirming treasury top-up with coordinator...");

        const confirmRes = await fetch("/api/treasury/swap-confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            swap_id: quoteData.swap_id,
            tx_signature: signature,
            commitment_hash: commitmentHash,
            output_amount: params.quote.estimatedOutputAmount,
          }),
        });

        const confirmData = await confirmRes.json().catch(() => ({}));
        if (!confirmRes.ok) {
          throw new Error(confirmData.error || "Failed to confirm treasury top-up");
        }

        const solAmount = Number(params.swap_amount_lamports) / 1e9;
        setProofProgress(
          `✓ Treasury deposit delegated to MagicBlock TEE — ${solAmount} SOL (~${(Number(params.quote.estimatedOutputAmount) / 1e6).toFixed(2)} USDC eq.)`
        );
        setStatus("success");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Treasury top-up failed";
        setError(msg);
        setStatus("error");
        setProofProgress(null);
        console.error("[Aegis Ledger] Treasury top-up error:", err);
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
    swapId,
    txSignature,
    swapParams,
    quote,
  };
}
