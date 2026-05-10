import { Connection, PublicKey } from "@solana/web3.js";
import { CLOAK_PROGRAM_ID } from "@cloak.dev/sdk-devnet";

/**
 * Server-side Cloak SDK helpers — DATA COORDINATOR ONLY.
 *
 * ⚠ NON-CUSTODIAL: This module NEVER touches private keys.
 * All signing is performed client-side via the Solana wallet adapter.
 *
 * The server's role is limited to:
 * 1. Providing a shared Solana RPC connection
 * 2. Fetching public inputs (Merkle proofs, available UTXOs) from Cloak
 * 3. Returning parameters for client-side ZK proving & signing
 */

let _connection: Connection | null = null;

/**
 * Returns a shared Solana RPC connection instance.
 * Lazily created on first call; reused for the lifetime of the process.
 */
export function getConnection(): Connection {
  if (!_connection) {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      throw new Error("SOLANA_RPC_URL environment variable is not set.");
    }
    _connection = new Connection(rpcUrl, "confirmed");
  }
  return _connection;
}

/**
 * Returns the Cloak program ID (mainnet constant).
 */
export function getProgramId() {
  return CLOAK_PROGRAM_ID;
}

/**
 * Returns the Cloak relay URL from environment.
 */
export function getRelayUrl(): string {
  const url = process.env.CLOAK_RELAY_URL;
  if (!url) {
    throw new Error("CLOAK_RELAY_URL environment variable is not set.");
  }
  return url;
}

// ═══════════════════════════════════════════════════════════════
// Data Coordinator Helpers — fetch public inputs for client signing
// ═══════════════════════════════════════════════════════════════

/** Shape of a Merkle proof returned to the client for ZK proving. */
export interface MerkleProofData {
  root: string;
  leafCount: number;
  proofs: Array<{
    leaf: string;
    pathElements: string[];
    pathIndices: number[];
  }>;
}

/** Shape of a spendable UTXO descriptor returned to the client. */
export interface UtxoDescriptor {
  commitment: string;
  amount: string;
  mint: string;
  leafIndex: number;
  nullifier: string;
}

/**
 * Fetches the current Merkle tree state from the Cloak indexer/RPC.
 *
 * Used to provide the client with the root and proofs needed
 * for ZK proof generation. This is a READ-ONLY operation —
 * no private key material is involved.
 *
 * @param mint - The SPL token mint to query the shielded pool for
 * @returns Merkle root, leaf count, and inclusion proofs
 */
export async function fetchMerkleProofs(
  mint: PublicKey
): Promise<MerkleProofData> {
  const relayUrl = getRelayUrl();
  const connection = getConnection();

  try {
    // Query the Cloak indexer for the current Merkle tree state.
    // The relay exposes a JSON-RPC endpoint for tree queries.
    const response = await fetch(`${relayUrl}/v1/merkle-tree`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getMerkleTree",
        params: {
          mint: mint.toBase58(),
          cluster: connection.rpcEndpoint,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Cloak relay returned ${response.status}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new Error(`Cloak relay error: ${json.error.message}`);
    }

    return json.result as MerkleProofData;
  } catch (error) {
    console.error("Failed to fetch Merkle proofs:", error);
    throw new Error(
      `Failed to fetch Merkle proofs: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Fetches available (unspent) UTXOs for a given treasury public key
 * from the Cloak indexer. READ-ONLY — the server never sees private keys.
 *
 * These UTXOs are returned to the client so it can construct the
 * shielded transaction inputs for signing.
 *
 * @param treasuryPubkey - The organization's treasury wallet public key
 * @param mint - The SPL token mint to filter UTXOs by
 * @returns Array of spendable UTXO descriptors
 */
export async function fetchAvailableUtxos(
  treasuryPubkey: PublicKey,
  mint: PublicKey
): Promise<UtxoDescriptor[]> {
  const relayUrl = getRelayUrl();
  const connection = getConnection();

  try {
    const response = await fetch(`${relayUrl}/v1/utxos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getUtxos",
        params: {
          owner: treasuryPubkey.toBase58(),
          mint: mint.toBase58(),
          cluster: connection.rpcEndpoint,
          spent: false,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Cloak relay returned ${response.status}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new Error(`Cloak relay error: ${json.error.message}`);
    }

    return (json.result?.utxos ?? []) as UtxoDescriptor[];
  } catch (error) {
    console.error("Failed to fetch available UTXOs:", error);
    throw new Error(
      `Failed to fetch UTXOs: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
