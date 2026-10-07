"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { usePayrollSigner } from "@/hooks/usePayrollSigner";
import styles from "./PayrollWorkspace.module.css";

type Recipient = { name: string; wallet: string; amount: string; rail: "Bank" | "M-Pesa" | "Shielded" };

const initialRecipients: Recipient[] = [
  { name: "Senior Anchor Protocol Dev", wallet: "6bq9QqzvjNbQE4sJs4fLsGUpqHe4hPcJVc6oJQyq6RzC", amount: "3800", rail: "Bank" },
  { name: "Mobile / iOS Lead", wallet: "8uE6pQnHLAqLkNhMfVjC9yFeEqx3qkPx4x6VGWjE2FmH", amount: "2600", rail: "M-Pesa" },
  { name: "Frontend Engineer", wallet: "3oLd7mJQ7cVRP4qUKoynTkMfVvFjUeBjG3aJXcgGxGZr", amount: "2200", rail: "Bank" },
  { name: "ZK Research Fellow", wallet: "GxK6sHpqmF9qZVzRqFJc4Tbj9aWMGHakBjVkoXvRaTKT", amount: "3500", rail: "Shielded" },
];

const short = (value: string) => `${value.slice(0, 5)}…${value.slice(-4)}`;

export default function PayrollWorkspace() {
  const [step, setStep] = useState<"recipients" | "review" | "execution" | "done">("recipients");
  const [recipients, setRecipients] = useState(initialRecipients);
  const [newRecipient, setNewRecipient] = useState({ name: "", wallet: "", amount: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { execute, status, error, proofProgress, txSignatures } = usePayrollSigner();

  const total = useMemo(() => recipients.reduce((sum, recipient) => sum + Number(recipient.amount || 0), 0), [recipients]);
  const isRunning = ["preparing", "initializing_wasm", "proving", "signing", "broadcasting", "confirming"].includes(status);
  const executePayroll = async () => {
    if (!connected) { setVisible(true); return; }
    setStep("execution");
    await execute({ org_id: "b91a045c-27eb-44c1-8409-f62506b328a6", token_symbol: "USDC", token_mint: "61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf", initiated_by: publicKey?.toBase58() || "", recipients: recipients.map(({ wallet, amount }) => ({ wallet, amount: String(Math.round(Number(amount) * 1e6)) })), rail: "tee" });
  };

  const addRecipient = () => {
    const amount = Number(newRecipient.amount);
    if (!newRecipient.name.trim() || !newRecipient.wallet.trim() || !Number.isFinite(amount) || amount <= 0) {
      setFormError("Add a name, wallet address, and a positive USDC amount.");
      return;
    }
    if (recipients.some((recipient) => recipient.wallet === newRecipient.wallet.trim())) {
      setFormError("That wallet is already in this payroll.");
      return;
    }
    setRecipients((current) => [...current, { name: newRecipient.name.trim(), wallet: newRecipient.wallet.trim(), amount: String(amount), rail: "Shielded" }]);
    setNewRecipient({ name: "", wallet: "", amount: "" });
    setFormError(null);
  };

  const importCsv = async (file: File) => {
    const rows = (await file.text()).split(/\\r?\\n/).map((row) => row.split(",").map((cell) => cell.trim())).filter((row) => row.length >= 3 && row[0]);
    const imported = rows.slice(1).map(([name, wallet, amount]) => ({ name, wallet, amount, rail: "Shielded" as const })).filter((recipient) => recipient.name && recipient.wallet && Number(recipient.amount) > 0);
    const unique = imported.filter((recipient, index) => imported.findIndex((item) => item.wallet === recipient.wallet) === index && !recipients.some((item) => item.wallet === recipient.wallet));
    if (!unique.length) { setFormError("No valid new recipients found. Use name,wallet,amount columns."); return; }
    setRecipients((current) => [...current, ...unique]);
    setFormError(null);
  };

  const statusLabel = status === "completed" ? "Confirmed" : status === "error" ? "Failed" : status === "idle" ? "Ready" : status.replaceAll("_", " ");
  useEffect(() => {
    if (status === "completed") setStep("done");
  }, [status]);

  return <main className={styles.shell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><img src="/logo.svg" alt="" /><span>Aegis <b>Ledger</b></span></div>
      <div className={styles.workspace}><span className={styles.avatar}>A</span><div><strong>Acme Protocol</strong><small>Treasury workspace</small></div><span className={styles.chevron}>⌄</span></div>
      <nav className={styles.nav}><p>OPERATIONS</p><a className={styles.active}>⌁ <span>Payroll</span></a><a>↗ <span>Transactions</span></a><a>◌ <span>Treasury</span></a><p>CONTROL</p><a>⌑ <span>Audit access</span></a><a>⚙ <span>Settings</span></a></nav>
      <div className={styles.sidebarFooter}><div className={styles.shield}>◇</div><div><strong>Private by default</strong><small>MagicBlock TEE · Devnet</small></div></div>
    </aside>

    <section className={styles.content}>
      <header className={styles.topbar}><div><span className={styles.crumb}>Payroll / New run</span><h1>{step === "done" ? "Payroll confirmed" : "Create payroll"}</h1></div><button className={styles.wallet} onClick={() => connected ? undefined : setVisible(true)}><span className={connected ? styles.connectedDot : styles.walletDot}></span>{connected ? short(publicKey?.toBase58() || "") : "Connect wallet"}<span>⌄</span></button></header>

      <div className={styles.progress}><div className={step === "recipients" ? styles.progressActive : styles.progressDone}><span>1</span><div><b>Recipients</b><small>Add your team and amounts</small></div></div><i></i><div className={step === "review" ? styles.progressActive : step === "execution" || step === "done" ? styles.progressDone : ""}><span>2</span><div><b>Review</b><small>Check before authorizing</small></div></div><i></i><div className={step === "execution" || step === "done" ? styles.progressActive : ""}><span>3</span><div><b>Execute</b><small>Verify and settle privately</small></div></div></div>

      {step === "recipients" && <div className={styles.grid}><div className={styles.mainCard}><div className={styles.cardHeader}><div><span className={styles.kicker}>PAYROLL RUN · OCTOBER 2026</span><h2>Who are you paying?</h2><p>Add recipients manually or import a CSV. Payment details stay private during execution.</p></div><input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCsv(file); event.target.value = ""; }} /><button className={styles.outline} onClick={() => fileInputRef.current?.click()}>Import CSV</button></div><div className={styles.tableHead}><span>RECIPIENT</span><span>AMOUNT</span><span>SETTLEMENT</span><span></span></div>{recipients.map((recipient, index) => <div className={styles.row} key={recipient.wallet}><div className={styles.recipient}><span className={styles.person}>{recipient.name.slice(0, 1)}</span><div><b>{recipient.name}</b><small>{short(recipient.wallet)}</small></div></div><strong className={styles.amount}>{Number(recipient.amount).toLocaleString()} <em>USDC</em></strong><span className={styles.rail}>{recipient.rail === "Bank" ? "NGN Bank" : recipient.rail === "M-Pesa" ? "KES M-Pesa" : "Shielded UTXO"}</span><button className={styles.remove} onClick={() => setRecipients(recipients.filter((_, i) => i !== index))}>×</button></div>)}<div className={styles.addRow}><input placeholder="Recipient name" value={newRecipient.name} onChange={(event) => setNewRecipient({ ...newRecipient, name: event.target.value })}/><input placeholder="Wallet address" value={newRecipient.wallet} onChange={(event) => setNewRecipient({ ...newRecipient, wallet: event.target.value })}/><input placeholder="USDC amount" inputMode="decimal" value={newRecipient.amount} onChange={(event) => setNewRecipient({ ...newRecipient, amount: event.target.value })}/><button onClick={addRecipient}>Add</button></div>{formError && <p className={styles.error} role="alert">{formError}</p>}<button className={styles.primary} disabled={!recipients.length || isRunning} onClick={() => setStep("review")}>Review payroll <span>→</span></button></div><aside className={styles.summary}><span className={styles.kicker}>RUN SUMMARY</span><div className={styles.bigNumber}>{total.toLocaleString()} <small>USDC</small></div><p>{recipients.length} recipients · estimated network fee &lt; $0.01</p><div className={styles.summaryLine}><span>Settlement</span><b>Private USDC</b></div><div className={styles.summaryLine}><span>Execution</span><b className={styles.green}>MagicBlock TEE</b></div><div className={styles.summaryLine}><span>Balance available</span><b>4,218,440 USDC</b></div><button className={styles.primary} onClick={() => setStep("review")}>Review payroll <span>→</span></button></aside></div>}

      {step === "review" && <div className={styles.reviewLayout}><div className={styles.reviewCard}><div className={styles.cardHeader}><div><span className={styles.kicker}>FINAL CHECK</span><h2>Review before you send</h2><p>Confirm every recipient and the total. Once authorized, this batch cannot be reversed.</p></div><span className={styles.readyBadge}>✓ Ready to authorize</span></div><div className={styles.reviewTotal}><span>Total payroll</span><strong>{total.toLocaleString()} <small>USDC</small></strong><span>{recipients.length} recipients · Solana Devnet</span></div>{recipients.map((recipient) => <div className={styles.reviewRow} key={recipient.wallet}><div><b>{recipient.name}</b><small>{short(recipient.wallet)} · {recipient.rail === "Shielded" ? "Shielded UTXO" : recipient.rail === "Bank" ? "NGN Bank" : "KES M-Pesa"}</small></div><strong>{Number(recipient.amount).toLocaleString()} USDC</strong></div>)}<button className={styles.back} onClick={() => setStep("recipients")}>← Edit recipients</button></div><aside className={styles.authorize}><div className={styles.lock}>◇</div><h3>Private execution</h3><p>Amounts are split into uniform notes and executed inside a hardware-secured enclave. Your spending key never leaves your wallet.</p><div className={styles.tech}><span>✓</span> No public salary amounts<div><span>✓</span> Scoped audit trail</div><div><span>✓</span> Non-custodial signing</div></div><button className={styles.primary} onClick={executePayroll}>Authorize {total.toLocaleString()} USDC <span>→</span></button></aside></div>}

      {(step === "execution" || step === "done") && <div className={styles.execution}><div className={styles.executionCard}><div className={styles.executionIcon}>{step === "done" ? "✓" : "◇"}</div><span className={styles.kicker}>{step === "done" ? "PAYROLL CONFIRMED" : "PRIVATE EXECUTION"}</span><h2>{step === "done" ? "Payroll sent" : "Executing payroll"}</h2><p>{step === "done" ? `${total.toLocaleString()} USDC settled for ${recipients.length} recipients.` : proofProgress || "Preparing confidential batch execution…"}</p><div className={styles.statusList}><div className={styles.executionMeta}><span>Status</span><b>{statusLabel}</b></div>{["Preparing payroll", "Generating privacy proof", "Awaiting wallet authorization", "Confirming settlement"].map((label, index) => <div key={label} className={styles.statusItem}><span className={step === "done" || index < (status === "preparing" ? 1 : status === "proving" ? 2 : status === "signing" ? 3 : 4) ? styles.statusComplete : styles.statusCircle}>{step === "done" || index < 1 ? "✓" : index + 1}</span><span>{label}</span><b>{step === "done" ? "Complete" : index === 0 && status !== "idle" ? "Complete" : index === 1 && status === "proving" ? "In progress" : ""}</b></div>)}</div>{error && <p className={styles.error}>{error}</p>}{step === "done" && <><div className={styles.signature}>Transaction <span>{txSignatures[0] ? short(txSignatures[0]) : "confirmed on devnet"}</span></div><button className={styles.primary} onClick={() => setStep("recipients")}>Back to payroll <span>→</span></button></>}</div></div>}
    </section>
  </main>;
}

export { initialRecipients };
