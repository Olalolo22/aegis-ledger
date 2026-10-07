"use client";

import dynamic from "next/dynamic";
import AegisHeader from "@/components/AegisHeader";

const PayrollWorkflow = dynamic(() => import("@/components/PayrollWorkflow"), {
  ssr: false,
});

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#090a0f",
        color: "#f8fafc",
      }}
    >
      <AegisHeader />
      <PayrollWorkflow />
    </main>
  );
}
