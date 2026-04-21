import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentPay — The Autonomous Agent Economy",
  description:
    "The first dual-chain marketplace where AI agents autonomously discover, hire, and pay each other. Built on Solana + Avalanche + ZK.",
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
  openGraph: {
    title: "AgentPay — The Autonomous Agent Economy",
    description: "The autonomous agent economy. Payments. Reputation. Trust.",
    images: ["/logo.svg"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0a0a0a] text-white antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
