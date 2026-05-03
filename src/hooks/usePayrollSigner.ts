"use client";

import { useState, useCallback, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

/**
 * Custom hook encapsulating the client-side non-custodial payroll signing flow.
 *
 * Architecture:
 * 1. Calls POST /api/payroll → server returns signing_params
 *    (Merkle proofs, selected UTXOs, recipients, etc.)
 * 2. Dynamically loads the @cloak.dev/sdk and initializes the WASM
 *    Groth16 prover in the browser environment
 * 3. Uses the CloakSDK in browser wallet mode to:
 *    a. Reconstruct input UTXOs from the server's signing_params
 *    b. Execute privateTransfer / fullWithdraw per recipient
 *    c. The SDK internally: builds Merkle proof → generates Groth16
 *       ZK proof (WASM) → constructs Solana transaction → requests
 *       wallet signature → broadcasts to RPC
 * 4. Captures tx signatures + commitment hashes and POSTs them to
 *    /api/payroll/confirm to close the loop
 *
 * ⚠ NON-CUSTODIAL: The server never holds signing keys. All ZK proving,
 *   transaction signing, and broadcasting happen here in the browser.
 *
 * @returns { execute, status, error, payrollRunId, txSignatures, signingParams, isProving, proofProgress }
 */

// ─── Status Machine ─────────────────────────────────────────────

export type PayrollSignerStatus =
  | "idle"
  | "preparing"           // calling POST /api/payroll
  | "initializing_wasm"   // loading Cloak SDK WASM circuits
  | "proving"             // generating ZK proofs (Groth16 WASM)
  | "signing"             // wallet signature requested
  | "broadcasting"        // sending signed txns to RPC
  | "confirming"          // calling POST /api/payroll/confirm
  | "completed"
  | "error";

// ─── Interfaces ─────────────────────────────────────────────────

interface PayrollRequest {
  org_id: string;
  token_symbol: string;
  token_mint: string;
  initiated_by: string;
  recipients: Array<{ wallet: string; amount: string }>;
}

interface SigningParams {
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
  recipients: Array<{ wallet: string; amount: string }>;
  token_mint: string;
  token_symbol: string;
  program_id: string;
  relay_url: string;
  rpc_url: string;
}

interface PayrollSignerResult {
  /** Trigger the payroll signing flow */
  execute: (request: PayrollRequest) => Promise<void>;
  /** Current step in the signing lifecycle */
  status: PayrollSignerStatus;
  /** True specifically during ZK proof generation (for UI feedback) */
  isProving: boolean;
  /** Granular progress message from the SDK */
  proofProgress: string | null;
  /** Error message if the flow failed */
  error: string | null;
  /** Payroll run ID from the server */
  payrollRunId: string | null;
  /** Transaction signatures after successful broadcast */
  txSignatures: string[];
  /** Raw signing params from the server (for debugging/display) */
  signingParams: SigningParams | null;
  /** Number of recipients processed so far (for batch progress) */
  recipientProgress: { current: number; total: number } | null;
}

// ─── SDK Lazy Loader ────────────────────────────────────────────

/**
 * Dynamically imports the Cloak SDK to avoid SSR issues and to
 * ensure the WASM circuits are only loaded when needed.
 *
 * Returns the entire SDK module for destructuring.
 */
async function loadCloakSDK() {
  const sdk = await import("@cloak.dev/sdk");

  // Verify the Groth16 circuit artifacts are reachable.
  // The SDK fetches these from S3 on first proof generation,
  // but we can preflight-check availability here.
  const circuitsAvailable = await sdk.areCircuitsAvailable(
    sdk.DEFAULT_CIRCUITS_URL
  );

  if (!circuitsAvailable) {
    console.warn(
      "[Aegis Ledger] Cloak ZK circuit artifacts are not available at the " +
        "default URL. Proof generation may fail. URL: " +
        sdk.DEFAULT_CIRCUITS_URL
    );
  }

  // Set the circuits path explicitly for deterministic behavior
  sdk.setCircuitsPath(sdk.DEFAULT_CIRCUITS_URL);

  return sdk;
}

// ─── Hook ───────────────────────────────────────────────────────

export function usePayrollSigner(): PayrollSignerResult {
  const { publicKey, signTransaction, connected, wallet } = useWallet();
  const { connection } = useConnection();

  const [status, setStatus] = useState<PayrollSignerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [payrollRunId, setPayrollRunId] = useState<string | null>(null);
  const [txSignatures, setTxSignatures] = useState<string[]>([]);
  const [signingParams, setSigningParams] = useState<SigningParams | null>(null);
  const [proofProgress, setProofProgress] = useState<string | null>(null);
  const [recipientProgress, setRecipientProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  // Track if we're in the proving phase for UI feedback
  const isProving = status === "proving";

  // Cache the SDK instance across executions
  const sdkRef = useRef<Awaited<ReturnType<typeof loadCloakSDK>> | null>(null);

  const execute = useCallback(
    async (request: PayrollRequest) => {
      // ─── Pre-flight checks ─────────────────────────────────
      if (!connected || !publicKey) {
        setError("No wallet connected. Please connect a Solana wallet first.");
        setStatus("error");
        return;
      }

      if (!signTransaction) {
        setError(
          "Connected wallet does not support transaction signing. " +
            "This may be caused by an EVM wallet (MetaMask) injecting " +
            "into the Solana wallet namespace. Please use Phantom, " +
            "Solflare, or Backpack."
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
      setPayrollRunId(null);
      setTxSignatures([]);
      setSigningParams(null);
      setProofProgress(null);
      setRecipientProgress(null);

      try {
        // ─── Step 1: Request signing params from server ──────
        setStatus("preparing");
        setProofProgress("Requesting transaction parameters from server...");

        const prepareRes = await fetch("/api/payroll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...request,
            initiated_by: publicKey.toBase58(),
          }),
        });

        const prepareData = await prepareRes.json();

        if (!prepareRes.ok) {
          throw new Error(prepareData.error || "Failed to prepare payroll");
        }

        setPayrollRunId(prepareData.payroll_run_id);
        setSigningParams(prepareData.signing_params);

        const params: SigningParams = prepareData.signing_params;

        // ─── Step 2: Initialize WASM Circuits ────────────────
        setStatus("initializing_wasm");
        setProofProgress("Loading ZK circuit artifacts (WASM Groth16 prover)...");

        if (!sdkRef.current) {
          sdkRef.current = await loadCloakSDK();
        }

        const sdk = sdkRef.current;

        // ─── Step 3: Initialize CloakSDK in browser wallet mode ──
        setProofProgress("Initializing Cloak SDK with wallet adapter...");

        const walletAdapter = wallet.adapter;

        // The CloakSDK accepts a wallet adapter with signTransaction
        // for browser-mode operation (no keypair needed)
        // Build a wallet adapter shape that CloakSDK expects.
        // Cast signAllTransactions to any to avoid Transaction generic mismatch
        // between @solana/web3.js versions used by the SDK and the adapter.
        const adapterAny = walletAdapter as unknown as Record<string, unknown>;
        const cloakClient = new sdk.CloakSDK({
          wallet: {
            publicKey: publicKey,
            signTransaction: signTransaction,
            signAllTransactions: typeof adapterAny.signAllTransactions === "function"
              ? (adapterAny.signAllTransactions as (txs: never[]) => Promise<never[]>).bind(walletAdapter)
              : undefined,
          },
          network: params.rpc_url?.includes("devnet") ? "devnet" : "mainnet",
          relayUrl: params.relay_url,
          programId: new PublicKey(params.program_id),
        });

        // ─── Step 4: Build + Prove + Sign per recipient ──────
        setStatus("proving");

        const collectedSignatures: string[] = [];
        const collectedCommitments: string[] = [];
        const totalRecipients = params.recipients.length;

        setRecipientProgress({ current: 0, total: totalRecipients });

        // For batch payroll, we process each recipient as a separate
        // shielded transfer. The SDK handles:
        //   Merkle proof → Groth16 ZK proof → TX construction → sign → broadcast
        //
        // Each iteration:
        // 1. Generate a note for the deposit amount
        // 2. Deposit into the shielded pool
        // 3. Withdraw to the recipient's wallet address

        for (let i = 0; i < totalRecipients; i++) {
          const recipient = params.recipients[i];
          const amountLamports = BigInt(recipient.amount);

          setRecipientProgress({ current: i + 1, total: totalRecipients });
          setProofProgress(
            `Processing recipient ${i + 1}/${totalRecipients}: ` +
              `generating ZK proof for ${recipient.wallet.slice(0, 8)}...`
          );

          // ─── 4a. Generate a note for this disbursement ─────
          const note = await sdk.generateNote(
            Number(amountLamports),
            params.rpc_url?.includes("devnet") ? "devnet" : "mainnet"
          );

          // ─── 4b. Deposit into the shielded pool ────────────
          setProofProgress(
            `Recipient ${i + 1}/${totalRecipients}: depositing into shielded pool...`
          );

          setStatus("signing");
          const depositResult = await cloakClient.deposit(
            connection,
            note,
            {
              onProgress: (phase: string, data?: { message?: string }) => {
                setProofProgress(
                  `Recipient ${i + 1}/${totalRecipients}: ${data?.message || phase}`
                );
              },
              skipPreflight: false,
            }
          );

          const depositedNote = depositResult.note;
          const depositSig = depositResult.signature;

          if (depositSig) {
            collectedSignatures.push(String(depositSig));
          }

          // ─── 4c. Withdraw to recipient stealth address ─────
          setStatus("proving");
          setProofProgress(
            `Recipient ${i + 1}/${totalRecipients}: generating withdrawal ZK proof...`
          );

          const recipientPubkey = new PublicKey(recipient.wallet);

          const withdrawResult = await cloakClient.withdraw(
            connection,
            depositedNote,
            recipientPubkey,
            {
              withdrawAll: true,
              onProgress: (phase: string, data?: { message?: string }) => {
                const msg = data?.message || phase;

                // Detect proof generation phase for precise isProving state
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

                setProofProgress(
                  `Recipient ${i + 1}/${totalRecipients}: ${msg}`
                );
              },
            }
          );

          // Capture the withdrawal tx signature
          const withdrawSig = withdrawResult.signature;
          if (withdrawSig) {
            collectedSignatures.push(String(withdrawSig));
          }

          // Capture the commitment hash from the deposited note
          // (TransferResult doesn't expose commitment directly)
          const commitment = depositedNote.commitment || note.commitment;
          collectedCommitments.push(String(commitment));

          setProofProgress(
            `Recipient ${i + 1}/${totalRecipients}: ✓ complete`
          );
        }

        // ─── Step 5: Confirm with server ─────────────────────
        setStatus("confirming");
        setProofProgress("All recipients processed. Confirming with server...");

        const confirmRes = await fetch("/api/payroll/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payroll_run_id: prepareData.payroll_run_id,
            tx_signatures: collectedSignatures,
            commitment_hashes: collectedCommitments,
          }),
        });

        const confirmData = await confirmRes.json();

        if (!confirmRes.ok) {
          throw new Error(confirmData.error || "Failed to confirm payroll");
        }

        setTxSignatures(collectedSignatures);
        setProofProgress(
          `✓ Payroll complete — ${totalRecipients} recipients, ${collectedSignatures.length} transactions`
        );
        setStatus("completed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        setStatus("error");
        setProofProgress(null);
        console.error("[Aegis Ledger] Payroll signing failed:", err);
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
  };
}
