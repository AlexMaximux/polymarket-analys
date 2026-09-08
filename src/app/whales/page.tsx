"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Target, Loader2 } from "lucide-react";

export default function WhalesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState("24");
  const [minBet, setMinBet] = useState("25000");

  // win-rate section state (independent filters)
  const [wrData, setWrData] = useState<any>(null);
  const [wrLoading, setWrLoading] = useState(false);
  const [wrHours, setWrHours] = useState("24");
  const [wrRate, setWrRate] = useState("80");
  const [wrMinMarkets, setWrMinMarkets] = useState("3");
  const [wrMinVolume, setWrMinVolume] = useState("0");
  const [wrError, setWrError] = useState("");

  const fetchWhales = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/whales?hours=${hours}&minBet=${minBet}`);
    setData(await res.json());
    setLoading(false);
  }, [hours, minBet]);

  useEffect(() => {
    fetchWhales();
  }, [fetchWhales]);

  const fetchWinRate = useCallback(async () => {
    setWrLoading(true); setWrError("");
    try {
      const res = await fetch(`/api/winrate?hours=${wrHours}&minRate=${wrRate}&minMarkets=${wrMinMarkets}`);
      const d = await res.json();
      if (!res.ok) setWrError(d.error || "failed");
      setWrData(d);
    } catch {
      setWrError("request failed");
    } finally {
      setWrLoading(false);
    }
  }, [wrHours, wrRate, wrMinMarkets]);

  useEffect(() => {
    fetchWinRate();
  }, [fetchWinRate]);

  const wrRows = (wrData?.rows || []).filter((r: any) =>
    (parseFloat(wrMinVolume) || 0) <= 0 ? true : r.invested >= (parseFloat(wrMinVolume) || 0)
  );

  return (
    <div className="space-y-8 rise-in">
      {/* ================= NEW WHALES ================= */}
      <div>
        <h1 className="text-2xl font-semibold mb-1 tracking-tight text-white">New Whales</h1>
        <p className="text-sm text-[#8b91c5] uppercase tracking-wide">
          Wallets whose FIRST-EVER on-chain trade happened recently — with a single bet above the threshold
        </p>
        <p className="text-xs text-[#5d628f] mt-1">
          First trade = verified from full Polymarket activity history, not just when our crawler saw them.
        </p>
      </div>

      <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] p-5 rounded-2xl flex flex-wrap gap-4 items-end shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-slate-700/50 to-transparent"></div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[#8b91c5] mb-1.5">First trade within</label>
          <select value={hours} onChange={e => setHours(e.target.value)} className="bg-white/[0.08] text-white border border-[rgba(140,130,255,0.15)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#a99cff] focus:ring-1 focus:ring-[#38BDF8] transition-shadow">
            <option value="1">Last hour</option>
            <option value="6">Last 6 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="72">Last 3 days</option>
            <option value="168">Last 7 days</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[#8b91c5] mb-1.5">Min single bet ($)</label>
          <input type="number" value={minBet} onChange={e => setMinBet(e.target.value)} className="w-36 bg-white/[0.08] text-white border border-[rgba(140,130,255,0.15)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#a99cff] focus:ring-1 focus:ring-[#38BDF8] transition-shadow" />
        </div>
        <button onClick={fetchWhales} className="flex items-center gap-2 bg-white/[0.08] hover:bg-[#8b7cff]/12 border border-[rgba(140,130,255,0.15)] hover:border-[#38BDF8]/40 text-[#eef0ff] rounded-xl px-4 py-2 text-sm font-medium transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
        {data && (
          <p className="text-xs text-[#5d628f] ml-auto">
            Scanned: <span className="text-[#c3c8ee] font-medium">{(data.checked ?? 0).toLocaleString()}</span> wallets ·
            pending: <span className="text-[#c3c8ee] font-medium">{(data.pending ?? 0).toLocaleString()}</span>
          </p>
        )}
      </div>

      <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0a0b1e]/70 backdrop-blur text-[#8b91c5] text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-[rgba(140,130,255,0.15)]">
              <tr>
                <th className="px-5 py-4">User</th>
                <th className="px-5 py-4">First-Ever Trade</th>
                <th className="px-5 py-4 text-right">First Bet Size</th>
                <th className="px-5 py-4 text-right">Max Single Bet</th>
                <th className="px-5 py-4 text-right">Total Volume</th>
                <th className="px-5 py-4 text-right">Trades</th>
                <th className="px-5 py-4">Last Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(140,130,255,0.11)]">
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-[#5d628f]">Loading...</td></tr>
              ) : !data?.whales?.length ? (
                <tr><td colSpan={7} className="p-8 text-center text-[#5d628f]">
                  No new whales found yet — the backfill worker is still scanning wallet histories (see pending count above).
                </td></tr>
              ) : (
                data.whales.map((w: any) => (
                  <tr key={w.wallet} className="hover:bg-white/[0.08] transition-colors group">
                    <td className="px-5 py-4">
                      <Link href={`/users/${w.wallet}`} className="text-[#a99cff] hover:underline font-medium">
                        {w.pseudonym || w.name || (w.wallet.slice(0, 6) + "..." + w.wallet.slice(-4))}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-[#c3c8ee] tabular-nums">{formatDistanceToNow(new Date(w.true_first_trade_at * 1000), { addSuffix: true })}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-white font-medium">${(w.true_first_trade_size ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-[#2ce5a7] font-medium">${(w.max_single_bet ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-[#c3c8ee]">${(w.total_notional ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-[#c3c8ee]">{(w.trade_count ?? 0).toLocaleString()}</td>
                    <td className="px-5 py-4 text-[#8b91c5]">{formatDistanceToNow(new Date(w.last_active * 1000), { addSuffix: true })}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= WIN-RATE HUNTERS ================= */}
      <div>
        <h2 className="text-2xl font-semibold mb-1 tracking-tight text-white flex items-center gap-2">
          <Target className="w-6 h-6 text-[#2ce5a7]" /> Win-Rate Hunters
        </h2>
        <p className="text-sm text-[#8b91c5] uppercase tracking-wide">
          Wallets whose per-market win rate over the selected window is at least the threshold — markets they actually ENTERED in the window
        </p>
        <p className="text-xs text-[#5d628f] mt-1">
          A market counts as won when the wallet's realized result on it is positive. Positions opened before the window are excluded.
        </p>
      </div>

      <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] p-5 rounded-2xl flex flex-wrap gap-4 items-end shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#34D399]/40 to-transparent"></div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[#8b91c5] mb-1.5">Window</label>
          <select value={wrHours} onChange={e => setWrHours(e.target.value)} className="bg-white/[0.08] text-white border border-[rgba(140,130,255,0.15)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#34D399]">
            <option value="6">Last 6 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="72">Last 3 days</option>
            <option value="168">Last 7 days</option>
            <option value="720">Last 30 days</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[#8b91c5] mb-1.5">Min win rate (%)</label>
          <input type="number" value={wrRate} onChange={e => setWrRate(e.target.value)} min="0" max="100"
            className="w-28 bg-white/[0.08] text-white border border-[rgba(140,130,255,0.15)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#34D399]" />
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[#8b91c5] mb-1.5">Min markets</label>
          <input type="number" value={wrMinMarkets} onChange={e => setWrMinMarkets(e.target.value)} min="1"
            className="w-28 bg-white/[0.08] text-white border border-[rgba(140,130,255,0.15)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#34D399]" />
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[#8b91c5] mb-1.5">Min invested ($)</label>
          <input type="number" value={wrMinVolume} onChange={e => setWrMinVolume(e.target.value)} min="0"
            className="w-28 bg-white/[0.08] text-white border border-[rgba(140,130,255,0.15)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#34D399]" />
        </div>
        <button onClick={fetchWinRate} className="flex items-center gap-2 bg-white/[0.08] hover:bg-[#2ce5a7]/10 border border-[rgba(140,130,255,0.15)] hover:border-[#2ce5a7]/40 text-[#eef0ff] rounded-xl px-4 py-2 text-sm font-medium transition-colors">
          <RefreshCw className={`w-4 h-4 ${wrLoading ? "animate-spin" : ""}`} /> Refresh
        </button>
        {wrData && (
          <p className="text-xs text-[#5d628f] ml-auto">
            Scanned: <span className="text-[#c3c8ee] font-medium">{(wrData.scanned ?? 0).toLocaleString()}</span> ·
            qualifying: <span className="text-[#2ce5a7] font-medium">{(wrData.qualifying ?? 0).toLocaleString()}</span>
          </p>
        )}
        {wrError && <p className="text-[#ff6b9d] text-xs">{wrError}</p>}
      </div>

      <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0a0b1e]/70 backdrop-blur text-[#8b91c5] text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-[rgba(140,130,255,0.15)]">
              <tr>
                <th className="px-5 py-4">User</th>
                <th className="px-5 py-4 text-right">Win Rate</th>
                <th className="px-5 py-4 text-right">W / L</th>
                <th className="px-5 py-4 text-right">Invested</th>
                <th className="px-5 py-4 text-right">Net PnL</th>
                <th className="px-5 py-4">Last Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(140,130,255,0.11)]">
              {wrLoading ? (
                <tr><td colSpan={6} className="p-8 text-center text-[#5d628f]"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Scanning ledgers (up to ~1 min on first load)…</td></tr>
              ) : wrRows.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-[#5d628f]">No wallets match — try lowering the win rate or market count.</td></tr>
              ) : (
                wrRows.map((r: any) => (
                  <tr key={r.wallet} className="hover:bg-white/[0.08] transition-colors group">
                    <td className="px-5 py-4">
                      <Link href={`/users/${r.wallet}`} className="text-[#a99cff] hover:underline font-medium">
                        {r.pseudonym || (r.wallet.slice(0, 6) + "..." + r.wallet.slice(-4))}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                        r.winRate >= 90 ? "bg-[#2ce5a7]/10 text-[#2ce5a7] border-[#2ce5a7]/35"
                        : r.winRate >= 80 ? "bg-[#FBBF24]/10 text-[#ffc94d] border-[#FBBF24]/30"
                        : "bg-slate-800 text-[#c3c8ee] border-[rgba(140,130,255,0.15)]"}`}>
                        {r.winRate}%
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums">
                      <span className="text-[#2ce5a7]">{r.wins}W</span>
                      <span className="text-[#5d628f]"> / </span>
                      <span className="text-[#ff6b9d]">{r.losses}L</span>
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums text-[#c3c8ee]">${(r.invested ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className={`px-5 py-4 text-right tabular-nums font-medium ${(r.pnl ?? 0) >= 0 ? "text-[#2ce5a7]" : "text-[#ff6b9d]"}`}>
                      {(r.pnl ?? 0) >= 0 ? "+" : ""}${(r.pnl ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-5 py-4 text-[#8b91c5]">{formatDistanceToNow(new Date(r.lastActive * 1000), { addSuffix: true })}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
