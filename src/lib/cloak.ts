import { Connection, Keypair } from "@solana/web3.js";
import { CLOAK_PROGRAM_ID } from "@cloak.dev/sdk";
import { readFileSync } from "fs";

/**
 * Server-side only — Cloak SDK factory and Solana connection provider.
 *
 * The treasury keypair is loaded from a JSON file specified by
 * TREASURY_KEYPAIR_PATH. This file should be a standard Solana CLI
 * keypair (array of 64 bytes).
 *
 * ⚠ This module must NEVER be imported in client-side code.
 */

let _connection: Connection | null = null;
let _treasuryKeypair: Keypair | null = null;

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
 * Returns the treasury Keypair loaded from the file at TREASURY_KEYPAIR_PATH.
 * Lazily loaded and cached.
 *
 * ⚠ The keypair file must be an absolute path to a JSON array of 64 bytes.
 */
export function getTreasuryKeypair(): Keypair {
  if (!_treasuryKeypair) {
    const keypairPath = process.env.TREASURY_KEYPAIR_PATH;
    if (!keypairPath) {
      throw new Error(
        "TREASURY_KEYPAIR_PATH environment variable is not set."
      );
    }
    const raw = JSON.parse(readFileSync(keypairPath, "utf-8"));
    _treasuryKeypair = Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  return _treasuryKeypair;
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
