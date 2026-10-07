import { Keypair } from "@solana/web3.js";

const MAGICBLOCK_API_URL = "https://api.magicblock.app";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

async function run() {
  console.log("==================================================");
  console.log("MagicBlock SPL Private Payments API Test Harness");
  console.log("==================================================\n");

  // 1. Health Check
  console.log("1. Checking API Health...");
  try {
    const healthRes = await fetch(`${MAGICBLOCK_API_URL}/health`);
    const health = await healthRes.json();
    console.log("   Health Status:", health);
  } catch (err) {
    console.error("   Health check failed:", err.message);
    return;
  }

  // 2. Generate sender & recipient test keypairs
  const sender = Keypair.generate();
  const recipient = Keypair.generate();
  console.log("\n2. Test Wallets Generated:");
  console.log("   Sender Pubkey:   ", sender.publicKey.toBase58());
  console.log("   Recipient Pubkey:", recipient.publicKey.toBase58());

  // 3. Check Initial Balance & Delegation on Devnet-Private
  console.log("\n3. Querying Balance & Delegation on 'devnet-private'...");
  try {
    const balanceUrl = new URL(`${MAGICBLOCK_API_URL}/v1/spl/balance`);
    balanceUrl.searchParams.set("address", sender.publicKey.toBase58());
    balanceUrl.searchParams.set("mint", DEVNET_USDC_MINT);
    balanceUrl.searchParams.set("cluster", "devnet-private");

    const balRes = await fetch(balanceUrl.toString());
    const balData = await balRes.json();
    console.log("   Balance Response:", JSON.stringify(balData, null, 2));
  } catch (err) {
    console.error("   Balance query failed:", err.message);
  }

  // 4. Test Deposit Transaction Builder (Base -> TEE Ephemeral Rollup)
  console.log("\n4. Testing /v1/spl/deposit (Base -> Devnet TEE)...");
  try {
    const depositPayload = {
      owner: sender.publicKey.toBase58(),
      amount: 10_000_000, // 10 USDC
      cluster: "devnet-private",
      mint: DEVNET_USDC_MINT,
      initIfMissing: true,
      initAtasIfMissing: true,
      private: true,
    };

    const depRes = await fetch(`${MAGICBLOCK_API_URL}/v1/spl/deposit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(depositPayload),
    });

    const depData = await depRes.json();
    if (depData.error) {
      console.log("   Deposit Error:", depData.error);
    } else {
      console.log("   Deposit Tx Built Successfully!");
      console.log("   Kind:", depData.kind);
      console.log("   Send To:", depData.sendTo);
      console.log("   Instructions Count:", depData.instructionCount);
      console.log("   Validator:", depData.validator);
      console.log("   Required Signers:", depData.requiredSigners);
      console.log("   Tx Base64 Prefix:", depData.transactionBase64.slice(0, 60) + "...");
    }
  } catch (err) {
    console.error("   Deposit test failed:", err.message);
  }

  // 5. Test Private Transfer Transaction Builder (Inside TEE with split & timing delay)
  console.log("\n5. Testing /v1/spl/transfer (Private Batch Split inside TEE)...");
  try {
    const transferPayload = {
      from: sender.publicKey.toBase58(),
      to: recipient.publicKey.toBase58(),
      mint: DEVNET_USDC_MINT,
      amount: 5_000_000, // 5 USDC
      cluster: "devnet-private",
      visibility: "private",
      fromBalance: "ephemeral",
      toBalance: "base",
      split: 3,
      minDelayMs: "1000",
      maxDelayMs: "5000",
      memo: "Aegis Payroll Disbursement",
    };

    const txRes = await fetch(`${MAGICBLOCK_API_URL}/v1/spl/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(transferPayload),
    });

    const txData = await txRes.json();
    if (txData.error) {
      console.log("   Transfer Response Error / Warning:", txData.error);
    } else {
      console.log("   Private Transfer Tx Built Successfully!");
      console.log("   Kind:", txData.kind);
      console.log("   Send To:", txData.sendTo);
      console.log("   Instructions Count:", txData.instructionCount);
      console.log("   Send RPC Endpoint:", txData.sendRpcEndpoint);
      console.log("   Required Signers:", txData.requiredSigners);
      console.log("   Tx Base64 Prefix:", txData.transactionBase64.slice(0, 60) + "...");
    }
  } catch (err) {
    console.error("   Transfer test failed:", err.message);
  }

  console.log("\n==================================================");
  console.log("Test Completed.");
  console.log("==================================================");
}

run().catch(console.error);
