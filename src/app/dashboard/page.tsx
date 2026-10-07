"use client";

import dynamic from "next/dynamic";

const PayrollWorkspace = dynamic(() => import("@/components/PayrollWorkspace"), { ssr: false });

export default function DashboardPage() {
  return <PayrollWorkspace />;
}
