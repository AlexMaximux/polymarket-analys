"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Bot } from "lucide-react";
import { card } from "./format";
import type { BotStatus } from "@/lib/bot/types";

const money = (n: number) => `$${n.toFixed(2)}`;

export function BotStatusStrip() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/bot/trade", { cache: "no-store" })
        .then(r => r.json())
        .then(d => {
          if (stop) return;
          if (d.error) setError(d.error);
          else {
            setStatus(d);
            setError(null);
          }
        })
        .catch(() => {});
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 10_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  if (error) {
    return (
      <section className={`${card} px-5 py-3 flex items-center gap-2 text-sm text-[#e5787f]`}>
        <AlertTriangle className="w-4 h-4" /> Trading bot status unavailable: {error}
      </section>
    );
  }
  if (!status) return null;

  const live = status.enabled && !status.simulationMode;
  return (
    <section className={`${card} px-5 py-3 ${live ? "border-[#e5787f]/40 bg-[#e5787f]/[0.03]" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2 w-40">
          <Bot className="w-4 h-4 text-[#9fb4ee]" />
          <span className="text-sm text-[#e8e8e4]">Trading Bot</span>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full border ${
            status.enabled ? "bg-[#5fbf9a]/10 text-[#5fbf9a] border-[#5fbf9a]/30" : "bg-white/[0.04] text-[#9a9ca3] border-[rgba(190,190,200,0.15)]"
          }`}
        >
          {status.enabled ? "ENABLED" : "DISABLED (kill switch off)"}
        </span>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full border ${
            status.simulationMode
              ? "bg-[#d4b063]/10 text-[#d4b063] border-[#d4b063]/30"
              : "bg-[#e5787f]/10 text-[#e5787f] border-[#e5787f]/30"
          }`}
        >
          {status.simulationMode ? "SIMULATION" : "LIVE — real money"}
        </span>
        <span className="text-xs text-[#9a9ca3] tabular-nums">
          Wallet:{" "}
          {status.walletAddress ? (
            <span className="font-mono text-[#bdbdb8]" title={status.walletAddress}>
              {status.walletAddress.slice(0, 6)}…{status.walletAddress.slice(-4)}
            </span>
          ) : (
            <span className="text-[#e5787f]">not configured</span>
          )}
        </span>
        <span className="text-xs text-[#9a9ca3] tabular-nums">
          Spent: <span className="text-[#e8e8e4]">{money(status.totalSpent)}</span> / {money(status.maxTotalBudget)}
          <span className="text-[#73757c]"> · {money(status.perTradeAmount)}/trade</span>
        </span>
        {status.activeMarket && (
          <span className="text-xs text-[#9a9ca3] truncate max-w-[260px]" title={status.activeMarket.title}>
            Market: <span className="text-[#bdbdb8]">{status.activeMarket.title}</span>
          </span>
        )}
      </div>
      {status.recentTrades.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/[0.06] text-[11px] text-[#73757c] space-x-3">
          {status.recentTrades.slice(0, 3).map(t => (
            <span key={t.id} className="tabular-nums">
              {t.status === "FILLED" ? "✅" : t.status === "SIMULATED" ? "🟡" : "❌"} {t.symbol}/{t.outcome} {money(t.amount_usd)}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
