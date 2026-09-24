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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className={`${inter.className} min-h-screen flex flex-col`}>
        <header className="sticky top-0 z-50 border-b border-[rgba(140,130,255,0.14)] bg-[#0d0f22]/70 backdrop-blur-xl">
          <div className="max-w-[1200px] mx-auto px-5 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="relative p-1.5 rounded-lg bg-gradient-to-br from-[#6c5ce7] via-[#7170ff] to-[#4dd6ff] text-white shadow-[0_0_18px_rgba(108,92,231,0.55)]">
                <Activity className="w-4 h-4" />
              </div>
              <span className="text-[15px] font-medium tracking-tight">
                <span className="text-aurora">Polymarket</span>
                <span className="text-[#eef0ff]"> Pulse</span>
              </span>
            </Link>
            <Navigation />
          </div>
          {/* gradient hairline under header */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-[#6c5ce7]/60 to-transparent" />
        </header>
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-5 py-8">
          {children}
        </main>
        <footer className="border-t border-[rgba(140,130,255,0.09)] py-4">
          <p className="max-w-[1200px] mx-auto px-5 text-[11px] text-[#5d628f]">
            Data: Polymarket data-api · CLOB · gamma · Binance/OKX spot — for research use
          </p>
        </footer>
      </body>
    </html>
  );
}
