import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Activity } from "lucide-react";
import { Navigation } from "@/components/Navigation";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Polymarket Pulse",
  description: "Track and analyze Polymarket user activity",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} min-h-screen flex flex-col`}>
        <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#0f1011]/85 backdrop-blur-xl">
          <div className="max-w-[1200px] mx-auto px-5 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="p-1.5 rounded-md bg-[#5e6ad2] text-white shadow-[0_0_16px_rgba(94,106,210,0.5)]">
                <Activity className="w-4 h-4" />
              </div>
              <span className="text-[15px] font-medium tracking-tight text-[#f7f8f8]">
                Polymarket Pulse
              </span>
            </Link>
            <Navigation />
          </div>
        </header>
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-5 py-8">
          {children}
        </main>
        <footer className="border-t border-white/[0.04] py-4">
          <p className="max-w-[1200px] mx-auto px-5 text-[11px] text-[#62666d]">
            Data: Polymarket data-api · CLOB · gamma · Binance/OKX spot — for research use
          </p>
        </footer>
      </body>
    </html>
  );
}
