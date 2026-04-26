/**
 * GET /api/payroll/stream
 *
 * Server-Sent Events endpoint that streams simulated payroll execution logs.
 * Used by the xterm.js terminal on the Public Dashboard to visually prove
 * that only commitment hashes and tx signatures are visible — amounts and
 * recipient addresses are NEVER exposed.
 *
 * This endpoint simulates a realistic 5-recipient payroll batch execution,
 * streaming each step with appropriate delays to create the hacker-terminal effect.
 */
export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: string) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      async function delay(ms: number) {
        await new Promise((resolve) => setTimeout(resolve, ms));
      }

      // Generate realistic-looking hashes
      const genHash = () =>
        Array.from({ length: 64 }, () =>
          "0123456789abcdef"[Math.floor(Math.random() * 16)]
        ).join("");
      const genSig = () =>
        Array.from({ length: 88 }, () =>
          "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[
            Math.floor(Math.random() * 58)
          ]
        ).join("");
      const genPubkey = () =>
        Array.from({ length: 44 }, () =>
          "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[
            Math.floor(Math.random() * 58)
          ]
        ).join("");

      try {
        // ─── Phase 1: Initialization ─────────────────────────
        send("\x1b[38;5;69m╔══════════════════════════════════════════════════════════╗\x1b[0m");
        await delay(100);
        send("\x1b[38;5;69m║\x1b[0m  \x1b[1;38;5;141m⟐ AEGIS LEDGER\x1b[0m  \x1b[38;5;245m—  Private Payroll Engine v1.0\x1b[0m       \x1b[38;5;69m║\x1b[0m");
        await delay(100);
        send("\x1b[38;5;69m╚══════════════════════════════════════════════════════════╝\x1b[0m");
        await delay(400);

        send("");
        send("\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;69mINIT\x1b[0m    Connecting to Solana RPC...");
        await delay(600);
        send("\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;40m✓ OK\x1b[0m    RPC connected — slot \x1b[38;5;214m#" + (330000000 + Math.floor(Math.random() * 999999)) + "\x1b[0m");
        await delay(300);

        send("\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;69mINIT\x1b[0m    Loading treasury keypair...");
        await delay(400);
        const treasuryPubkey = genPubkey();
        send("\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;40m✓ OK\x1b[0m    Treasury: \x1b[38;5;141m" + treasuryPubkey.substring(0, 8) + "..." + treasuryPubkey.substring(36) + "\x1b[0m");
        await delay(300);

        send("\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;69mINIT\x1b[0m    Acquiring UTXO selection mutex...");
        await delay(500);
        send("\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;40m✓ LOCK\x1b[0m  Mutex acquired — TTL 60s");
        await delay(200);

        // ─── Phase 2: Batch Payroll ─────────────────────────
        send("");
        send("\x1b[38;5;69m────────────────────────────────────────────────────────────\x1b[0m");
        send("\x1b[1;38;5;214m  PAYROLL BATCH — 5 RECIPIENTS │ TOKEN: USDC\x1b[0m");
        send("\x1b[38;5;69m────────────────────────────────────────────────────────────\x1b[0m");
        await delay(600);

        for (let i = 0; i < 5; i++) {
          send("");
          send(
            "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;141mPAY " +
            (i + 1) + "/5\x1b[0m  Processing recipient #" + (i + 1) + "..."
          );
          await delay(400);

          // The key visual proof — amounts and addresses are HIDDEN
          send(
            "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[1;38;5;196m[SHIELDED]\x1b[0m Amount: \x1b[38;5;196m████████████\x1b[0m \x1b[38;5;245m│\x1b[0m Recipient: \x1b[38;5;196m████████████████████\x1b[0m"
          );
          await delay(300);

          send(
            "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;69mCLOAK\x1b[0m  Generating UTXO keypair..."
          );
          await delay(250);

          send(
            "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;69mCLOAK\x1b[0m  Depositing into shielded pool..."
          );
          await delay(800);

          const depositSig = genSig();
          send(
            "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;40m✓ TX\x1b[0m    Deposit sig: \x1b[38;5;45m" +
            depositSig.substring(0, 20) + "...\x1b[0m"
          );
          await delay(300);

          send(
            "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;69mCLOAK\x1b[0m  fullWithdraw → recipient stealth address..."
          );
          await delay(700);

          const withdrawSig = genSig();
          send(
            "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;40m✓ TX\x1b[0m    Withdraw sig: \x1b[38;5;45m" +
            withdrawSig.substring(0, 20) + "...\x1b[0m"
          );
          await delay(200);

          const commitment = genHash();
          send(
            "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;214mUTXO\x1b[0m   Commitment: \x1b[38;5;245m" +
            commitment.substring(0, 16) + "..." + commitment.substring(48) + "\x1b[0m"
          );
          await delay(400);

          send(
            "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;40m✓ DONE\x1b[0m  Recipient #" +
            (i + 1) + " \x1b[38;5;40m█\x1b[0m"
          );
          await delay(300);
        }

        // ─── Phase 3: Completion ─────────────────────────────
        send("");
        send("\x1b[38;5;69m────────────────────────────────────────────────────────────\x1b[0m");
        await delay(200);

        send(
          "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;69mDB\x1b[0m     Writing payroll_run → status: \x1b[38;5;40mcompleted\x1b[0m"
        );
        await delay(300);

        send(
          "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;69mDB\x1b[0m     Writing 5 commitment hashes to payroll_recipients"
        );
        await delay(200);

        send(
          "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;69mDB\x1b[0m     Audit log: \x1b[38;5;214mpayroll_completed\x1b[0m"
        );
        await delay(200);

        send(
          "\x1b[38;5;245m[" + new Date().toISOString() + "]\x1b[0m \x1b[38;5;40m✓ LOCK\x1b[0m  Mutex released (Lua atomic)"
        );
        await delay(400);

        send("");
        send("\x1b[38;5;40m╔══════════════════════════════════════════════════════════╗\x1b[0m");
        send("\x1b[38;5;40m║\x1b[0m  \x1b[1;38;5;40m✓ PAYROLL COMPLETE\x1b[0m                                       \x1b[38;5;40m║\x1b[0m");
        send("\x1b[38;5;40m║\x1b[0m  \x1b[38;5;245m5/5 recipients paid │ 10 transactions broadcast\x1b[0m        \x1b[38;5;40m║\x1b[0m");
        send("\x1b[38;5;40m║\x1b[0m  \x1b[38;5;245mAmounts: HIDDEN │ Recipients: HIDDEN │ ZK: VERIFIED\x1b[0m    \x1b[38;5;40m║\x1b[0m");
        send("\x1b[38;5;40m╚══════════════════════════════════════════════════════════╝\x1b[0m");
        await delay(200);

        send("");
        send("\x1b[38;5;245m[INFO] Only commitment hashes and transaction signatures are visible.\x1b[0m");
        send("\x1b[38;5;245m[INFO] Amounts, recipients, and stealth addresses remain fully shielded.\x1b[0m");
        send("\x1b[38;5;245m[INFO] To audit this payroll, a time-scoped viewing key is required.\x1b[0m");

        // End the stream
        send("__DONE__");
        controller.close();
      } catch {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
