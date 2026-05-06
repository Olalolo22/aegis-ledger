import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import localFont from "next/font/local";
import dynamic from "next/dynamic";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  weight: ["400"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-serif",
});

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-sans",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-mono",
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
    <html lang="en" className={`${instrumentSerif.variable} ${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
