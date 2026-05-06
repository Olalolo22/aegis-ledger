"use client";
import dynamic from "next/dynamic";

const PrivateSwapPanel = dynamic(
() => import("@/components/PrivateSwapPanel"),
{ ssr: false }
);

export default function SwapPage() {
return <PrivateSwapPanel />;
}
