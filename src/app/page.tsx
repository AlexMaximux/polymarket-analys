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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-1 tracking-tight text-white">Dashboard</h1>
        <p className="text-sm text-[#9a9ca3] tracking-wide">Live feed and high-level metrics of tracked users.</p>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/[0.08] border border-[rgba(190,190,200,0.15)] p-6 rounded-2xl flex items-center gap-5 relative overflow-hidden group hover:border-[rgba(190,190,200,0.15)] transition-colors">
            <div className="p-3 bg-[#8ea4e8]/12 text-[#9fb4ee] rounded-xl transition-shadow">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-[#9a9ca3] font-medium mb-1">Users Tracked</p>
              <p className="text-3xl font-bold tabular-nums text-white tracking-tight">{stats.usersTracked.toLocaleString()}</p>
            </div>
          </div>
          <div className="bg-white/[0.08] border border-[rgba(190,190,200,0.15)] p-6 rounded-2xl flex items-center gap-5 relative overflow-hidden group hover:border-[rgba(190,190,200,0.15)] transition-colors">
            <div className="p-3 bg-[#5fbf9a]/10 text-[#5fbf9a] rounded-xl transition-shadow">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-[#9a9ca3] font-medium mb-1">Trades Stored</p>
              <p className="text-3xl font-bold tabular-nums text-white tracking-tight">{stats.tradesStored.toLocaleString()}</p>
            </div>
          </div>
          <div className="bg-white/[0.08] border border-[rgba(190,190,200,0.15)] p-6 rounded-2xl flex items-center gap-5 relative overflow-hidden group hover:border-[rgba(190,190,200,0.15)] transition-colors">
            <div className="p-3 bg-[#d4a24f]/10 text-[#d4a24f] rounded-xl transition-shadow">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-[#9a9ca3] font-medium mb-1">Big Bet Users (24h)</p>
              <p className="text-3xl font-bold tabular-nums text-white tracking-tight">{stats.bigBetUsers24h.toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2 text-white"><Clock className="w-5 h-5 text-[#9a9ca3]" /> Live Trade Feed</h2>
        <div className="bg-white/[0.08] border border-[rgba(190,190,200,0.15)] rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#131418] text-[#9a9ca3] text-xs font-medium sticky top-0 z-10 border-b border-[rgba(190,190,200,0.15)]">
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
              <tbody className="divide-y divide-[rgba(190,190,200,0.11)]">
                {feed.map(t => (
                  <tr key={t.id} className="hover:bg-white/[0.08] transition-colors group">
                    <td className="px-5 py-4 text-[#9a9ca3] tabular-nums">{formatDistanceToNow(new Date(t.timestamp * 1000), { addSuffix: true })}</td>
                    <td className="px-5 py-4">
                      <Link href={`/users/${t.proxyWallet}`} className="text-[#9fb4ee] hover:underline font-medium">
                        {t.u_pseudonym || t.u_name || (t.proxyWallet.slice(0, 6) + '...' + t.proxyWallet.slice(-4))}
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide border ${
                        t.side === 'BUY' 
                          ? 'bg-[#5fbf9a]/10 text-[#5fbf9a] border-[#5fbf9a]/30' 
                          : 'bg-[#e5787f]/10 text-[#e5787f] border-[#e5787f]/30'
                      }`}>
                        {t.side} {t.outcome}
                      </span>
                    </td>
                    <td className="px-5 py-4 max-w-[200px] truncate text-[#e8e8e4]" title={t.title}>{t.title}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-[#bdbdb8]">{t.size.toLocaleString()}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-[#bdbdb8]">${t.price.toFixed(3)}</td>
                    <td className="px-5 py-4 text-right tabular-nums font-medium text-white">${(t.size * t.price).toFixed(2)}</td>
                  </tr>
                ))}
                {feed.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-[#73757c]">No trades collected yet. Run the crawler.</td>
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
