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
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* ================= NEW WHALES ================= */}
      <div>
        <h1 className="text-2xl font-semibold mb-1 tracking-tight text-white">New Whales</h1>
        <p className="text-sm text-slate-400 uppercase tracking-wide">
          Wallets whose FIRST-EVER on-chain trade happened recently — with a single bet above the threshold
        </p>
        <p className="text-xs text-slate-500 mt-1">
          First trade = verified from full Polymarket activity history, not just when our crawler saw them.
        </p>
      </div>

      <div className="bg-[#111827] border border-slate-800/50 p-5 rounded-2xl flex flex-wrap gap-4 items-end shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-slate-700/50 to-transparent"></div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">First trade within</label>
          <select value={hours} onChange={e => setHours(e.target.value)} className="bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#38BDF8] focus:ring-1 focus:ring-[#38BDF8] transition-shadow">
            <option value="1">Last hour</option>
            <option value="6">Last 6 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="72">Last 3 days</option>
            <option value="168">Last 7 days</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">Min single bet ($)</label>
          <input type="number" value={minBet} onChange={e => setMinBet(e.target.value)} className="w-36 bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#38BDF8] focus:ring-1 focus:ring-[#38BDF8] transition-shadow" />
        </div>
        <button onClick={fetchWhales} className="flex items-center gap-2 bg-[#1E2939] hover:bg-[#38BDF8]/10 border border-slate-700 hover:border-[#38BDF8]/40 text-slate-200 rounded-xl px-4 py-2 text-sm font-medium transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
        {data && (
          <p className="text-xs text-slate-500 ml-auto">
            Scanned: <span className="text-slate-300 font-medium">{(data.checked ?? 0).toLocaleString()}</span> wallets ·
            pending: <span className="text-slate-300 font-medium">{(data.pending ?? 0).toLocaleString()}</span>
          </p>
        )}
      </div>

      <div className="bg-[#111827] border border-slate-800/50 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0B1120]/80 backdrop-blur text-slate-400 text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-slate-800/80">
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
            <tbody className="divide-y divide-slate-800/50">
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">Loading...</td></tr>
              ) : !data?.whales?.length ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">
                  No new whales found yet — the backfill worker is still scanning wallet histories (see pending count above).
                </td></tr>
              ) : (
                data.whales.map((w: any) => (
                  <tr key={w.wallet} className="hover:bg-[#1E2939]/80 transition-colors group">
                    <td className="px-5 py-4">
                      <Link href={`/users/${w.wallet}`} className="text-[#38BDF8] hover:underline font-medium">
                        {w.pseudonym || w.name || (w.wallet.slice(0, 6) + "..." + w.wallet.slice(-4))}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-slate-300 tabular-nums">{formatDistanceToNow(new Date(w.true_first_trade_at * 1000), { addSuffix: true })}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-white font-medium">${(w.true_first_trade_size ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-[#34D399] font-medium">${(w.max_single_bet ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-300">${(w.total_notional ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-300">{(w.trade_count ?? 0).toLocaleString()}</td>
                    <td className="px-5 py-4 text-slate-400">{formatDistanceToNow(new Date(w.last_active * 1000), { addSuffix: true })}</td>
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
          <Target className="w-6 h-6 text-[#34D399]" /> Win-Rate Hunters
        </h2>
        <p className="text-sm text-slate-400 uppercase tracking-wide">
          Wallets whose per-market win rate over the selected window is at least the threshold — markets they actually ENTERED in the window
        </p>
        <p className="text-xs text-slate-500 mt-1">
          A market counts as won when the wallet's realized result on it is positive. Positions opened before the window are excluded.
        </p>
      </div>

      <div className="bg-[#111827] border border-slate-800/50 p-5 rounded-2xl flex flex-wrap gap-4 items-end shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#34D399]/40 to-transparent"></div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">Window</label>
          <select value={wrHours} onChange={e => setWrHours(e.target.value)} className="bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#34D399]">
            <option value="6">Last 6 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="72">Last 3 days</option>
            <option value="168">Last 7 days</option>
            <option value="720">Last 30 days</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">Min win rate (%)</label>
          <input type="number" value={wrRate} onChange={e => setWrRate(e.target.value)} min="0" max="100"
            className="w-28 bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#34D399]" />
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">Min markets</label>
          <input type="number" value={wrMinMarkets} onChange={e => setWrMinMarkets(e.target.value)} min="1"
            className="w-28 bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#34D399]" />
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">Min invested ($)</label>
          <input type="number" value={wrMinVolume} onChange={e => setWrMinVolume(e.target.value)} min="0"
            className="w-28 bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#34D399]" />
        </div>
        <button onClick={fetchWinRate} className="flex items-center gap-2 bg-[#1E2939] hover:bg-[#34D399]/10 border border-slate-700 hover:border-[#34D399]/40 text-slate-200 rounded-xl px-4 py-2 text-sm font-medium transition-colors">
          <RefreshCw className={`w-4 h-4 ${wrLoading ? "animate-spin" : ""}`} /> Refresh
        </button>
        {wrData && (
          <p className="text-xs text-slate-500 ml-auto">
            Scanned: <span className="text-slate-300 font-medium">{(wrData.scanned ?? 0).toLocaleString()}</span> ·
            qualifying: <span className="text-[#34D399] font-medium">{(wrData.qualifying ?? 0).toLocaleString()}</span>
          </p>
        )}
        {wrError && <p className="text-[#FB7185] text-xs">{wrError}</p>}
      </div>

      <div className="bg-[#111827] border border-slate-800/50 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0B1120]/80 backdrop-blur text-slate-400 text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-slate-800/80">
              <tr>
                <th className="px-5 py-4">User</th>
                <th className="px-5 py-4 text-right">Win Rate</th>
                <th className="px-5 py-4 text-right">W / L</th>
                <th className="px-5 py-4 text-right">Invested</th>
                <th className="px-5 py-4 text-right">Net PnL</th>
                <th className="px-5 py-4">Last Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {wrLoading ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Scanning ledgers (up to ~1 min on first load)…</td></tr>
              ) : wrRows.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">No wallets match — try lowering the win rate or market count.</td></tr>
              ) : (
                wrRows.map((r: any) => (
                  <tr key={r.wallet} className="hover:bg-[#1E2939]/80 transition-colors group">
                    <td className="px-5 py-4">
                      <Link href={`/users/${r.wallet}`} className="text-[#38BDF8] hover:underline font-medium">
                        {r.pseudonym || (r.wallet.slice(0, 6) + "..." + r.wallet.slice(-4))}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                        r.winRate >= 90 ? "bg-[#34D399]/10 text-[#34D399] border-[#34D399]/30"
                        : r.winRate >= 80 ? "bg-[#FBBF24]/10 text-[#FBBF24] border-[#FBBF24]/30"
                        : "bg-slate-800 text-slate-300 border-slate-700"}`}>
                        {r.winRate}%
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums">
                      <span className="text-[#34D399]">{r.wins}W</span>
                      <span className="text-slate-600"> / </span>
                      <span className="text-[#FB7185]">{r.losses}L</span>
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums text-slate-300">${(r.invested ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className={`px-5 py-4 text-right tabular-nums font-medium ${(r.pnl ?? 0) >= 0 ? "text-[#34D399]" : "text-[#FB7185]"}`}>
                      {(r.pnl ?? 0) >= 0 ? "+" : ""}${(r.pnl ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-5 py-4 text-slate-400">{formatDistanceToNow(new Date(r.lastActive * 1000), { addSuffix: true })}</td>
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
