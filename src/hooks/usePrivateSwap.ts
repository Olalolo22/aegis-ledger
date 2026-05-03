"use client";

import { useState, useCallback, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

/**
 * Client-side hook for the DAO Admin Private Swap pipeline (SOL→USDC).
 *
 * Architecture:
 * 1. Calls POST /api/treasury/swap-quote → server returns swap_params
 *    (UTXOs, Merkle root, Orca quote, slippage, program IDs)
 * 2. Dynamically loads the @cloak.dev/sdk and initializes the WASM Groth16 prover
 * 3. Uses CloakSDK.swap() to:
 *    a. Generate a note for the SOL deposit
 *    b. Deposit SOL into the shielded pool
 *    c. Execute the swap proof (Groth16 ZK proof → sign → broadcast)
 *    d. Route the swap natively through Orca within the shielded pool
 * 4. Captures the tx signature and POSTs to /api/treasury/swap-confirm
 *
 * State Machine:
 *   idle → quoting → initializing_wasm → proving → signing → broadcasting → confirming → success
 *                                                                                      ↘ error
 *
 * ⚠ NON-CUSTODIAL: The server never holds signing keys.
 *   All ZK proving, signing, and broadcasting happen in the browser.
 */

// ─── Status Machine ─────────────────────────────────────────────

export type PrivateSwapStatus =
  | "idle"
  | "quoting"             // calling POST /api/treasury/swap-quote
  | "initializing_wasm"   // loading Cloak SDK WASM circuits
  | "proving"             // generating Groth16 ZK proof for swap
  | "signing"             // wallet signature requested
  | "broadcasting"        // sending signed tx to Solana RPC
  | "confirming"          // calling POST /api/treasury/swap-confirm
  | "success"
  | "error";

// ─── Interfaces ─────────────────────────────────────────────────

interface SwapRequest {
  org_id: string;
  amount_lamports: string;
  slippage_bps?: number;
}

interface SwapParams {
  merkle_root: string;
  merkle_proofs: Array<{
    leaf: string;
    pathElements: string[];
    pathIndices: number[];
  }>;
  merkle_leaf_count: number;
  selected_utxos: Array<{
    commitment: string;
    amount: string;
    mint: string;
    leafIndex: number;
    nullifier: string;
  }>;
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
  program_id: string;
  relay_url: string;
  rpc_url: string;
}

export interface PrivateSwapResult {
  /** Trigger the swap flow */
  execute: (request: SwapRequest) => Promise<void>;
  /** Current step in the swap lifecycle */
  status: PrivateSwapStatus;
  /** True specifically during ZK proof generation */
  isProving: boolean;
  /** Granular progress message from the SDK */
  proofProgress: string | null;
  /** Error message if the swap failed */
  error: string | null;
  /** Swap ID from the server */
  swapId: string | null;
  /** Transaction signature after successful broadcast */
  txSignature: string | null;
  /** Raw swap params from the server (for display) */
  swapParams: SwapParams | null;
  /** Quote data for UI display */
  quote: SwapParams["quote"] | null;
}

// ─── SDK Lazy Loader ────────────────────────────────────────────

async function loadCloakSDK() {
  const sdk = await import("@cloak.dev/sdk");
  const circuitsAvailable = await sdk.areCircuitsAvailable(
    sdk.DEFAULT_CIRCUITS_URL
  );
  if (!circuitsAvailable) {
    console.warn(
      "[Aegis Ledger] Cloak ZK circuit artifacts not available at: " +
        sdk.DEFAULT_CIRCUITS_URL
    );
  }
  sdk.setCircuitsPath(sdk.DEFAULT_CIRCUITS_URL);
  return sdk;
}

// ─── Hook ───────────────────────────────────────────────────────

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
  const sdkRef = useRef<Awaited<ReturnType<typeof loadCloakSDK>> | null>(null);

  const execute = useCallback(
    async (request: SwapRequest) => {
      // ─── Pre-flight checks ─────────────────────────────────
      if (!connected || !publicKey) {
        setError("No wallet connected. Please connect a Solana wallet first.");
        setStatus("error");
        return;
      }

      if (!signTransaction) {
        setError(
          "Connected wallet does not support transaction signing. " +
            "Please use Phantom, Solflare, or Backpack — not MetaMask."
        );
        setStatus("error");
        return;
      }

      if (!wallet?.adapter) {
        setError("Wallet adapter not available. Please reconnect your wallet.");
        setStatus("error");
        return;
      }

      // Reset state
      setError(null);
      setSwapId(null);
      setTxSignature(null);
      setSwapParams(null);
      setQuote(null);
      setProofProgress(null);

      try {
        // ─── Step 1: Request swap quote from server ──────────
        setStatus("quoting");
        setProofProgress("Fetching swap quote and locking UTXOs...");

        const quoteRes = await fetch("/api/treasury/swap-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...request,
            initiated_by: publicKey.toBase58(),
          }),
        });

        const quoteData = await quoteRes.json();

        if (!quoteRes.ok) {
          throw new Error(quoteData.error || "Failed to fetch swap quote");
        }

        setSwapId(quoteData.swap_id);
        setSwapParams(quoteData.swap_params);
        setQuote(quoteData.swap_params.quote);

        const params: SwapParams = quoteData.swap_params;

        // ─── Step 2: Initialize WASM Circuits ────────────────
        setStatus("initializing_wasm");
        setProofProgress("Loading ZK circuit artifacts (WASM Groth16 prover)...");

        if (!sdkRef.current) {
          sdkRef.current = await loadCloakSDK();
        }

        const sdk = sdkRef.current;

        // ─── Step 3: Initialize CloakSDK in browser wallet mode
        setProofProgress("Initializing Cloak SDK with wallet adapter...");

        const walletAdapter = wallet.adapter;
        const adapterAny = walletAdapter as unknown as Record<string, unknown>;

        const cloakClient = new sdk.CloakSDK({
          wallet: {
            publicKey: publicKey,
            signTransaction: signTransaction,
            signAllTransactions:
              typeof adapterAny.signAllTransactions === "function"
                ? (adapterAny.signAllTransactions as (txs: never[]) => Promise<never[]>).bind(walletAdapter)
                : undefined,
          },
          network: params.rpc_url?.includes("devnet") ? "devnet" : "mainnet",
          relayUrl: params.relay_url,
          programId: new PublicKey(params.program_id),
        });

        // ─── Step 4: Generate note & deposit SOL ─────────────
        setStatus("proving");
        setProofProgress("Generating shielded deposit note...");

        const amountLamports = Number(params.swap_amount_lamports);

        const note = await sdk.generateNote(
          amountLamports,
          params.rpc_url?.includes("devnet") ? "devnet" : "mainnet"
        );

        setProofProgress("Depositing SOL into shielded pool...");
        setStatus("signing");

        const depositResult = await cloakClient.deposit(
          connection,
          note,
          {
            onProgress: (phase: string, data?: { message?: string }) => {
              setProofProgress(data?.message || phase);
            },
            skipPreflight: false,
          }
        );

        const depositedNote = depositResult.note;

        // ─── Step 5: Execute private swap (ZK proof) ─────────
        setStatus("proving");
        setProofProgress("Generating Groth16 ZK proof for private swap...");

        const outputMint = new PublicKey(params.output_mint);

        const swapResult = await cloakClient.swap(
          connection,
          depositedNote,
          publicKey, // recipient = admin's own wallet (for USDC output)
          {
            outputMint: params.output_mint,
            minOutputAmount: Number(params.quote.minOutputAmount),
            slippageBps: params.slippage_bps,
            onProgress: (phase: string, data?: { message?: string }) => {
              const msg = data?.message || phase;

              if (
                msg.includes("proof") ||
                msg.includes("Generating") ||
                msg.includes("groth16") ||
                msg.includes("snark")
              ) {
                setStatus("proving");
              } else if (
                msg.includes("sign") ||
                msg.includes("wallet") ||
                msg.includes("approval")
              ) {
                setStatus("signing");
              } else if (
                msg.includes("broadcast") ||
                msg.includes("confirm") ||
                msg.includes("sending")
              ) {
                setStatus("broadcasting");
              }

              setProofProgress(msg);
            },
          }
        );

        const resultSignature = swapResult.signature;
        const commitmentHash = depositedNote.commitment || note.commitment;

        if (resultSignature) {
          setTxSignature(String(resultSignature));
        }

        // ─── Step 6: Confirm with server ─────────────────────
        setStatus("confirming");
        setProofProgress("Confirming swap with server...");

        const confirmRes = await fetch("/api/treasury/swap-confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            swap_id: quoteData.swap_id,
            tx_signature: String(resultSignature || ""),
            commitment_hash: String(commitmentHash),
            output_amount: params.quote.estimatedOutputAmount,
          }),
        });

        const confirmData = await confirmRes.json();

        if (!confirmRes.ok) {
          throw new Error(confirmData.error || "Failed to confirm swap");
        }

        setProofProgress(
          `✓ Swap complete — ${amountLamports / 1e9} SOL → ~${(Number(params.quote.estimatedOutputAmount) / 1e6).toFixed(2)} USDC`
        );
        setStatus("success");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        setStatus("error");
        setProofProgress(null);
        console.error("[Aegis Ledger] Private swap failed:", err);
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
