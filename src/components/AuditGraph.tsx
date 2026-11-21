"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Node,
  Edge,
  ConnectionMode,
  BackgroundVariant,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import styles from "./AuditGraph.module.css";
import {
  useAuditorEngine,
  buildReactFlowData,
  IS_AUDIT_DEMO_MODE_ENABLED,
} from "@/hooks/useAuditorEngine";
import { IconHourglass } from "./Icons";

// Custom ReactFlow Node Components 
const glassStyle = {
  background: 'rgba(15, 16, 28, 0.75)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
  padding: '14px 18px',
  backdropFilter: 'blur(12px)',
  minWidth: 180,
  textAlign: 'center' as const,
};

function CustomTreasuryNode({ data }: { data: any }) {
  return (
    <div style={{ ...glassStyle, border: '1px solid rgba(0,184,122,0.25)', minWidth: 200 }}>
      <Handle type="source" position={Position.Bottom} style={{ background: '#00b87a', width: 8, height: 8 }} />
      <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: '#00b87a', marginBottom: 4 }}>
        {data.label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--dim)' }}>
        {data.sublabel}
      </div>
    </div>
  );
}

function CustomEncryptedNode({ data }: { data: any }) {
  return (
    <div style={{ ...glassStyle, border: '1px solid rgba(255,255,255,0.04)' }}>
      <Handle type="target" position={Position.Top} style={{ background: 'rgba(0,184,122,0.3)', width: 6, height: 6 }} />
      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ghost)', marginBottom: 2 }}>
        {data.label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ghost)', opacity: 0.5 }}>
        {data.amount}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--ghost)', opacity: 0.4, marginTop: 2 }}>
        {data.detail}
      </div>
    </div>
  );
}

function CustomDecryptedNode({ data }: { data: any }) {
  const accentColor = data.txType === 'swap' ? '#d97c0a' : '#00b87a';
  return (
    <div style={{ ...glassStyle, border: `1px solid ${accentColor}33` }}>
      <Handle type="target" position={Position.Top} style={{ background: accentColor, width: 6, height: 6 }} />
      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
        {data.realLabel || data.label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: accentColor, fontWeight: 500 }}>
        {data.realAmount || data.amount}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--mid)', marginTop: 2 }}>
        {data.realDetail || data.detail}
      </div>
    </div>
  );
}

const nodeTypes = {
  treasury: CustomTreasuryNode,
  encrypted: CustomEncryptedNode,
  decrypted: CustomDecryptedNode,
};

function AuditorLogin({
  onAuth,
}: {
  onAuth: (
    jwt: string,
    auditorPrivateKey?: string,
    customL1RpcUrl?: string,
    expectedTreasuryPubkeys?: string
  ) => void;
}) {
  const [key, setKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [l1RpcUrl, setL1RpcUrl] = useState("https://api.devnet.solana.com");
  const [expectedTreasuries, setExpectedTreasuries] = useState("");
  const [ttl, setTtl] = useState("--:--");

  const isDemoKeySelected = IS_AUDIT_DEMO_MODE_ENABLED && key === "demo-token";

  useEffect(() => {
    if (!key) { setTtl("--:--"); return; }
    if (IS_AUDIT_DEMO_MODE_ENABLED && key === "demo-token") { setTtl("Unverified demo fixture"); return; }
    setTtl("Session active");
  }, [key]);

  return (
    <div className={styles.loginWrap}>
      <div className={styles.loginBox}>
        <div className={styles.loginMark} style={{ fontFamily: "var(--serif)" }}>Æ</div>
        <span className={styles.eyebrow}>Zero-Trust Client-Side Verification</span>
        <h1 className={styles.loginTitle} style={{ fontFamily: "var(--serif)" }}>Auditor Login</h1>
        <p className={styles.loginSub}>
          Authenticate with your scoped session JWT, decrypt E2EE batch envelopes locally, and pull every anchor directly off your own Solana L1 RPC.
        </p>

        <div className={styles.loginCard}>
          <label className={styles.fieldLabel}>Scoped session JWT (from /api/audit/verify)</label>
          <input
            className={styles.keyInput}
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder={
              IS_AUDIT_DEMO_MODE_ENABLED
                ? "eyJhbGciOiJIUzI1NiIs... (or demo-token)"
                : "eyJhbGciOiJIUzI1NiIs..."
            }
          />

          {!isDemoKeySelected && (
            <>
              <label className={styles.fieldLabel} style={{ marginTop: 10, display: "block" }}>
                Auditor Private Key (Base64 PKCS#8 · Browser-only, never sent to server)
              </label>
              <input
                className={styles.keyInput}
                type="password"
                value={privateKey}
                onChange={e => setPrivateKey(e.target.value)}
                placeholder="Paste your local RSA-OAEP-256 private key..."
              />

              <label className={styles.fieldLabel} style={{ marginTop: 10, display: "block" }}>
                Auditor Solana L1 RPC Endpoint (direct browser verification)
              </label>
              <input
                className={styles.keyInput}
                value={l1RpcUrl}
                onChange={e => setL1RpcUrl(e.target.value)}
                placeholder="https://api.devnet.solana.com"
              />

              <label className={styles.fieldLabel} style={{ marginTop: 10, display: "block" }}>
                Expected Org Treasury Wallet(s) (Solana pubkeys · required to run whole-org cross-batch L1 check)
              </label>
              <input
                className={styles.keyInput}
                value={expectedTreasuries}
                onChange={e => setExpectedTreasuries(e.target.value)}
                placeholder="Enter org's declared treasury pubkey(s) (comma-separated); leave blank for per-batch view only"
              />
            </>
          )}

          <div className={styles.keyMeta}>
            {[
              { label: "Decryption", val: "100% browser-local E2EE", col: "var(--ink)" },
              { label: "TTL", val: ttl, col: "var(--amber)" },
              { label: "Trust boundary", val: "Direct browser -> Solana L1 RPC", col: "var(--dim)" },
            ].map(r => (
              <div key={r.label} className={styles.keyMetaRow}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)" }}>{r.label}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: r.col }}>{r.val}</span>
              </div>
            ))}
          </div>

          <button
            className={styles.authBtn}
            onClick={() => {
              if (key) {
                onAuth(
                  key,
                  privateKey || undefined,
                  l1RpcUrl || undefined,
                  expectedTreasuries || undefined
                );
              }
            }}
            disabled={!key || (!isDemoKeySelected && !privateKey)}
          >
            Authenticate &amp; Verify on Solana L1 →
          </button>
          {IS_AUDIT_DEMO_MODE_ENABLED && (
            <button className={styles.demoKeyBtn} onClick={() => setKey("demo-token")}>
              Use demo fixture (unverified)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AuditGraph({ accessToken }: { accessToken?: string }) {
  const [localToken, setLocalToken] = useState<string>(accessToken || "");
  const [localPrivKey, setLocalPrivKey] = useState<string | undefined>(undefined);
  const [localL1RpcUrl, setLocalL1RpcUrl] = useState<string | undefined>(undefined);
  const [localExpectedTreasuries, setLocalExpectedTreasuries] = useState<string | undefined>(undefined);
  const [authed, setAuthed] = useState(!!accessToken);
  const [decrypted, setDecrypted] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [timeline, setTimeline] = useState(100);

  const { execute, status, error, progress, scope, reconciliation, summary, transactions } = useAuditorEngine();

  useEffect(() => {
    if (authed && localToken && status === "idle") {
      execute(localToken, localPrivKey, localL1RpcUrl, localExpectedTreasuries);
    }
  }, [authed, localToken, localPrivKey, localL1RpcUrl, localExpectedTreasuries, status, execute]);

  const handleAuth = (
    key: string,
    privKey?: string,
    customL1Rpc?: string,
    expectedTreasuries?: string
  ) => {
    setLocalToken(key);
    setLocalPrivKey(privKey);
    setLocalL1RpcUrl(customL1Rpc);
    setLocalExpectedTreasuries(expectedTreasuries);
    setAuthed(true);
  };

  const handleDecryptToggle = () => {
    if (decrypted) { setDecrypted(false); return; }
    setScanning(true);
    setTimeout(() => { setDecrypted(true); setScanning(false); }, 1000);
  };

  // Timeline logic
  const quarters = ["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"];

  const selectedRangeEnd = useMemo(() => {
    if (!scope?.valid_from || !scope?.valid_until) return Date.now();
    const start = new Date(scope.valid_from).getTime();
    const end = new Date(scope.valid_until).getTime();
    return start + (end - start) * (timeline / 100);
  }, [scope, timeline]);

  const currentQ = useMemo(() => {
    const date = new Date(selectedRangeEnd);
    const month = date.getMonth();
    if (month < 3) return "Q1 2026 (Jan–Mar)";
    if (month < 6) return "Q2 2026 (Apr–Jun)";
    if (month < 9) return "Q3 2026 (Jul–Sep)";
    return "Q4 2026 (Oct–Dec)";
  }, [selectedRangeEnd]);

  const filteredTxs = useMemo(() => {
    if (!scope?.valid_from) return [];
    const start = new Date(scope.valid_from).getTime();
    return transactions.filter(tx => tx.timestamp >= start && tx.timestamp <= selectedRangeEnd);
  }, [transactions, scope, selectedRangeEnd]);

  const { nodes, edges } = useMemo(() => buildReactFlowData(filteredTxs), [filteredTxs]);

  const uniqueRecipientsCount = useMemo(() => {
    const set = new Set();
    filteredTxs.forEach(tx => { if (tx.recipient) set.add(tx.recipient); });
    return set.size;
  }, [filteredTxs]);

  const displayNodes = nodes.map(n => {
    if (n.id === "treasury") {
      return {
        ...n,
        data: {
          ...n.data,
          label: decrypted ? "Company Treasury" : "0xc8d2···3f9a",
          sublabel: decrypted ? "MagicBlock PER (L1-Anchored · Client-Side E2EE)" : "Confidential TEE Enclave State",
        }
      };
    }
    return {
      ...n,
      type: decrypted ? "decrypted" : "encrypted",
      data: {
        ...n.data,
        label: decrypted ? n.data.realLabel || n.data.label : n.data.label,
        amount: decrypted ? n.data.realAmount || n.data.amount : "HIDDEN",
        detail: decrypted ? n.data.realDetail || n.data.detail : "0xc8d2···3f9a",
      }
    };
  });

  const displayEdges = edges.map(e => ({
    ...e,
    label: decrypted ? e.label : "HIDDEN",
    animated: true,
    style: {
      stroke: decrypted ? "#00b87a" : "rgba(0,184,122,0.3)",
      strokeWidth: 2,
      strokeDasharray: decrypted ? "none" : "5 5"
    },
  }));

  const isDone = status === "complete";
  const showFlow = isDone;
  const isCrossBatchNotEvaluated =
    reconciliation?.crossBatchVerdict === "not_evaluated";
  const isCrossBatchComplete =
    reconciliation?.crossBatchVerdict === "complete";
  const isCrossBatchFinding =
    reconciliation?.crossBatchVerdict === "incomplete";

  if (!authed) return <AuditorLogin onAuth={handleAuth} />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Compliance View · {scope?.org_id || "Demo_DAO"}</span>
          <h1 className={styles.h1} style={{ fontFamily: "var(--serif)" }}>
            Treasury Ledger<br />
            <em>Read-only audit access.</em>
          </h1>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.authedPill}>
            <span
              className={styles.authedDot}
              style={
                reconciliation?.verifiedBy === "demo"
                  ? { background: "#d97706" }
                  : isCrossBatchFinding
                    ? { background: "#dc2626" }
                    : isCrossBatchNotEvaluated
                      ? { background: "#64748b" }
                      : undefined
              }
            />
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                color:
                  reconciliation?.verifiedBy === "demo"
                    ? "#d97706"
                    : isCrossBatchFinding
                      ? "#dc2626"
                      : isCrossBatchNotEvaluated
                        ? "var(--dim)"
                        : "var(--green)",
              }}
            >
              {reconciliation?.verifiedBy === "demo"
                ? "Demo fixture · UNVERIFIED (not checked on Solana L1)"
                : isCrossBatchNotEvaluated
                  ? "Per-batch view · Browser E2EE & L1 verified (cross-batch not run)"
                  : isCrossBatchFinding
                    ? "Authenticated · Browser E2EE · RECONCILIATION FINDING"
                    : "Authenticated · Browser-local E2EE · L1 reconciled"}
            </span>
          </div>
        </div>
      </div>

      {status === "error" && error && (
        <div
          style={{
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.35)",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 16,
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: "#dc2626",
          }}
        >
          <strong>AUDIT VERIFICATION FAILED:</strong> {error}
        </div>
      )}

      {reconciliation && (
        <div
          style={{
            background:
              reconciliation.verifiedBy === "demo"
                ? "rgba(217, 119, 6, 0.08)"
                : isCrossBatchNotEvaluated
                  ? "rgba(100, 116, 139, 0.08)"
                  : isCrossBatchComplete
                    ? "rgba(16, 185, 129, 0.08)"
                    : "rgba(239, 68, 68, 0.08)",
            border:
              reconciliation.verifiedBy === "demo"
                ? "1px solid rgba(217, 119, 6, 0.4)"
                : isCrossBatchNotEvaluated
                  ? "1px solid rgba(100, 116, 139, 0.35)"
                  : isCrossBatchComplete
                    ? "1px solid rgba(16, 185, 129, 0.3)"
                    : "1px solid rgba(239, 68, 68, 0.45)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            fontFamily: "var(--mono)",
            fontSize: 11,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span
              style={{
                fontWeight: 700,
                color:
                  reconciliation.verifiedBy === "demo"
                    ? "#b45309"
                    : isCrossBatchNotEvaluated
                      ? "var(--ink)"
                      : isCrossBatchComplete
                        ? "#059669"
                        : "#dc2626",
              }}
            >
              {reconciliation.verifiedBy === "demo"
                ? "⚠ SIMULATED DEMO FIXTURE — NOT VERIFIED ON SOLANA L1 OR MAGICBLOCK ER"
                : isCrossBatchNotEvaluated
                  ? "PER-BATCH VIEW ONLY — WHOLE-ORG CROSS-BATCH COMPLETENESS NOT EVALUATED"
                  : isCrossBatchComplete
                    ? `✓ CROSS-BATCH L1 COMPLETENESS VERIFIED: 0 WITHHELD BATCHES (${reconciliation.deliveredMatchedCount}/${reconciliation.totalL1AnchorsInWindow} L1 anchors reconciled across ${reconciliation.treasuryPubkeysChecked.length} declared/manifest wallet(s))`
                    : `⚠ CROSS-BATCH COMPLETENESS NOT PROVEN: ${[
                        reconciliation.undisclosedAnchors.length > 0
                          ? `${reconciliation.undisclosedAnchors.length} WITHHELD L1 ANCHOR(S)`
                          : null,
                        reconciliation.serverTreasuryListWasSubset
                          ? `${reconciliation.serverOmittedTreasuryPubkeys.length} SERVER-OMITTED TREASURY WALLET(S)`
                          : null,
                        reconciliation.scanTruncated
                          ? `L1 SCAN TRUNCATED AT ${reconciliation.scannedSignatureCount.toLocaleString()} SIGS`
                          : null,
                        reconciliation.unanchoredDeliveredRunIds.length > 0
                          ? `${reconciliation.unanchoredDeliveredRunIds.length} UNANCHORED RUN(S)`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}`}
            </span>
            <span style={{ fontSize: 10, color: "var(--dim)" }}>
              Source: {reconciliation.verifiedBy === "demo" ? "Demo Fixture (Unverified)" : `Direct Auditor L1 RPC (${reconciliation.l1RpcEndpoint})`}
              {isCrossBatchNotEvaluated
                ? ` · ER Wire Verified: ${reconciliation.erTransfersVerifiedCount}`
                : ` · Sigs Scanned: ${reconciliation.scannedSignatureCount.toLocaleString()}${reconciliation.scanTruncated ? " (TRUNCATED)" : ""} · ER Wire Verified: ${reconciliation.erTransfersVerifiedCount}`}
            </span>
          </div>
          {isCrossBatchNotEvaluated && (
            <div style={{ marginTop: 6, fontSize: 10, color: "var(--dim)" }}>
              No org treasury wallet was declared by the auditor, so no whole-org zero-omission verdict was computed. Each delivered batch below is verified per-batch directly against Solana L1 and MagicBlock ER; re-authenticate with the org&apos;s declared Solana treasury wallet(s) to run whole-org L1 anchor enumeration.
            </div>
          )}
          {reconciliation.serverTreasuryListWasSubset && (
            <div style={{ marginTop: 8, fontSize: 10, color: "#b91c1c" }}>
              • Server advisory treasury list was a strict subset and omitted wallet(s):{" "}
              {reconciliation.serverOmittedTreasuryPubkeys.join(", ")}
            </div>
          )}
          {reconciliation.scanTruncated && (
            <div style={{ marginTop: 8, fontSize: 10, color: "#b91c1c" }}>
              • Solana L1 signature enumeration hit its scan cap ({reconciliation.scannedSignatureCount.toLocaleString()} signatures scanned) before reaching the start of the audit window. Completeness cannot be proven — narrow the audit window or query with a dedicated RPC.
            </div>
          )}
          {reconciliation.undisclosedAnchors.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {reconciliation.undisclosedAnchors.map((a) => (
                <div key={a.signature} style={{ fontSize: 10, color: "#b91c1c" }}>
                  • Undisclosed L1 anchor ({a.treasuryPubkey.slice(0, 8)}...): tx {a.signature.slice(0, 14)}... · root {a.merkleRoot.slice(0, 16)}... ({a.leafCount} leaves, slot {a.slot})
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={`${styles.card} ${styles.timelineCard}`}>
        <div className={styles.timelineHeader}>
          <div>
            <span className={styles.fieldEyebrow}>Valid Period / Authorized Scope</span>
            <div className={styles.timelineTitle}>
              {scope ? "FY 2026 Audit Window" : "Loading..."}
              <span className={styles.timelineSub}>
                {scope ? ` · Jan 1, 2026 – ${new Date(selectedRangeEnd).toLocaleDateString()}` : ""}
              </span>
            </div>
          </div>
          <div className={styles.currentQBadge}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink)" }}>
              Current: {currentQ}
            </span>
          </div>
        </div>
        <input type="range" min={0} max={100} value={timeline} onChange={e => setTimeline(Number(e.target.value))} className={styles.slider} />
        <div className={styles.quarterLabels}>
          {quarters.map((q, i) => (
            <span key={q} style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: i === Math.floor((timeline / 101) * quarters.length) ? "var(--ink)" : "var(--ghost)" }}>{q}</span>
          ))}
        </div>
      </div>

      <div className={styles.graphRow}>
        <div className={styles.flowCard}>
          <div className={styles.flowCardHeader}>
            <span className={styles.fieldLabel}>Transaction Flow Graph</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mid)", marginLeft: 12 }}>
              ↓ Showing {filteredTxs.length} transactions in {currentQ.split(' ')[0]} ↓
            </span>
          </div>
          <div className={styles.flowCanvas}>
            {showFlow ? (
              <ReactFlow
                nodes={displayNodes}
                edges={displayEdges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.1 }}
                connectionMode={ConnectionMode.Loose}
                proOptions={{ hideAttribution: true }}
                style={{ filter: decrypted ? 'hue-rotate(120deg) brightness(1.2) contrast(1.1)' : 'none', transition: 'filter 0.5s ease' }}
              >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--mist)" />
                <Controls showInteractive={false} />
              </ReactFlow>
            ) : (
              <div className={styles.flowLocked}>
                <div className={styles.flowLockedInner}>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                    <IconHourglass size={24} style={{ color: "var(--mid)" }} />
                  </div>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--mid)" }}>
                    {progress || (status === "error" ? "Verification halted" : "Deciphering & verifying against Solana L1...")}
                  </span>
                </div>
              </div>
            )}
            {scanning && <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '2px', background: '#00ffcc', boxShadow: '0 0 20px #00ffcc', zIndex: 100, animation: 'scanDown 1s linear forwards' }} />}
          </div>
        </div>

        <div className={`${styles.card} ${styles.decryptPanel}`}>
          <span className={styles.fieldEyebrow}>Ledger View Mode</span>
          <div className={styles.toggleRow}>
            <div>
              <div className={styles.toggleTitle}>{decrypted ? "Decrypted Ledger" : "Public Ciphertext"}</div>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)" }}>
                {reconciliation?.verifiedBy === "demo"
                  ? "Simulated demo fixture (unverified)"
                  : decrypted
                    ? "Plaintext · L1 & ER verified"
                    : "Scrambled on-chain hashes"}
              </span>
            </div>
            <button className={styles.toggle} onClick={handleDecryptToggle} style={{ background: decrypted ? "var(--green)" : "var(--mist)" }} disabled={!isDone || scanning}>
              <span className={styles.toggleThumb} style={{ transform: decrypted ? "translateX(20px)" : "none" }} />
            </button>
          </div>
          <div className={styles.statsBlock}>
            {[
              { label: "Transactions", val: filteredTxs.length.toString() },
              { label: "Total outflow", val: decrypted ? `$${(filteredTxs.reduce((s, t) => s + Math.abs(t.netAmount), 0) / 1e6).toLocaleString()}` : "ENCRYPTED" },
              { label: "Recipients", val: decrypted ? `${uniqueRecipientsCount} wallets` : "HIDDEN" },
              {
                label: "Per-batch proof",
                val:
                  reconciliation?.verifiedBy === "demo"
                    ? "UNVERIFIED DEMO"
                    : summary?.verifiedChainAnchors
                      ? "✓ L1 Merkle + ER Wire"
                      : "Pending L1 check",
                col:
                  reconciliation?.verifiedBy === "demo"
                    ? "#d97706"
                    : summary?.verifiedChainAnchors
                      ? "var(--green)"
                      : "var(--dim)",
              },
              {
                label: "L1 sigs scanned",
                val: !reconciliation
                  ? "—"
                  : isCrossBatchNotEvaluated
                    ? "Not run"
                    : `${reconciliation.scannedSignatureCount.toLocaleString()}${reconciliation.scanTruncated ? " (TRUNCATED)" : ""}`,
                col: reconciliation?.scanTruncated ? "#dc2626" : isCrossBatchNotEvaluated ? "var(--dim)" : "var(--ink)",
              },
              {
                label: "Cross-batch verdict",
                val: !reconciliation
                  ? "Checking..."
                  : reconciliation.verifiedBy === "demo"
                    ? "N/A (Demo)"
                    : isCrossBatchNotEvaluated
                      ? "Not evaluated (no wallet declared)"
                      : isCrossBatchComplete
                        ? "0 withheld (L1 reconciled)"
                        : reconciliation.scanTruncated
                          ? "⚠ SCAN TRUNCATED"
                          : reconciliation.serverTreasuryListWasSubset
                            ? "⚠ OMITTED WALLET"
                            : `⚠ ${reconciliation.undisclosedAnchors.length} FINDING`,
                col:
                  reconciliation?.verifiedBy === "demo"
                    ? "#d97706"
                    : isCrossBatchNotEvaluated
                      ? "var(--dim)"
                      : isCrossBatchFinding
                        ? "#dc2626"
                        : "var(--green)",
              },
            ].map(s => (
              <div key={s.label} className={styles.statRow}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--dim)" }}>{s.label}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 500, color: s.col || "var(--ink)" }}>{s.val}</span>
              </div>
            ))}
          </div>
          <div className={styles.readOnlyNote}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--blue)", lineHeight: 1.6, display: "block", marginTop: 16 }}>
              Viewing key is cryptographic read-only. Decryption, Merkle completeness, ER wire checks, and L1 anchor reconciliation all run in your browser.
            </span>
          </div>
        </div>
      </div>

      <div className={`${styles.card} ${styles.tableCard}`}>
        <div className={styles.tableHeader}>
          <span className={styles.fieldLabel}>Transaction Records</span>
          <span className={`ae-badge ${decrypted ? "ae-badge-green" : "ae-badge-ghost"}`}>{decrypted ? "DECRYPTED VIEW" : "CIPHERTEXT VIEW"}</span>
        </div>
        <div className={styles.tableHead}>
          {["Date / Block", "From", "To", "Amount", "Type"].map(h => (
            <span key={h} style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--dim)", textTransform: "uppercase" }}>{h}</span>
          ))}
        </div>
        {filteredTxs.map((tx, i) => (
          <div key={i} className={styles.tableRow} style={{ borderBottom: i < filteredTxs.length - 1 ? "1px solid var(--mist)" : "none" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{new Date(tx.timestamp).toLocaleDateString()}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}>{decrypted ? "DaoTreasury.sol" : "0xc8d2···3f9a"}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{decrypted ? (tx.recipient ? `${tx.recipient.slice(0, 4)}···${tx.recipient.slice(-4)}` : "Unknown") : `Commitment[${tx.commitment?.slice(0, 8) || "..."}]`}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, fontWeight: 500 }}>{decrypted ? `$${(Math.abs(tx.netAmount) / 1e6).toLocaleString()}` : "HIDDEN"}</span>
            <span className={`ae-badge ${decrypted ? (tx.txType === "withdrawal" ? "ae-badge-blue" : "ae-badge-amber") : "ae-badge-ghost"}`}>{decrypted ? (tx.txType === "withdrawal" ? "Payroll" : "Transfer") : "0x01"}</span>
          </div>
        ))}
      </div>
      <style>{`@keyframes scanDown { from { top: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } to { top: 100%; opacity: 0; } }`}</style>
    </div>
  );
}
