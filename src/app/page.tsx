"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

const PayrollTerminal = dynamic(() => import("@/components/PayrollTerminal"), { ssr: false });
const EmployeeScanner = dynamic(() => import("@/components/EmployeeScanner"), { ssr: false });
const AuditGraph = dynamic(() => import("@/components/AuditGraph"), { ssr: false });

const NavBar = ({ view, setView }: { view: string, setView: (v: string) => void }) => {
const tabs = [
{ id: "admin", label: "Treasury", icon: "🏛" },
{ id: "employee", label: "My Payslips", icon: "👤" },
{ id: "auditor", label: "Audit Portal", icon: "🔍" },
];
return (
<nav style={{
position: "sticky", top: 0, zIndex: 100,
height: 60, display: "flex", alignItems: "center", justifyContent: "space-between",
padding: "0 32px", background: "rgba(255,255,255,0.95)",
backdropFilter: "blur(20px)", borderBottom: "1px solid #e8ebee",
}}>
<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
<div style={{
width: 30, height: 30, borderRadius: 7, background: "#08090b",
display: "flex", alignItems: "center", justifyContent: "center",
fontFamily: "Instrument Serif, serif", fontSize: 15, color: "#ffffff",
}}>Æ</div>
<span style={{ fontWeight: 600, fontSize: 14, letterSpacing: "-0.3px", color: "#08090b" }}>Aegis Ledger</span>
<div style={{
marginLeft: 8, fontFamily: "Geist Mono, monospace", fontSize: 9.5, color: "#0066ff",
background: "rgba(0,102,255,0.07)", border: "1px solid rgba(0,102,255,0.20)",
padding: "3px 9px", borderRadius: 100, display: "flex", alignItems: "center", gap: 5,
}}>
<span style={{ width: 5, height: 5, borderRadius: "50%", background: "#0066ff", display: "inline-block" }} />
CLOAK SHIELD
</div>
</div>

<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
<span style={{ fontFamily: "Geist Mono, monospace", fontSize: 9.5, color: "#bdc4ce", letterSpacing: 0.4, textTransform: "uppercase" }}>Demo: View as →</span>
<div style={{ display: "flex", gap: 4, background: "#f4f5f7", borderRadius: 10, padding: 4, border: "1px solid #e8ebee" }}>
{tabs.map(t => (
<button key={t.id}
onClick={() => setView(t.id)}
style={{
display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
borderRadius: 7,
border: view === t.id ? "1.5px solid #0066ff" : "1.5px solid transparent",
background: view === t.id ? "#ffffff" : "none",
fontSize: 12.5, fontWeight: 500,
color: view === t.id ? "#08090b" : "#64707f",
cursor: "pointer", transition: "all 0.15s",
}}>
<span style={{ fontSize: 13 }}>{t.icon}</span>
{t.label}
</button>
))}
</div>
</div>

<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
<div style={{ textAlign: "right" }}>
<div style={{ fontFamily: "Geist Mono, monospace", fontSize: 9.5, color: "#8e98a6" }}>DAO WALLET</div>
<div style={{ fontFamily: "Geist Mono, monospace", fontSize: 11, color: "#08090b", fontWeight: 500 }}>7xKt···m3F2</div>
</div>
<div style={{ width: 32, height: 32, borderRadius: 8, background: "#08090b", display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff", fontSize: 14 }}>◆</div>
</div>
</nav>
);
};

export default function DashboardPage() {
  const [view, setView] = useState("admin");

  return (
    <>
      <NavBar view={view} setView={setView} />
      {view === "admin" && <PayrollTerminal />}
      {view === "employee" && <EmployeeScanner />}
      {view === "auditor" && <AuditGraph />}
    </>
  );
}
