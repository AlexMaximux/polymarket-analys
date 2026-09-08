"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Search, ChevronDown, ChevronUp, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [newWithinDays, setNewWithinDays] = useState("0");
  const [minSingleBet, setMinSingleBet] = useState("100");
  const [minVolume, setMinVolume] = useState("0");
  const [minTrades, setMinTrades] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [sortBy, setSortBy] = useState("total_notional");
  const [order, setOrder] = useState("desc");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      q, newWithinDays, minSingleBet, minVolume, minTrades, sortBy, order,
      ...(starredOnly ? { starred: "1" } : {})
    });
    const res = await fetch(`/api/users?${params}`);
    const data = await res.json();
    setUsers(data.data || []);
    setLoading(false);
  }, [q, newWithinDays, minSingleBet, minVolume, minTrades, sortBy, order, starredOnly]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const toggleStar = async (wallet: string, starred: boolean) => {
    setUsers(us => us.map(u => u.wallet === wallet ? { ...u, starred: starred ? 1 : 0 } : u));
    if (starred) {
      await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet, star: true }) });
    } else {
      await fetch(`/api/watchlist?wallet=${wallet}`, { method: "DELETE" });
    }
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setOrder(order === "desc" ? "asc" : "desc");
    } else {
      setSortBy(col);
      setOrder("desc");
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return null;
    return order === "desc" ? <ChevronDown className="w-4 h-4 inline ml-1 text-[#7170ff]" /> : <ChevronUp className="w-4 h-4 inline ml-1 text-[#7170ff]" />;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-semibold mb-1 tracking-tight text-white">User Directory</h1>
        <p className="text-sm text-[#8a8f98] uppercase tracking-wide">Filter and analyze traders</p>
      </div>
      
      <div className="bg-white/[0.02] border border-white/[0.08] p-5 rounded-2xl flex flex-wrap gap-4 items-end shadow-sm relative overflow-hidden">
        <button onClick={() => setStarredOnly(s => !s)}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium border transition-colors ${starredOnly ? "bg-yellow-400/10 border-yellow-400/40 text-yellow-300" : "bg-white/[0.05] border-white/[0.08] text-[#8a8f98] hover:text-[#f7f8f8]"}`}>
          <Star className={`w-4 h-4 ${starredOnly ? "fill-yellow-300" : ""}`} /> Starred only
        </button>
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-slate-700/50 to-transparent"></div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[#8a8f98] mb-1.5">Search Wallet/Name</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#62666d]" />
            <input type="text" value={q} onChange={e => setQ(e.target.value)} className="w-full bg-white/[0.05] text-white border border-white/[0.08] rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-[#7170ff] focus:ring-1 focus:ring-[#38BDF8] transition-shadow placeholder:text-[#62666d]" placeholder="0x..." />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[#8a8f98] mb-1.5">New User (Days)</label>
          <select value={newWithinDays} onChange={e => setNewWithinDays(e.target.value)} className="bg-white/[0.05] text-white border border-white/[0.08] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#7170ff] focus:ring-1 focus:ring-[#38BDF8] transition-shadow">
            <option value="0">Any time</option>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[#8a8f98] mb-1.5">Min Single Bet ($)</label>
          <input type="number" value={minSingleBet} onChange={e => setMinSingleBet(e.target.value)} className="w-32 bg-white/[0.05] text-white border border-white/[0.08] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#7170ff] focus:ring-1 focus:ring-[#38BDF8] transition-shadow" />
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[#8a8f98] mb-1.5">Min Volume ($)</label>
          <input type="number" value={minVolume} onChange={e => setMinVolume(e.target.value)} className="w-32 bg-white/[0.05] text-white border border-white/[0.08] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#7170ff] focus:ring-1 focus:ring-[#38BDF8] transition-shadow" />
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[#8a8f98] mb-1.5">Min Trades</label>
          <input type="number" value={minTrades} onChange={e => setMinTrades(e.target.value)} placeholder="0" className="w-32 bg-white/[0.05] text-white border border-white/[0.08] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#7170ff] focus:ring-1 focus:ring-[#38BDF8] transition-shadow" />
        </div>
      </div>

      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-black/30 backdrop-blur text-[#8a8f98] text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-white/[0.08]">
              <tr>
                <th className="px-5 py-4 w-10"></th>
                <th className="px-5 py-4">User</th>
                <th className="px-5 py-4 cursor-pointer select-none hover:text-[#f7f8f8] transition-colors" onClick={() => toggleSort('first_seen')}>First Seen <SortIcon col="first_seen" /></th>
                <th className="px-5 py-4 cursor-pointer select-none hover:text-[#f7f8f8] transition-colors text-right" onClick={() => toggleSort('trade_count')}>Trades <SortIcon col="trade_count" /></th>
                <th className="px-5 py-4 cursor-pointer select-none hover:text-[#f7f8f8] transition-colors text-right" onClick={() => toggleSort('total_notional')}>Total Vol <SortIcon col="total_notional" /></th>
                <th className="px-5 py-4 cursor-pointer select-none hover:text-[#f7f8f8] transition-colors text-right" onClick={() => toggleSort('max_single_bet')}>Max Bet <SortIcon col="max_single_bet" /></th>
                <th className="px-5 py-4 cursor-pointer select-none hover:text-[#f7f8f8] transition-colors" onClick={() => toggleSort('last_active')}>Last Active <SortIcon col="last_active" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-[#62666d]">Loading...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-[#62666d]">No users found.</td></tr>
              ) : (
                users.map(u => (
                  <tr key={u.wallet} className="hover:bg-white/[0.05] transition-colors group">
                    <td className="px-5 py-4">
                      <button onClick={() => toggleStar(u.wallet, !u.starred)} title={u.starred ? "Unstar" : "Star (watchlist)"}>
                        <Star className={`w-4 h-4 ${u.starred ? "text-yellow-400 fill-yellow-400" : "text-[#62666d] hover:text-[#8a8f98]"}`} />
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/users/${u.wallet}`} className="text-[#7170ff] hover:underline font-medium">
                        {u.pseudonym || u.name || (u.wallet.slice(0, 6) + '...' + u.wallet.slice(-4))}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-[#d0d6e0] tabular-nums">{formatDistanceToNow(new Date(u.first_seen * 1000), { addSuffix: true })}</td>
                    <td className="px-5 py-4 tabular-nums text-right text-[#d0d6e0]">{u.trade_count.toLocaleString()}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-white font-medium">${u.total_notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-[#10b981] font-medium">${u.max_single_bet.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-5 py-4 tabular-nums text-[#8a8f98]">{formatDistanceToNow(new Date(u.last_active * 1000), { addSuffix: true })}</td>
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
