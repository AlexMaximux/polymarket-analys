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
      <body className={`${inter.className} bg-[#0B1120] text-slate-200 min-h-screen flex flex-col selection:bg-[#38BDF8]/30 selection:text-white`}>
        <header className="sticky top-0 z-50 border-b border-slate-800/50 bg-[#111827]/80 backdrop-blur-md">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="p-1.5 rounded-lg bg-[#38BDF8]/10 text-[#38BDF8] group-hover:bg-[#38BDF8]/20 transition-colors">
                <Activity className="w-5 h-5" />
              </div>
              <span className="text-lg font-semibold tracking-tight text-white group-hover:text-[#38BDF8] transition-colors">
                Polymarket Pulse
              </span>
            </Link>
            <Navigation />
          </div>
        </header>
        <main className="flex-1 container mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
