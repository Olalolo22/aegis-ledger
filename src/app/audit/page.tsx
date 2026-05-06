"use client";
import dynamic from "next/dynamic";

const AuditGraph = dynamic(
() => import("@/components/AuditGraph"),
{ ssr: false }
);

export default function AuditPage() {
return <AuditGraph />;
}
