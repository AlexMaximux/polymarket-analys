"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Trophy, Loader2, RefreshCw } from "lucide-react";

type SortCol = "rank" | "userName" | "vol" | "pnl" | "lastActive";
interface LbRow {
  rank: string; proxyWallet: string; userName: string;
  vol: number; pnl: number; lastActive?: number;
}

export default function LeaderboardPage() {
  const [window_, setWindow] = useState("1d");
  const [data, setData] = useState<LbRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 }>({ col: "vol", dir: -1 });
  const [hoverWallet, setHoverWallet] = useState<string | null>(null);
  const [hoverStats, setHoverStats] = useState<any>(null);
  const [hoverLoading, setHoverLoading] = useState(false);

  const load = useCallback(async (w: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leaderboard?window=${w}`);
      const d = await res.json();
      setData(Array.isArray(d) ? d : []);
    } catch { setData([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(window_); }, [load, window_]);

  const sorted = [...data].sort((a: any, b: any) => {
    const { col, dir } = sort;
    if (col === "userName") {
      const va = (a.userName || "").toLowerCase(), vb = (b.userName || "").toLowerCase();
      return va < vb ? -dir : va > vb ? dir : 0;
    }
    const va = Number(a[col] ?? 0), vb = Number(b[col] ?? 0);
    return (va - vb) * dir;
  });

  const th = (col: SortCol, label: string, right = false) => (
    <th onClick={() => setSort(s => ({ col, dir: s.col === col ? (s.dir === 1 ? -1 : 1) : -1 }))}
      className={`px-5 py-4 cursor-pointer select-none hover:text-[#eef0ff] ${right ? "text-right" : ""}`}>
      {label} {sort.col === col && (sort.dir === 1 ? " ▲" : " ▼")}
    </th>
  );

  const fetchHoverStats = async (wallet: string) => {
    setHoverWallet(wallet);
    setHoverStats(null);
    setHoverLoading(true);
    try {
      const [cRes, wRes] = await Promise.all([
        fetch(`/api/users/${wallet}/closed`),
        fetch(`/api/winrate?hours=24&minRate=0&minMarkets=1&limit=200`),
      ]);
      const c = await cRes.json();
      const wRows = (await wRes.json())?.rows || [];
      const wr = wRows.find((r: any) => r.wallet === wallet);
      setHoverStats({
        realized: c?.totals?.pnl ?? null,
        truncated: c?.totals?.truncated ?? false,
        trades: wr?.allTimeTrades ?? null,
        winRate: wr?.winRate ?? null,
        wins: wr?.wins, losses: wr?.losses,
        invested: wr?.invested, pnl: wr?.pnl,
        lastActive: wr?.lastActive ?? null,
      });
    } catch { setHoverStats(null); } finally { setHoverLoading(false); }
  };

  return (
    <div className="space-y-6 rise-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[#ffc94d]/10 text-[#ffc94d] shadow-[0_0_15px_rgba(255,201,77,0.2)]">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#eef0ff]">Leaderboard</h1>
            <p className="text-sm text-[#8b91c5] uppercase tracking-wide">Top traders by volume and PnL</p>
          </div>
        </div>
        <div className="bg-white/[0.05] rounded-xl p-1.5 border border-[rgba(140,130,255,0.15)] inline-flex shadow-sm">
          {["1d", "1w", "1m", "all"].map(w => (
            <button key={w} onClick={() => setWindow(w)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                window_ === w ? "bg-[#8b7cff]/20 text-[#a99cff] shadow-sm" : "text-[#8b91c5] hover:text-[#eef0ff]"
              }`}>{w}</button>
          ))}
        </div>
      </div>

      <div className="pm-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap pm-table">
            <thead className="bg-[#0a0b1e]/70 backdrop-blur text-[#8b91c5] text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-[rgba(140,130,255,0.15)]">
              <tr>
                {th("rank", "#")}
                {th("userName", "User")}
                {th("vol", "Volume", true)}
                {th("pnl", "PnL", true)}
                {th("lastActive", "Last Active")}
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(140,130,255,0.11)]">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-[#5d628f]"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading leaderboard…</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-[#5d628f]">No data available.</td></tr>
              ) : (
                sorted.map((row) => {
                  const idx = data.findIndex(r => r.proxyWallet === row.proxyWallet);
                  return (
                    <tr key={row.proxyWallet} className="hover:bg-white/[0.05] transition-colors group">
                      <td className="px-5 py-4 text-center">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          idx === 0 ? "bg-[#ffc94d]/20 text-[#ffc94d]" :
                          idx === 1 ? "bg-white/15 text-[#c3c8ee]" :
                          idx === 2 ? "bg-[#D97706]/20 text-[#D97706]" :
                          "text-[#5d628f] bg-white/[0.05]"
                        }`}>{idx + 1}</span>
                      </td>
                      <td className="px-5 py-4 relative"
                        onMouseEnter={() => { if (hoverWallet !== row.proxyWallet) fetchHoverStats(row.proxyWallet); }}
                        onMouseLeave={() => setHoverWallet(null)}>
                        <Link href={`/users/${row.proxyWallet}`} className="text-[#a99cff] hover:underline font-medium">
                          {row.userName || (row.proxyWallet.slice(0, 6) + "..." + row.proxyWallet.slice(-4))}
                        </Link>
                        {hoverWallet === row.proxyWallet && (
                          <div className="absolute left-0 top-full mt-1 z-50 w-72 pm-panel p-4 shadow-2xl">
                            <p className="text-[11px] uppercase tracking-wide text-[#8b91c5] mb-2">Quick stats</p>
                            {hoverLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin text-[#8b91c5]" />
                            ) : (
                              <div className="space-y-1.5 text-[13px]">
                                <div className="flex justify-between items-center">
                                  <span className="text-[#8b91c5]">Realized Profit (all-time){hoverStats?.truncated && <span className="text-[9px] text-[#5d628f] ml-1">(2k cap)</span>}</span>
                                  <b className={(hoverStats?.realized ?? 0) >= 0 ? "text-[#2ce5a7]" : "text-[#ff6b9d]"}>
                                    {(hoverStats?.realized ?? 0) >= 0 ? "+" : ""}${Math.abs(hoverStats?.realized ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  </b>
                                </div>
                                <div className="flex justify-between"><span className="text-[#8b91c5]">Trades (full history)</span><b className="text-[#eef0ff]">{hoverStats?.trades ?? "—"}</b></div>
                                <div className="flex justify-between"><span className="text-[#8b91c5]">Win rate (24h)</span>
                                  <b className="text-[#eef0ff]">{hoverStats?.winRate != null ? `${hoverStats.winRate}% (${hoverStats.wins}W/${hoverStats.losses}L)` : "—"}</b></div>
                                <div className="flex justify-between"><span className="text-[#8b91c5]">Invested (24h)</span>
                                  <b className="text-[#eef0ff]">${(hoverStats?.invested ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</b></div>
                                <div className="flex justify-between"><span className="text-[#8b91c5]">PnL (24h)</span>
                                  <b className={(hoverStats?.pnl ?? 0) >= 0 ? "text-[#2ce5a7]" : "text-[#ff6b9d]"}>
                                    {(hoverStats?.pnl ?? 0) >= 0 ? "+" : ""}${Math.abs(hoverStats?.pnl ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</b></div>
                                <div className="flex justify-between"><span className="text-[#8b91c5]">Last active</span>
                                  <b className="text-[#eef0ff]">{hoverStats?.lastActive ? formatDistanceToNow(new Date(hoverStats.lastActive * 1000), { addSuffix: true }) : "—"}</b></div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums text-[#eef0ff] font-medium">
                        ${(row.vol ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className={`px-5 py-4 text-right tabular-nums font-bold ${(row.pnl ?? 0) >= 0 ? "text-[#2ce5a7]" : "text-[#ff6b9d]"}`}>
                        {(row.pnl ?? 0) >= 0 ? "+" : ""}${(row.pnl ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-5 py-4 text-[#8b91c5]">
                        {row.lastActive ? formatDistanceToNow(new Date(row.lastActive * 1000), { addSuffix: true }) : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
