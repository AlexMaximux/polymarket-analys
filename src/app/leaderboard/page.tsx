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
    <div className="space-y-6 rise-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1 flex items-center gap-3 text-white tracking-tight">
            <div className="p-1.5 rounded-lg bg-[#F59E0B]/10 text-[#F59E0B] shadow-[0_0_15px_rgba(245,158,11,0.2)]">
              <Trophy className="w-5 h-5"/>
            </div>
            Leaderboard
          </h1>
          <p className="text-sm text-[#8b91c5] uppercase tracking-wide">Top traders by volume and PnL</p>
        </div>
        
        <div className="bg-white/[0.08] rounded-xl p-1.5 border border-[rgba(140,130,255,0.15)] inline-flex shadow-sm">
          {["1d", "1w", "1m", "all"].map(w => (
            <button 
              key={w} 
              onClick={() => setWindow(w)} 
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                window === w 
                  ? 'bg-[#8b7cff]/12 text-[#a99cff] shadow-sm' 
                  : 'text-[#8b91c5] hover:text-[#eef0ff] hover:bg-white/[0.08]'
              }`}
            >
              {w.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0a0b1e]/70 backdrop-blur text-[#8b91c5] text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-[rgba(140,130,255,0.15)]">
              <tr>
                <th className="px-5 py-4 w-16 text-center">Rank</th>
                <th className="px-5 py-4">User</th>
                <th className="px-5 py-4 text-right">Volume</th>
                <th className="px-5 py-4 text-right">PnL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(140,130,255,0.11)]">
              {loading ? (
                <tr><td colSpan={4} className="p-8 text-center text-[#5d628f]">Loading leaderboard...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={4} className="p-8 text-center text-[#5d628f]">No data available.</td></tr>
              ) : (
                data.map((row: any, i) => (
                  <tr key={i} className="hover:bg-white/[0.08] transition-colors group">
                    <td className="px-5 py-4 text-center">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                        i === 0 ? 'bg-[#F59E0B]/20 text-[#F59E0B]' :
                        i === 1 ? 'bg-slate-300/20 text-[#c3c8ee]' :
                        i === 2 ? 'bg-[#D97706]/20 text-[#D97706]' :
                        'text-[#5d628f] bg-slate-800/50'
                      }`}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/users/${row.proxyWallet}`} className="text-[#a99cff] hover:underline font-medium">
                        {row.userName || (row.proxyWallet.slice(0, 6) + '...' + row.proxyWallet.slice(-4))}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums text-white font-medium">${parseFloat(row.amount || 0).toLocaleString(undefined, {maximumFractionDigits:0})}</td>
                    <td className={`px-5 py-4 text-right tabular-nums font-bold ${parseFloat(row.pnl || 0) >= 0 ? 'text-[#2ce5a7]' : 'text-[#ff6b9d]'}`}>
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
