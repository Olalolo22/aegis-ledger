"use client";
import dynamic from "next/dynamic";

const EmployeeScanner = dynamic(
() => import("@/components/EmployeeScanner"),
{ ssr: false }
);

export default function VerifyPage() {
return <EmployeeScanner />;
}
