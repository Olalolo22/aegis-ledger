import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";
import type { PayrollRun } from "@/types/database";

/**
 * GET /api/payroll/[id]
 *
 * Returns the status and details of a specific payroll run.
 * Includes associated recipient commitment hashes.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Validate the payroll run ID
  const idSchema = z.string().uuid("Payroll run ID must be a valid UUID");
  const parsed = idSchema.safeParse(params.id);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payroll run ID format" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // Fetch the payroll run — use explicit column selection for type safety
  const { data: payrollRun, error: runError } = await supabase
    .from("payroll_runs")
    .select(
      "id, org_id, status, token_symbol, token_mint, total_amount_lamports, recipient_count, tx_signatures, error_message, initiated_by, created_at, completed_at"
    )
    .eq("id", params.id)
    .single();

  if (runError || !payrollRun) {
    return NextResponse.json(
      { error: "Payroll run not found" },
      { status: 404 }
    );
  }

  // Fetch associated recipient records
  const { data: recipients, error: recipError } = await supabase
    .from("payroll_recipients")
    .select("recipient_index, commitment_hash, created_at")
    .eq("payroll_run_id", params.id)
    .order("recipient_index", { ascending: true });

  if (recipError) {
    console.error("Failed to fetch recipients:", recipError);
  }

  return NextResponse.json({
    payroll_run: payrollRun as unknown as PayrollRun,
    recipients: recipients ?? [],
  });
}
