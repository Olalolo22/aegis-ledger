import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { swapConfirmSchema } from "@/lib/validation";

/**
 * POST /api/treasury/swap-confirm
 *
 * Callback endpoint invoked by the client after successful
 * wallet signing and swap transaction broadcast.
 *
 * ⚠ NON-CUSTODIAL: This endpoint does NOT sign anything.
 * It purely records the results of client-side ZK proving + signing:
 *
 * 1. Validates the swap record exists and is in 'pending_signature' state
 * 2. Updates treasury_swaps → 'completed' with the tx signature
 * 3. Writes an audit_log entry
 *
 * If the client reports a failure, it should call this endpoint
 * with a modified payload to mark the swap as 'failed'.
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

  const parsed = swapConfirmSchema.safeParse(body);
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

  const { swap_id, tx_signature, commitment_hash, output_amount } = parsed.data;



  // ─── 2. Verify Swap Record Exists & Is Pending ──────────────
  const supabase = createServiceClient();

  const { data: swapRecord, error: fetchError } = await supabase
    .from("treasury_swaps")
    .select("id, org_id, status, input_amount_lamports")
    .eq("id", swap_id)
    .single();

  if (fetchError || !swapRecord) {
    return NextResponse.json(
      { error: "Swap record not found" },
      { status: 404 }
    );
  }

  if (swapRecord.status !== "pending") {
    return NextResponse.json(
      {
        error: `Swap is in '${swapRecord.status}' state — expected 'pending'`,
        code: "INVALID_STATE",
      },
      { status: 409 }
    );
  }

  // ─── 3. Update Swap Record → completed ──────────────────────
  const { error: updateError } = await supabase
    .from("treasury_swaps")
    .update({
      status: "completed" as const,
      tx_signature,
      commitment_hash,
      actual_output_amount: Number(output_amount),
      completed_at: new Date().toISOString(),
    })
    .eq("id", swap_id);

  if (updateError) {
    console.error("Failed to update swap record:", updateError);
    return NextResponse.json(
      { error: "Failed to update swap record" },
      { status: 500 }
    );
  }

  // ─── 4. Audit Log ──────────────────────────────────────────
  await supabase.from("audit_log").insert({
    event_type: "swap_completed",
    org_id: swapRecord.org_id,
    metadata: {
      swap_id,
      input_amount_lamports: swapRecord.input_amount_lamports,
      output_amount,
      tx_signature,
      commitment_hash,
      signing_method: "client_wallet",
    },
  });

  return NextResponse.json(
    {
      swap_id,
      status: "completed",
      tx_signature,
      output_amount,
    },
    { status: 200 }
  );
}
