"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ExternalLink, Wallet, Activity, TrendingUp, PieChart } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function UserProfile() {
  const params = useParams();
  const wallet = params.wallet as string;
  const [data, setData] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);

  useEffect(() => {
    fetch(`/api/users/${wallet}`).then(res => res.json()).then(setData);
    fetch(`/api/users/${wallet}/positions`).then(res => res.json()).then(setPositions);
  }, [wallet]);

  if (!data) return <div className="p-8 text-center text-slate-500 animate-in fade-in">Loading...</div>;
  if (data.error) return <div className="p-8 text-center text-[#FB7185] animate-in fade-in">{data.error}</div>;

  const { user, trades } = data;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-2 flex items-center gap-3 text-white tracking-tight">
            {user.pseudonym || user.name || "Anonymous"}
            <a href={`https://polymarket.com/profile/${wallet}`} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-[#38BDF8] transition-colors p-1 hover:bg-[#38BDF8]/10 rounded-md">
              <ExternalLink className="w-5 h-5" />
            </a>
          </h1>
          <p className="text-slate-400 flex items-center gap-2 text-sm"><Wallet className="w-4 h-4"/> <span className="font-mono text-[13px]">{wallet}</span></p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="bg-[#111827] border border-slate-800/50 p-6 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors shadow-sm">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-slate-600 to-transparent opacity-30"></div>
          <p className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1.5">Total Volume</p>
          <p className="text-2xl font-bold tabular-nums text-white tracking-tight">${user.total_notional.toLocaleString(undefined, {maximumFractionDigits:0})}</p>
        </div>
        <div className="bg-[#111827] border border-slate-800/50 p-6 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors shadow-sm">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-slate-600 to-transparent opacity-30"></div>
          <p className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1.5">Trades</p>
          <p className="text-2xl font-bold tabular-nums text-white tracking-tight">{user.trade_count}</p>
        </div>
        <div className="bg-[#111827] border border-slate-800/50 p-6 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors shadow-sm">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#34D399] to-transparent opacity-50"></div>
          <p className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1.5">Max Single Bet</p>
          <p className="text-2xl font-bold tabular-nums text-[#34D399] tracking-tight">${user.max_single_bet.toLocaleString(undefined, {maximumFractionDigits:0})}</p>
        </div>
        <div className="bg-[#111827] border border-slate-800/50 p-6 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors shadow-sm">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-slate-600 to-transparent opacity-30"></div>
          <p className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1.5">Buy / Sell Mix</p>
          <p className="text-xl font-bold mt-1 tabular-nums tracking-tight">
            <span className="text-[#34D399]">{user.buys}</span> <span className="text-slate-600 font-normal">/</span> <span className="text-[#FB7185]">{user.sells}</span>
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2 text-white"><PieChart className="w-5 h-5 text-slate-400"/> Current Positions (Live)</h2>
        <div className="bg-[#111827] border border-slate-800/50 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0B1120]/80 backdrop-blur text-slate-400 text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-slate-800/80">
                <tr>
                  <th className="px-5 py-4">Market</th>
                  <th className="px-5 py-4">Outcome</th>
                  <th className="px-5 py-4 text-right">Shares</th>
                  <th className="px-5 py-4 text-right">Avg Price</th>
                  <th className="px-5 py-4 text-right">Current Value</th>
                  <th className="px-5 py-4 text-right">PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {positions.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-500">No open positions found.</td></tr>
                ) : (
                  positions.map((p, i) => (
                    <tr key={i} className="hover:bg-[#1E2939]/80 transition-colors group">
                      <td className="px-5 py-4 max-w-[200px] truncate text-slate-200" title={p.title}>{p.title}</td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center px-2 py-0.5 bg-[#1E2939] border border-slate-700 rounded-md text-[11px] font-bold uppercase tracking-wide text-slate-300">
                          {p.outcome}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums text-slate-300">{p.size.toLocaleString()}</td>
                      <td className="px-5 py-4 text-right tabular-nums text-slate-300">${parseFloat(p.avgPrice).toFixed(3)}</td>
                      <td className="px-5 py-4 text-right tabular-nums font-medium text-white">${parseFloat(p.currentValue).toFixed(2)}</td>
                      <td className={`px-5 py-4 text-right tabular-nums font-medium ${parseFloat(p.cashPnl) >= 0 ? 'text-[#34D399]' : 'text-[#FB7185]'}`}>
                        {parseFloat(p.cashPnl) >= 0 ? '+' : ''}${parseFloat(p.cashPnl).toFixed(2)} ({parseFloat(p.percentPnl).toFixed(1)}%)
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2 text-white"><Activity className="w-5 h-5 text-slate-400"/> Recent Trades (Cached)</h2>
        <div className="bg-[#111827] border border-slate-800/50 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0B1120]/80 backdrop-blur text-slate-400 text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-slate-800/80">
                <tr>
                  <th className="px-5 py-4">Time</th>
                  <th className="px-5 py-4">Side</th>
                  <th className="px-5 py-4">Market</th>
                  <th className="px-5 py-4 text-right">Size</th>
                  <th className="px-5 py-4 text-right">Price</th>
                  <th className="px-5 py-4 text-right">Notional</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {trades.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-500">No trades found.</td></tr>
                ) : (
                  trades.map((t: any, i: number) => (
                    <tr key={t.id ?? `${t.transactionHash ?? 'x'}-${t.asset ?? 'x'}-${t.timestamp ?? i}-${i}`} className="hover:bg-[#1E2939]/80 transition-colors group">
                      <td className="px-5 py-4 text-slate-400 tabular-nums">{formatDistanceToNow(new Date(t.timestamp * 1000), { addSuffix: true })}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase border ${
                          t.side === 'BUY' 
                            ? 'bg-[#34D399]/10 text-[#34D399] border-[#34D399]/20' 
                            : 'bg-[#FB7185]/10 text-[#FB7185] border-[#FB7185]/20'
                        }`}>
                          {t.side} {t.outcome}
                        </span>
                      </td>
                      <td className="px-5 py-4 max-w-[200px] truncate text-slate-200" title={t.title}>{t.title}</td>
                      <td className="px-5 py-4 text-right tabular-nums text-slate-300">{t.size.toLocaleString()}</td>
                      <td className="px-5 py-4 text-right tabular-nums text-slate-300">${t.price.toFixed(3)}</td>
                      <td className="px-5 py-4 text-right tabular-nums font-medium text-white">${(t.size * t.price).toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
