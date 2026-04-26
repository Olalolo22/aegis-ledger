import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  CLOAK_PROGRAM_ID,
  NATIVE_SOL_MINT,
  createUtxo,
  createZeroUtxo,
  fullWithdraw,
  generateUtxoKeypair,
  getNkFromUtxoPrivateKey,
  transact,
  computeUtxoCommitment,
} from "@cloak.dev/sdk";
import { acquireMutex, releaseMutex } from "@/lib/redis";
import { getConnection, getTreasuryKeypair } from "@/lib/cloak";
import { createServiceClient } from "@/lib/supabase/server";
import { payrollRequestSchema, TOKEN_MINTS } from "@/lib/validation";

/**
 * POST /api/payroll
 *
 * Executes a batch private payroll disbursement via Cloak's shielded pool.
 *
 * Flow:
 * 1. Validate & sanitize inputs (Zod schema)
 * 2. Verify org exists in Supabase
 * 3. Acquire Redis mutex on UTXO selection (SET NX, TTL 60s)
 * 4. Create payroll_run record (status: 'processing')
 * 5. For each recipient:
 *    a. Generate UTXO keypair
 *    b. Deposit into Cloak shielded pool (transact)
 *    c. fullWithdraw to recipient's wallet
 *    d. Record commitment hash in payroll_recipients
 * 6. Update payroll_run → 'completed' with tx signatures
 * 7. Write audit_log entry
 * 8. Release mutex
 *
 * Concurrency Safety:
 * - Redis SET NX mutex prevents concurrent UTXO selection for the same org
 * - Mutex released in finally{} block to prevent deadlocks
 * - TTL of 60s prevents permanent lockout on crash
 *
 * Error Handling:
 * - If any payment in the batch fails, the payroll_run is marked 'failed'
 * - Already-completed payments within the batch are NOT rolled back
 *   (Cloak transactions are irreversible on-chain)
 * - The error_message column records which recipient index failed
 */
export async function POST(request: NextRequest) {
  // ─── 1. Parse & Validate Input ───────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = payrollRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  const { org_id, token_symbol, token_mint, initiated_by, recipients } =
    parsed.data;

  // Cross-validate token_mint against known mints
  const expectedMint = TOKEN_MINTS[token_symbol];
  if (expectedMint && token_mint !== expectedMint) {
    return NextResponse.json(
      {
        error: `token_mint mismatch: expected ${expectedMint} for ${token_symbol}`,
      },
      { status: 400 }
    );
  }

  // ─── 2. Verify Organization Exists ───────────────────────────
  const supabase = createServiceClient();
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, treasury_pubkey")
    .eq("id", org_id)
    .single();

  if (orgError || !org) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404 }
    );
  }

  // ─── 3. Acquire Redis Mutex ──────────────────────────────────
  // Lock scoped to org_id — prevents concurrent payroll runs
  // for the same organization from racing on UTXO selection.
  const mutex = await acquireMutex(`utxo-selection:${org_id}`, 60);
  if (!mutex.acquired) {
    return NextResponse.json(
      {
        error: "A payroll operation is already in progress for this organization. Please retry shortly.",
        code: "MUTEX_CONTENTION",
      },
      { status: 409 }
    );
  }

  try {
    // ─── 4. Calculate Totals & Create Payroll Run ──────────────
    const totalAmount = recipients.reduce(
      (sum, r) => sum + BigInt(r.amount),
      0n
    );

    const { data: payrollRun, error: insertError } = await supabase
      .from("payroll_runs")
      .insert({
        org_id,
        status: "processing",
        token_mint,
        token_symbol,
        total_amount_lamports: Number(totalAmount), // safe for USDC amounts < 2^53
        recipient_count: recipients.length,
        initiated_by,
        tx_signatures: null,
        error_message: null,
        completed_at: null,
      })
      .select("id")
      .single();

    if (insertError || !payrollRun) {
      console.error("Failed to create payroll run:", insertError);
      return NextResponse.json(
        { error: "Failed to create payroll run" },
        { status: 500 }
      );
    }

    const payrollRunId = payrollRun.id;

    // ─── 5. Execute Batch Disbursement ─────────────────────────
    const connection = getConnection();
    const treasuryKeypair = getTreasuryKeypair();

    // Determine the token mint PublicKey for Cloak
    const mintPubkey =
      token_symbol === "SOL"
        ? NATIVE_SOL_MINT
        : new PublicKey(token_mint);

    // Generate a viewing key for compliance scanning
    const scanKeypair = await generateUtxoKeypair();
    const viewingKeyNk = getNkFromUtxoPrivateKey(scanKeypair.privateKey);

    const baseOptions = {
      connection,
      programId: CLOAK_PROGRAM_ID,
      depositorKeypair: treasuryKeypair,
      walletPublicKey: treasuryKeypair.publicKey,
      chainNoteViewingKeyNk: viewingKeyNk,
    };

    const txSignatures: string[] = [];
    const recipientRecords: Array<{
      payroll_run_id: string;
      recipient_index: number;
      commitment_hash: string;
    }> = [];

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const amount = BigInt(recipient.amount);
      const recipientPubkey = new PublicKey(recipient.wallet);

      try {
        // 5a. Generate UTXO keypair for this payment
        const owner = await generateUtxoKeypair();
        const outputUtxo = await createUtxo(amount, owner, mintPubkey);

        // 5b. Deposit into Cloak shielded pool
        const deposited = await transact(
          {
            inputUtxos: [await createZeroUtxo(mintPubkey)],
            outputUtxos: [outputUtxo],
            externalAmount: amount,
            depositor: treasuryKeypair.publicKey,
          },
          baseOptions
        );

        // 5c. Full withdraw to recipient wallet (private → public)
        const withdrawResult = await fullWithdraw(
          deposited.outputUtxos,
          recipientPubkey,
          {
            ...baseOptions,
            cachedMerkleTree: deposited.merkleTree,
          }
        );

        // Collect transaction signatures
        if (deposited.signature) txSignatures.push(deposited.signature);
        if (withdrawResult.signature)
          txSignatures.push(withdrawResult.signature);

        // 5d. Compute commitment hash for the record
        const commitmentHash = deposited.outputUtxos?.[0]
          ? computeUtxoCommitment(deposited.outputUtxos[0]).toString()
          : `deposit-${i}`;

        recipientRecords.push({
          payroll_run_id: payrollRunId,
          recipient_index: i,
          commitment_hash: commitmentHash,
        });
      } catch (paymentError) {
        // ─── Partial Failure: mark entire run as failed ────────
        const errorMsg =
          paymentError instanceof Error
            ? paymentError.message
            : "Unknown error";

        await supabase
          .from("payroll_runs")
          .update({
            status: "failed",
            error_message: `Payment failed at recipient index ${i}: ${errorMsg}`,
            tx_signatures: txSignatures.length > 0 ? txSignatures : null,
          })
          .eq("id", payrollRunId);

        // Still insert any successful recipient records
        if (recipientRecords.length > 0) {
          await supabase
            .from("payroll_recipients")
            .insert(recipientRecords);
        }

        // Audit log the failure
        await supabase.from("audit_log").insert({
          event_type: "payroll_failed",
          org_id,
          metadata: {
            payroll_run_id: payrollRunId,
            failed_at_index: i,
            completed_count: i,
            total_count: recipients.length,
          },
        });

        return NextResponse.json(
          {
            error: `Payroll failed at recipient ${i}`,
            payroll_run_id: payrollRunId,
            completed_payments: i,
            total_payments: recipients.length,
          },
          { status: 500 }
        );
      }
    }

    // ─── 6. Mark Payroll Run as Completed ──────────────────────
    await supabase
      .from("payroll_runs")
      .update({
        status: "completed",
        tx_signatures: txSignatures,
        completed_at: new Date().toISOString(),
      })
      .eq("id", payrollRunId);

    // Insert all recipient commitment records
    if (recipientRecords.length > 0) {
      await supabase.from("payroll_recipients").insert(recipientRecords);
    }

    // ─── 7. Audit Log ──────────────────────────────────────────
    await supabase.from("audit_log").insert({
      event_type: "payroll_completed",
      org_id,
      metadata: {
        payroll_run_id: payrollRunId,
        recipient_count: recipients.length,
        token_symbol,
        tx_count: txSignatures.length,
      },
    });

    return NextResponse.json(
      {
        payroll_run_id: payrollRunId,
        status: "completed",
        recipient_count: recipients.length,
        tx_signatures: txSignatures,
      },
      { status: 200 }
    );
  } catch (error) {
    // ─── Unexpected Error ────────────────────────────────────
    console.error("Payroll route unexpected error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message:
          error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  } finally {
    // ─── 8. ALWAYS Release Mutex ───────────────────────────────
    // This runs whether the route succeeded, failed, or threw.
    await releaseMutex(mutex.key, mutex.lockValue);
  }
}
