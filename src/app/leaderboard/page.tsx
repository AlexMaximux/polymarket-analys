"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";

export default function LeaderboardPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [window, setWindow] = useState("1w");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/leaderboard?window=${window}`)
      .then(res => res.json())
      .then(d => {
        setData(d || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [window]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1 flex items-center gap-3 text-white tracking-tight">
            <div className="p-1.5 rounded-lg bg-[#F59E0B]/10 text-[#F59E0B] shadow-[0_0_15px_rgba(245,158,11,0.2)]">
              <Trophy className="w-5 h-5"/>
            </div>
            Leaderboard
          </h1>
          <p className="text-sm text-slate-400 uppercase tracking-wide">Top traders by volume and PnL</p>
        </div>
        
        <div className="bg-[#111827] rounded-xl p-1.5 border border-slate-800/50 inline-flex shadow-sm">
          {["1d", "1w", "1m", "all"].map(w => (
            <button 
              key={w} 
              onClick={() => setWindow(w)} 
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                window === w 
                  ? 'bg-[#38BDF8]/10 text-[#38BDF8] shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#1E2939]'
              }`}
            >
              {w.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-[#111827] border border-slate-800/50 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0B1120]/80 backdrop-blur text-slate-400 text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-slate-800/80">
              <tr>
                <th className="px-5 py-4 w-16 text-center">Rank</th>
                <th className="px-5 py-4">User</th>
                <th className="px-5 py-4 text-right">Volume</th>
                <th className="px-5 py-4 text-right">PnL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {loading ? (
                <tr><td colSpan={4} className="p-8 text-center text-slate-500">Loading leaderboard...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={4} className="p-8 text-center text-slate-500">No data available.</td></tr>
              ) : (
                data.map((row: any, i) => (
                  <tr key={i} className="hover:bg-[#1E2939]/80 transition-colors group">
                    <td className="px-5 py-4 text-center">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                        i === 0 ? 'bg-[#F59E0B]/20 text-[#F59E0B]' :
                        i === 1 ? 'bg-slate-300/20 text-slate-300' :
                        i === 2 ? 'bg-[#D97706]/20 text-[#D97706]' :
                        'text-slate-500 bg-slate-800/50'
                      }`}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/users/${row.proxyWallet}`} className="text-[#38BDF8] hover:underline font-medium">
                        {row.userName || (row.proxyWallet.slice(0, 6) + '...' + row.proxyWallet.slice(-4))}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums text-white font-medium">${parseFloat(row.amount || 0).toLocaleString(undefined, {maximumFractionDigits:0})}</td>
                    <td className={`px-5 py-4 text-right tabular-nums font-bold ${parseFloat(row.pnl || 0) >= 0 ? 'text-[#34D399]' : 'text-[#FB7185]'}`}>
                      {parseFloat(row.pnl || 0) >= 0 ? '+' : ''}${parseFloat(row.pnl || 0).toLocaleString(undefined, {maximumFractionDigits:0})}
                    </td>
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
