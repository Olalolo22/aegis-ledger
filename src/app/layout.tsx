import type { Metadata, Viewport } from "next";
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

// Default styles for the wallet modal
import "@solana/wallet-adapter-react-ui/styles.css";

// Dynamic import — WalletProvider needs window (no SSR)
const WalletProvider = dynamic(
  () => import("@/components/WalletProvider"),
  { ssr: false }
);

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: "Aegis Ledger | Confidential Payroll & Treasury Platform",
  description:
    "Confidential payroll disbursements and treasury coordination on Solana. Sub-second batch execution powered by MagicBlock Private Ephemeral Rollups (Intel TDX Enclave) with client-side verification and selective auditability.",
  keywords: [
    "Solana",
    "payroll",
    "confidential",
    "privacy",
    "MagicBlock",
    "TEE",
    "Intel TDX",
    "Ephemeral Rollup",
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
