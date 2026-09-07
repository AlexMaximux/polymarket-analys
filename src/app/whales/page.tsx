"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw } from "lucide-react";

export default function WhalesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState("24");
  const [minBet, setMinBet] = useState("25000");

  const fetchWhales = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/whales?hours=${hours}&minBet=${minBet}`);
    setData(await res.json());
    setLoading(false);
  }, [hours, minBet]);

  useEffect(() => {
    fetchWhales();
  }, [fetchWhales]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
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
    </div>
  );
}
