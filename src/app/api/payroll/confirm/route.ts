import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { payrollConfirmSchema } from "@/lib/validation";

/**
 * POST /api/payroll/confirm
 *
 * Callback endpoint invoked by the client after successful
 * wallet signing and transaction broadcast.
 *
 * ⚠ NON-CUSTODIAL: This endpoint does NOT sign anything.
 * It purely records the results of client-side signing:
 *
 * 1. Validates the payroll run exists and is in 'pending_signature' state
 * 2. Updates payroll_runs → 'completed' with the provided tx signatures
 * 3. Inserts payroll_recipients records with commitment hashes
 * 4. Writes an audit_log entry
 *
 * If the client reports a failure, it should call this endpoint
 * with a modified payload to mark the run as 'failed'.
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

  const parsed = payrollConfirmSchema.safeParse(body);
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

  const { payroll_run_id, tx_signatures, commitment_hashes } = parsed.data;



  // ─── 2. Verify Payroll Run Exists & Is Pending ──────────────
  const supabase = createServiceClient();

  const { data: payrollRun, error: fetchError } = await supabase
    .from("payroll_runs")
    .select("id, org_id, status, recipient_count")
    .eq("id", payroll_run_id)
    .single();

  if (fetchError || !payrollRun) {
    return NextResponse.json(
      { error: "Payroll run not found" },
      { status: 404 }
    );
  }

  if (payrollRun.status !== "pending") {
    return NextResponse.json(
      {
        error: `Payroll run is in '${payrollRun.status}' state — expected 'pending'`,
        code: "INVALID_STATE",
      },
      { status: 409 }
    );
  }

  // Validate commitment hash count matches recipient count
  if (commitment_hashes.length !== payrollRun.recipient_count) {
    return NextResponse.json(
      {
        error: `Expected ${payrollRun.recipient_count} commitment hashes, received ${commitment_hashes.length}`,
        code: "HASH_COUNT_MISMATCH",
      },
      { status: 400 }
    );
  }

  // ─── 3. Update Payroll Run → completed ──────────────────────
  const { error: updateError } = await supabase
    .from("payroll_runs")
    .update({
      status: "completed" as const,
      tx_signatures: tx_signatures,
      completed_at: new Date().toISOString(),
    })
    .eq("id", payroll_run_id);

  if (updateError) {
    console.error("Failed to update payroll run:", updateError);
    return NextResponse.json(
      { error: "Failed to update payroll run" },
      { status: 500 }
    );
  }

  // ─── 4. Insert Recipient Commitment Records ────────────────
  const recipientRecords = commitment_hashes.map((hash, index) => ({
    payroll_run_id,
    recipient_index: index,
    commitment_hash: hash,
  }));

  const { error: insertError } = await supabase
    .from("payroll_recipients")
    .insert(recipientRecords);

  if (insertError) {
    console.error("Failed to insert recipient records:", insertError);
    // Don't fail the response — the run is already marked completed.
    // This is a data consistency issue that can be reconciled.
  }

  // ─── 5. Audit Log ──────────────────────────────────────────
  await supabase.from("audit_log").insert({
    event_type: "payroll_completed",
    org_id: payrollRun.org_id,
    metadata: {
      payroll_run_id,
      recipient_count: payrollRun.recipient_count,
      tx_count: tx_signatures.length,
      signing_method: "client_wallet",
    },
  });

  return NextResponse.json(
    {
      payroll_run_id,
      status: "completed",
      tx_signatures,
      recipient_count: payrollRun.recipient_count,
    },
    { status: 200 }
  );
}
