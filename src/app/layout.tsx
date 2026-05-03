import type { Metadata } from "next";
import localFont from "next/font/local";
import dynamic from "next/dynamic";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// Dynamic import — WalletProvider needs window (no SSR)
const WalletProvider = dynamic(
  () => import("@/components/WalletProvider"),
  { ssr: false }
);

export const metadata: Metadata = {
  title: "Aegis Ledger | Private Payroll & Treasury Platform",
  description:
    "Zero-knowledge payroll disbursements on Solana. Execute batch USDC payrolls with hidden amounts and addresses, powered by Cloak Protocol.",
  keywords: [
    "Solana",
    "payroll",
    "zero-knowledge",
    "privacy",
    "Cloak",
    "USDC",
    "treasury",
    "DAO",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
