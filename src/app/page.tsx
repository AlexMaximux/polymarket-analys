"use client";
import { useEffect, useState } from "react";
import { Users, Activity, TrendingUp, Clock } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

export default function Home() {
  const [stats, setStats] = useState<any>(null);
  const [feed, setFeed] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/stats').then(res => res.json()).then(setStats);
    fetch('/api/feed').then(res => res.json()).then(setFeed);
    
    const interval = setInterval(() => {
      fetch('/api/feed').then(res => res.json()).then(setFeed);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-semibold mb-1 tracking-tight text-white">Dashboard</h1>
        <p className="text-sm text-[#8a8f98] uppercase tracking-wide">Live feed and high-level metrics of tracked users.</p>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/[0.02] border border-white/[0.08] p-6 rounded-2xl flex items-center gap-5 relative overflow-hidden group hover:border-white/[0.08] transition-colors">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#38BDF8] to-transparent opacity-50"></div>
            <div className="p-3 bg-[#7170ff]/10 text-[#7170ff] rounded-xl shadow-[0_0_15px_rgba(56,189,248,0.2)] group-hover:shadow-[0_0_25px_rgba(56,189,248,0.3)] transition-shadow">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[#8a8f98] font-medium mb-1">Users Tracked</p>
              <p className="text-3xl font-bold tabular-nums text-white tracking-tight">{stats.usersTracked.toLocaleString()}</p>
            </div>
          </div>
          <div className="bg-white/[0.02] border border-white/[0.08] p-6 rounded-2xl flex items-center gap-5 relative overflow-hidden group hover:border-white/[0.08] transition-colors">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#34D399] to-transparent opacity-50"></div>
            <div className="p-3 bg-[#10b981]/10 text-[#10b981] rounded-xl shadow-[0_0_15px_rgba(52,211,153,0.2)] group-hover:shadow-[0_0_25px_rgba(52,211,153,0.3)] transition-shadow">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[#8a8f98] font-medium mb-1">Trades Stored</p>
              <p className="text-3xl font-bold tabular-nums text-white tracking-tight">{stats.tradesStored.toLocaleString()}</p>
            </div>
          </div>
          <div className="bg-white/[0.02] border border-white/[0.08] p-6 rounded-2xl flex items-center gap-5 relative overflow-hidden group hover:border-white/[0.08] transition-colors">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#F59E0B] to-transparent opacity-50"></div>
            <div className="p-3 bg-[#F59E0B]/10 text-[#F59E0B] rounded-xl shadow-[0_0_15px_rgba(245,158,11,0.2)] group-hover:shadow-[0_0_25px_rgba(245,158,11,0.3)] transition-shadow">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[#8a8f98] font-medium mb-1">Big Bet Users (24h)</p>
              <p className="text-3xl font-bold tabular-nums text-white tracking-tight">{stats.bigBetUsers24h.toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2 text-white"><Clock className="w-5 h-5 text-[#8a8f98]" /> Live Trade Feed</h2>
        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-black/30 backdrop-blur text-[#8a8f98] text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-white/[0.08]">
                <tr>
                  <th className="px-5 py-4">Time</th>
                  <th className="px-5 py-4">User</th>
                  <th className="px-5 py-4">Side</th>
                  <th className="px-5 py-4">Market</th>
                  <th className="px-5 py-4 text-right">Size</th>
                  <th className="px-5 py-4 text-right">Price</th>
                  <th className="px-5 py-4 text-right">Notional</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {feed.map(t => (
                  <tr key={t.id} className="hover:bg-white/[0.05] transition-colors group">
                    <td className="px-5 py-4 text-[#8a8f98] tabular-nums">{formatDistanceToNow(new Date(t.timestamp * 1000), { addSuffix: true })}</td>
                    <td className="px-5 py-4">
                      <Link href={`/users/${t.proxyWallet}`} className="text-[#7170ff] hover:underline font-medium">
                        {t.u_pseudonym || t.u_name || (t.proxyWallet.slice(0, 6) + '...' + t.proxyWallet.slice(-4))}
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase border ${
                        t.side === 'BUY' 
                          ? 'bg-[#10b981]/10 text-[#10b981] border-[#10b981]/25' 
                          : 'bg-[#fb7185]/10 text-[#fb7185] border-[#fb7185]/25'
                      }`}>
                        {t.side} {t.outcome}
                      </span>
                    </td>
                    <td className="px-5 py-4 max-w-[200px] truncate text-[#f7f8f8]" title={t.title}>{t.title}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-[#d0d6e0]">{t.size.toLocaleString()}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-[#d0d6e0]">${t.price.toFixed(3)}</td>
                    <td className="px-5 py-4 text-right tabular-nums font-medium text-white">${(t.size * t.price).toFixed(2)}</td>
                  </tr>
                ))}
                {feed.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-[#62666d]">No trades collected yet. Run the crawler.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
