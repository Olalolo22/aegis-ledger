import { NextRequest, NextResponse } from "next/server";
import { getOfframpProvider, DisbursementRecipient } from "@/lib/offramp";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { batch_root, recipients } = body;

    if (!batch_root || !Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json(
        { error: "Missing batch_root or recipients list" },
        { status: 400 }
      );
    }

    // Filter only offramp recipients
    const validRecipients: DisbursementRecipient[] = recipients
      .filter((r: any) => r.rail === "ngn_bank" || r.rail === "kes_mpesa")
      .map((r: any) => ({
        recipientId: r.recipientId || r.wallet,
        wallet: r.wallet,
        amountUsd: Number(r.amountUsd) || 0,
        amountLocal: Number(r.amountLocal) || 0,
        currency: r.currency || (r.rail === "kes_mpesa" ? "KES" : "NGN"),
        rail: r.rail,
        destinationAccount: r.destinationAccount || "Bank Account",
        noteCommitment: r.noteCommitment || "00000000000000000000000000000000",
      }));

    if (validRecipients.length === 0) {
      return NextResponse.json(
        { message: "No off-ramp recipients in batch", count: 0, receipts: [] },
        { status: 200 }
      );
    }

    const provider = getOfframpProvider();
    const receipts = await provider.disburseBatch(validRecipients, batch_root);

    return NextResponse.json({
      success: true,
      provider: provider.name,
      isSandbox: provider.isSandbox,
      batch_root,
      count: receipts.length,
      receipts,
    });
  } catch (error) {
    console.error("[Aegis Offramp API] Error dispatching disbursements:", error);
    return NextResponse.json(
      {
        error: "Internal server error during off-ramp dispatch",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
