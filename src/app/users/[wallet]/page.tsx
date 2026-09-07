"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ExternalLink, Wallet, Activity, PieChart, Archive, History as HistoryIcon, ChevronDown, ChevronUp, Star, ChevronRight, Download, FileText, Loader2 } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import UserCharts from "@/components/UserCharts";

/* ---------- tiny sortable-table helpers ---------- */

function SortHeader({ label, col, sort, onSort, right }: { label: string; col: string; sort: { col: string; dir: 1 | -1 }; onSort: (c: string) => void; right?: boolean }) {
  const active = sort.col === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-5 py-4 cursor-pointer select-none hover:text-slate-200 transition-colors ${right ? "text-right" : ""}`}
    >
      {label}
      {active && (sort.dir === 1 ? <ChevronUp className="w-3.5 h-3.5 inline ml-1 text-[#38BDF8]" /> : <ChevronDown className="w-3.5 h-3.5 inline ml-1 text-[#38BDF8]" />)}
    </th>
  );
}

function makeSorter<T>(rows: T[], sort: { col: string; dir: 1 | -1 }, getters: Record<string, (r: T) => string | number>): T[] {
  if (!rows.length) return rows;
  const get = getters[sort.col];
  if (!get) return rows;
  const first = get(rows[0]);
  const numeric = typeof first === "number";
  const sorted = [...rows].sort((a, b) => {
    const va = get(a), vb = get(b);
    if (numeric) return (va as number) - (vb as number);
    return String(va).localeCompare(String(vb));
  });
  return sort.dir === 1 ? sorted : sorted.reverse();
}

type SortState = { col: string; dir: 1 | -1 };
const flip = (s: SortState, col: string): SortState =>
  s.col === col ? { col, dir: (s.dir === 1 ? -1 : 1) } : { col, dir: -1 };

function Section({ id, title, count, open, onToggle, subtitle, accent, icon, children }: {
  id: string; title: string; count?: number; open: boolean; onToggle: () => void;
  subtitle?: string; accent?: string; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-2 text-left group">
        <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className={`text-lg font-medium flex items-center gap-2 ${open ? "text-white" : "text-slate-300"}`}>
          {icon} {title}{count != null && ` (${count})`}
        </span>
        {subtitle && <span className="text-xs font-normal text-slate-500 hidden md:inline">— {subtitle}</span>}
      </button>
      {open && <div className="mt-4 space-y-4">{children}</div>}
    </div>
  );
}

/* ---------- page ---------- */

export default function UserProfile() {
  const params = useParams();
  const wallet = params.wallet as string;
  const [data, setData] = useState<any>(null);
  const [posData, setPosData] = useState<{ positions: any[]; resolved: any[] }>({ positions: [], resolved: [] });
  const [closedData, setClosedData] = useState<any>(null);
  const [tradesData, setTradesData] = useState<{ trades: any[]; totals: any } | null>(null);

  const [openSort, setOpenSort] = useState<SortState>({ col: "value", dir: -1 });
  const [resSort, setResSort] = useState<SortState>({ col: "settled", dir: -1 });
  const [closedSort, setClosedSort] = useState<SortState>({ col: "won", dir: -1 });
  const [tradeSort, setTradeSort] = useState<SortState>({ col: "time", dir: -1 });
  const [exporting, setExporting] = useState<string | null>(null);
  const [isStarred, setIsStarred] = useState<boolean | null>(null);
  const [sections, setSections] = useState<Record<string, boolean>>({
    open: true, resolved: false, closed: true, trades: false,
  });
  const toggleSection = (k: string) => setSections(s => ({ ...s, [k]: !s[k] }));

  useEffect(() => {
    fetch(`/api/users/${wallet}`).then(res => res.json()).then(setData).catch(() => {});
    fetch(`/api/watchlist`).then(res => res.json()).then(d => {
      const me = (d.starred || []).find((s: any) => s.wallet.toLowerCase() === wallet.toLowerCase());
      setIsStarred(!!me);
    }).catch(() => setIsStarred(false));
    fetch(`/api/users/${wallet}/positions`).then(res => res.json()).then(setPosData).catch(() => {});
    fetch(`/api/users/${wallet}/closed`).then(res => res.json()).then(setClosedData).catch(() => {});
    fetch(`/api/users/${wallet}/trades`).then(res => res.json()).then(setTradesData).catch(() => {});
  }, [wallet]);

  /* ---- derived data (defaults keep everything safe pre-load) ---- */
  const positions = posData?.positions || [];
  const resolved = posData?.resolved || [];
  const closedRows = closedData?.closed || [];
  const closedTotals = closedData?.totals || { invested: 0, returned: 0, pnl: 0, count: 0, wins: 0 };
  const tradeRows = tradesData?.trades || [];
  const user = data?.user;
  const isLiveFallback = data?.isLiveFallback;

  const resolvedPnl = resolved.reduce((acc: number, p: any) => acc + (parseFloat(p.cashPnl) || 0), 0);
  const resolvedInvested = resolved.reduce((acc: number, p: any) => acc + (parseFloat(p.initialValue) || 0), 0);
  const resolvedReturned = resolved.reduce((acc: number, p: any) => acc + (parseFloat(p.currentValue) || 0), 0);

  const realizedProfit = (closedTotals.pnl || 0) + resolvedPnl;
  const settledCount = (closedTotals.count || 0) + resolved.length;

  // ---- Risk assessment: totals across all three tables ----
  const totalPositions = (closedTotals.count || 0) + resolved.length + positions.length;
  const closedWins = closedTotals.wins || 0;
  const closedLosses = (closedTotals.count || 0) - closedWins;
  const resolvedWins = resolved.filter((p: any) => (parseFloat(p.cashPnl) || 0) > 0.01).length;
  const resolvedLosses = resolved.length - resolvedWins;
  const totalWins = closedWins + resolvedWins;
  const totalLosses = closedLosses + resolvedLosses;
  const winPct = totalWins + totalLosses > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 1000) / 10 : 0;
  // simple risk grade from win% + realized pnl
  let riskGrade = '—', riskColor = 'text-slate-500';
  if (totalWins + totalLosses >= 3) {
    const score = winPct + (realizedProfit >= 0 ? 10 : -10);
    if (score >= 85) { riskGrade = 'LOW'; riskColor = 'text-[#34D399]'; }
    else if (score >= 60) { riskGrade = 'MODERATE'; riskColor = 'text-[#FBBF24]'; }
    else { riskGrade = 'HIGH'; riskColor = 'text-[#FB7185]'; }
  }
  const openValue = positions.reduce((s: number, p: any) => s + (parseFloat(p.currentValue) || 0), 0);
  const tradesVolume = (tradesData?.totals?.buyUsd || 0) + (tradesData?.totals?.sellUsd || 0);

  /* ---- sorted views (all hooks BEFORE any early return — Rules of Hooks) ---- */
  const openSorted = useMemo(() => makeSorter(positions, openSort, {
    market: (p: any) => p.title || "",
    outcome: (p: any) => p.outcome || "",
    shares: (p: any) => parseFloat(p.size) || 0,
    avg: (p: any) => parseFloat(p.avgPrice) || 0,
    value: (p: any) => parseFloat(p.currentValue) || 0,
    pnl: (p: any) => parseFloat(p.cashPnl) || 0,
  }), [positions, openSort]);

  const resSorted = useMemo(() => makeSorter(resolved, resSort, {
    market: (p: any) => p.title || "",
    outcome: (p: any) => p.outcome || "",
    invested: (p: any) => parseFloat(p.initialValue) || 0,
    back: (p: any) => parseFloat(p.currentValue) || 0,
    result: (p: any) => parseFloat(p.cashPnl) || 0,
    settled: (p: any) => p.endDate ? new Date(p.endDate).getTime() : 0,
  }), [resolved, resSort]);

  const closedSorted = useMemo(() => makeSorter(closedRows, closedSort, {
    market: (p: any) => p.title || "",
    outcome: (p: any) => p.outcome || "",
    invested: (p: any) => p.invested || 0,
    back: (p: any) => p.returned || 0,
    won: (p: any) => p.pnl || 0,
    traded: (p: any) => p.totalTraded || 0,
  }), [closedRows, closedSort]);

  const tradesSorted = useMemo(() => makeSorter(tradeRows, tradeSort, {
    time: (t: any) => t.timestamp || 0,
    side: (t: any) => t.side || "",
    market: (t: any) => t.title || "",
    outcome: (t: any) => t.outcome || "",
    size: (t: any) => parseFloat(t.size) || 0,
    price: (t: any) => parseFloat(t.price) || 0,
    notional: (t: any) => parseFloat(t.usdcSize) || (parseFloat(t.size) * parseFloat(t.price)) || 0,
  }), [tradeRows, tradeSort]);

  const downloadExport = async (kind: "trades" | "closed", format: "csv" | "pdf") => {
    const key = kind + ":" + format;
    setExporting(key);
    try {
      const res = await fetch("/api/export/wallet", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, kind, format }),
      });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${kind}-${wallet.slice(0, 6)}-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* keep silent, button re-enables */ }
    finally { setExporting(null); }
  };

  const ExportBtn = ({ kind, format, label }: { kind: "trades" | "closed"; format: "csv" | "pdf"; label: string }) => (
    <button onClick={() => downloadExport(kind, format)} disabled={!!exporting}
      title={`Download ${label} as ${format.toUpperCase()}`}
      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-[#38BDF8] transition-colors disabled:opacity-40">
      {exporting === kind + ":" + format
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : format === "csv" ? <Download className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
      {format.toUpperCase()}
    </button>
  );

  const toggleStar = async () => {
    const next = !isStarred;
    setIsStarred(next);
    if (next) await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet, star: true }) });
    else await fetch(`/api/watchlist?wallet=${wallet}`, { method: "DELETE" });
  };

  /* ---- loading / error guards (inline returns AFTER all hooks) ---- */
  if (!data) {
    return <div className="p-8 text-center text-slate-500 animate-in fade-in">Loading...</div>;
  }
  if (data.error) {
    return (
      <div className="p-8 max-w-md mx-auto mt-12 text-center bg-[#111827] border border-slate-800/50 rounded-2xl animate-in fade-in">
        <Wallet className="w-12 h-12 text-slate-600 mx-auto mb-4 opacity-50"/>
        <h2 className="text-xl font-medium text-white mb-2">User not found</h2>
        <p className="text-slate-400 text-sm">This wallet is not tracked by the crawler and has no activity on Polymarket.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {isLiveFallback && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-500/90 px-4 py-3 rounded-xl flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </span>
            <span className="text-sm font-medium">Not yet tracked by crawler. Showing LIVE data.</span>
          </div>
          <span className="text-xs font-medium uppercase tracking-wider opacity-80">Track now: the next crawl cycle will pick them up.</span>
        </div>
      )}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-2 flex items-center gap-3 text-white tracking-tight">
            <button onClick={toggleStar} title={isStarred ? "Remove from watchlist" : "Star → add to watchlist (alert-able)"}>
              <Star className={`w-6 h-6 ${isStarred ? "text-yellow-400 fill-yellow-400" : "text-slate-600 hover:text-yellow-300"}`} />
            </button>
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
          <p className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1.5">Realized Profit (all-time)</p>
          {settledCount > 0 ? (
            <>
              <p className={`text-2xl font-bold tabular-nums tracking-tight ${realizedProfit >= 0 ? 'text-[#34D399]' : 'text-[#FB7185]'}`}>
                {realizedProfit >= 0 ? '+' : ''}${realizedProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              <p className="text-[11px] text-slate-500 mt-1.5">closed history {closedTotals.count || 0} + resolved-on-hand {resolved.length} — settled markets only</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold tabular-nums text-slate-600">—</p>
              <p className="text-[11px] text-slate-500 mt-1.5">no settled positions yet</p>
            </>
          )}
        </div>
        <div className="bg-[#111827] border border-slate-800/50 p-6 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors shadow-sm">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-slate-600 to-transparent opacity-30"></div>
          <p className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1.5">Trades (full history)</p>
          <p className="text-2xl font-bold tabular-nums text-white tracking-tight">{tradesData?.totals?.count ?? user.trade_count ?? 0}</p>
          <p className="text-[11px] text-slate-500 mt-1.5">
            vol ${tradesVolume > 0 ? tradesVolume.toLocaleString(undefined, { maximumFractionDigits: 0 }) : (user.total_notional || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        {user.true_first_trade_at ? (
          <div className="bg-[#111827] border border-slate-800/50 p-6 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors shadow-sm">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#34D399] to-transparent opacity-50"></div>
            <p className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1.5">First-Ever Bet</p>
            <p className="text-2xl font-bold tabular-nums text-white tracking-tight">${(user.true_first_trade_size || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            <p className="text-[11px] text-slate-500 mt-1.5">{format(new Date(user.true_first_trade_at * 1000), "MMM d, yyyy HH:mm")} UTC — verified from full history</p>
          </div>
        ) : (
          <div className="bg-[#111827] border border-slate-800/50 p-6 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors shadow-sm">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-slate-600 to-transparent opacity-30"></div>
            <p className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1.5">First-Ever Bet</p>
            <p className="text-2xl font-bold tabular-nums text-slate-600">—</p>
            <p className="text-[11px] text-slate-500 mt-1.5">{user.true_first_checked_at ? "no on-chain trades found" : "scanning history…"}</p>
          </div>
        )}
        <div className="bg-[#111827] border border-slate-800/50 p-6 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors shadow-sm">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-slate-600 to-transparent opacity-30"></div>
          <p className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1.5">Open Positions Value</p>
          <p className="text-2xl font-bold tabular-nums text-white tracking-tight">
            ${openValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[11px] text-slate-500 mt-1.5">{positions.length} position{positions.length !== 1 ? "s" : ""} still held</p>
        </div>
        <div className="bg-[#111827] border border-slate-800/50 p-6 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors shadow-sm md:col-span-2">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-slate-600 to-transparent opacity-30"></div>
          <p className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1.5">Risk Assessment</p>
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className={`text-2xl font-bold tracking-tight ${riskColor}`}>{riskGrade}</p>
            <p className="text-sm tabular-nums text-slate-300">
              {totalPositions} total positions · <span className="text-[#34D399]">{totalWins}W</span> / <span className="text-[#FB7185]">{totalLosses}L</span>
              {totalWins + totalLosses > 0 && <> · {winPct}% win</>}
            </p>
          </div>
          <div className="flex gap-4 mt-2 text-[11px] text-slate-500 flex-wrap">
            <span>Closed History: <b className="text-slate-300">{closedTotals.count || 0}</b> ({closedWins}W/{closedLosses}L)</span>
            <span>Resolved on hand: <b className="text-slate-300">{resolved.length}</b> ({resolvedWins}W/{resolvedLosses}L)</span>
            <span>Live open: <b className="text-slate-300">{positions.length}</b></span>
          </div>
        </div>
      </div>

      {/* ---------- Open (Live) Positions ---------- */}
      <Section id="open" title="Current Positions (Live)" count={positions.length}
        open={sections.open} onToggle={() => toggleSection("open")}
        subtitle="matches what polymarket.com shows as open · click headers to sort"
        icon={<PieChart className="w-5 h-5 text-slate-400" />}>
        <div className="bg-[#111827] border border-slate-800/50 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0B1120]/80 backdrop-blur text-slate-400 text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-slate-800/80">
                <tr>
                  <SortHeader label="Market" col="market" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} />
                  <SortHeader label="Outcome" col="outcome" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} />
                  <SortHeader label="Shares" col="shares" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} right />
                  <SortHeader label="Avg Price" col="avg" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} right />
                  <SortHeader label="Current Value" col="value" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} right />
                  <SortHeader label="PnL" col="pnl" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} right />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {openSorted.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-500">No open positions found.</td></tr>
                ) : (
                  openSorted.map((p: any, i: number) => (
                    <tr key={`${p.asset ?? "o"}-${i}`} className="hover:bg-[#1E2939]/80 transition-colors group">
                      <td className="px-5 py-4 max-w-[200px] truncate text-slate-200" title={p.title}>{p.title}</td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center px-2 py-0.5 bg-[#1E2939] border border-slate-700 rounded-md text-[11px] font-bold uppercase tracking-wide text-slate-300">
                          {p.outcome}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums text-slate-300">{(parseFloat(p.size) || 0).toLocaleString()}</td>
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
      </Section>

      {/* ---------- Resolved (held) ---------- */}
      <Section id="resolved" title="Resolved Positions" count={resolved.length}
        open={sections.resolved} onToggle={() => toggleSection("resolved")}
        subtitle="settled markets still on hand (lost, or redeemable) · click headers to sort"
        icon={<Archive className="w-5 h-5 text-slate-500" />}>
        <div className="bg-[#111827] border border-slate-800/50 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0B1120]/80 backdrop-blur text-slate-500 text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-slate-800/80">
                <tr>
                  <SortHeader label="Market" col="market" sort={resSort} onSort={c => setResSort(flip(resSort, c))} />
                  <SortHeader label="Outcome" col="outcome" sort={resSort} onSort={c => setResSort(flip(resSort, c))} />
                  <SortHeader label="Invested" col="invested" sort={resSort} onSort={c => setResSort(flip(resSort, c))} right />
                  <SortHeader label="Got Back" col="back" sort={resSort} onSort={c => setResSort(flip(resSort, c))} right />
                  <SortHeader label="Result" col="result" sort={resSort} onSort={c => setResSort(flip(resSort, c))} right />
                  <SortHeader label="Settled" col="settled" sort={resSort} onSort={c => setResSort(flip(resSort, c))} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {resSorted.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-500">No resolved positions.</td></tr>
                ) : (
                  resSorted.map((p: any, i: number) => {
                    const inv = parseFloat(p.initialValue) || 0;
                    const back = parseFloat(p.currentValue) || 0;
                    const pnl = parseFloat(p.cashPnl) || 0;
                    return (
                      <tr key={`${p.asset ?? 'r'}-${i}`} className="hover:bg-[#1E2939]/60 transition-colors">
                        <td className="px-5 py-4 max-w-[220px] truncate text-slate-300" title={p.title}>{p.title}</td>
                        <td className="px-5 py-4">
                          <span className="inline-flex items-center px-2 py-0.5 bg-[#1E2939] border border-slate-700 rounded-md text-[11px] font-bold uppercase tracking-wide text-slate-400">
                            {p.outcome}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right tabular-nums text-slate-400">${inv.toFixed(2)}</td>
                        <td className="px-5 py-4 text-right tabular-nums text-slate-400">${back.toFixed(2)}</td>
                        <td className={`px-5 py-4 text-right tabular-nums font-bold ${pnl >= 0 ? 'text-[#34D399]' : 'text-[#FB7185]'}`}>
                          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                          {p.redeemable && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[#38BDF8]/10 text-[#38BDF8] border border-[#38BDF8]/20">REDEEMABLE</span>}
                        </td>
                        <td className="px-5 py-4 text-slate-500">{p.endDate ? format(new Date(p.endDate), 'MMM d, HH:mm') : '—'}</td>
                      </tr>
                    );
                  })
                )}
                {resolved.length > 0 && (
                  <tr className="bg-[#0B1120]/60 border-t-2 border-slate-700/50">
                    <td className="px-5 py-4 font-semibold text-slate-300" colSpan={2}>TOTAL — {resolved.length} settled</td>
                    <td className="px-5 py-4 text-right tabular-nums font-semibold text-slate-200">${resolvedInvested.toFixed(2)}</td>
                    <td className="px-5 py-4 text-right tabular-nums font-semibold text-slate-200">${resolvedReturned.toFixed(2)}</td>
                    <td className={`px-5 py-4 text-right tabular-nums font-bold ${resolvedPnl >= 0 ? 'text-[#34D399]' : 'text-[#FB7185]'}`}>
                      {resolvedPnl >= 0 ? '+' : ''}${resolvedPnl.toFixed(2)}
                    </td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* ---------- Closed history ---------- */}
      <Section id="closed" title="Closed Positions History" count={closedTotals.count}
        open={sections.closed} onToggle={() => toggleSection("closed")}
        subtitle="every fully-exited market incl. sold & redeemed (same accounting as polymarket.com) · click headers to sort"
        icon={<HistoryIcon className="w-5 h-5 text-[#38BDF8]" />}>
        <div className="bg-[#111827] border border-slate-800/50 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0B1120]/80 backdrop-blur text-slate-400 text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-slate-800/80">
                <tr>
                  <SortHeader label="Market" col="market" sort={closedSort} onSort={c => setClosedSort(flip(closedSort, c))} />
                  <SortHeader label="Outcome" col="outcome" sort={closedSort} onSort={c => setClosedSort(flip(closedSort, c))} />
                  <SortHeader label="Invested" col="invested" sort={closedSort} onSort={c => setClosedSort(flip(closedSort, c))} right />
                  <SortHeader label="Got Back" col="back" sort={closedSort} onSort={c => setClosedSort(flip(closedSort, c))} right />
                  <SortHeader label="WON" col="won" sort={closedSort} onSort={c => setClosedSort(flip(closedSort, c))} right />
                  <SortHeader label="Total Traded" col="traded" sort={closedSort} onSort={c => setClosedSort(flip(closedSort, c))} right />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {closedSorted.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-500">No closed positions found.</td></tr>
                ) : (
                  closedSorted.map((p: any, i: number) => (
                    <tr key={`${p.conditionId}-${p.outcome}-${i}`} className="hover:bg-[#1E2939]/80 transition-colors">
                      <td className="px-5 py-4 max-w-[220px] truncate text-slate-200" title={p.title}>{p.title}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide border ${p.won ? "bg-[#34D399]/10 text-[#34D399] border-[#34D399]/20" : "bg-[#FB7185]/10 text-[#FB7185] border-[#FB7185]/20"}`}>
                          {p.won ? "Won" : "Lost"} · {p.outcome}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums text-slate-400">${p.invested.toFixed(2)}</td>
                      <td className="px-5 py-4 text-right tabular-nums text-slate-400">${p.returned.toFixed(2)}</td>
                      <td className={`px-5 py-4 text-right tabular-nums font-bold ${p.pnl >= 0 ? 'text-[#34D399]' : 'text-[#FB7185]'}`}>
                        {p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums text-slate-500">${p.totalTraded.toFixed(2)}</td>
                    </tr>
                  ))
                )}
                {closedTotals.count > 0 && (
                  <tr className="bg-[#0B1120]/60 border-t-2 border-slate-700/50">
                    <td className="px-5 py-4 font-semibold text-slate-300" colSpan={2}>
                      TOTAL — {closedTotals.count} closed ({closedTotals.wins} won)
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums font-semibold text-slate-200">${closedTotals.invested.toFixed(2)}</td>
                    <td className="px-5 py-4 text-right tabular-nums font-semibold text-slate-200">${closedTotals.returned.toFixed(2)}</td>
                    <td className={`px-5 py-4 text-right tabular-nums font-bold ${closedTotals.pnl >= 0 ? 'text-[#34D399]' : 'text-[#FB7185]'}`}>
                      {closedTotals.pnl >= 0 ? '+' : ''}${closedTotals.pnl.toFixed(2)}
                    </td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* ---------- Full trade history (live from Polymarket) ---------- */}
      <Section id="trades" title="Trade History" count={tradesData?.totals?.count ?? 0}
        open={sections.trades} onToggle={() => toggleSection("trades")}
        subtitle="full history live from Polymarket (not crawler cache) · click headers to sort"
        icon={<Activity className="w-5 h-5 text-slate-400" />}>
        <div className="bg-[#111827] border border-slate-800/50 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0B1120]/80 backdrop-blur text-slate-400 text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-slate-800/80">
                <tr>
                  <SortHeader label="Time" col="time" sort={tradeSort} onSort={c => setTradeSort(flip(tradeSort, c))} />
                  <SortHeader label="Side" col="side" sort={tradeSort} onSort={c => setTradeSort(flip(tradeSort, c))} />
                  <SortHeader label="Market" col="market" sort={tradeSort} onSort={c => setTradeSort(flip(tradeSort, c))} />
                  <SortHeader label="Outcome" col="outcome" sort={tradeSort} onSort={c => setTradeSort(flip(tradeSort, c))} />
                  <SortHeader label="Size" col="size" sort={tradeSort} onSort={c => setTradeSort(flip(tradeSort, c))} right />
                  <SortHeader label="Price" col="price" sort={tradeSort} onSort={c => setTradeSort(flip(tradeSort, c))} right />
                  <SortHeader label="Notional" col="notional" sort={tradeSort} onSort={c => setTradeSort(flip(tradeSort, c))} right />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {tradesSorted.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-slate-500">No trades found.</td></tr>
                ) : (
                  tradesSorted.map((t: any, i: number) => {
                    const notional = parseFloat(t.usdcSize) || (parseFloat(t.size) * parseFloat(t.price)) || 0;
                    return (
                      <tr key={`${t.transactionHash ?? "t"}-${t.asset ?? "x"}-${t.timestamp ?? i}-${i}`} className="hover:bg-[#1E2939]/80 transition-colors group">
                        <td className="px-5 py-4 text-slate-400 tabular-nums">{format(new Date(t.timestamp * 1000), "MMM d, HH:mm")}</td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase border ${
                            t.side === 'BUY'
                              ? 'bg-[#34D399]/10 text-[#34D399] border-[#34D399]/20'
                              : 'bg-[#FB7185]/10 text-[#FB7185] border-[#FB7185]/20'
                          }`}>
                            {t.side}
                          </span>
                        </td>
                        <td className="px-5 py-4 max-w-[200px] truncate text-slate-200" title={t.title}>{t.title}</td>
                        <td className="px-5 py-4 text-[11px] text-slate-400">{t.outcome}</td>
                        <td className="px-5 py-4 text-right tabular-nums text-slate-300">{(parseFloat(t.size) || 0).toLocaleString()}</td>
                        <td className="px-5 py-4 text-right tabular-nums text-slate-300">${parseFloat(t.price).toFixed(3)}</td>
                        <td className="px-5 py-4 text-right tabular-nums font-medium text-white">${notional.toFixed(2)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <UserCharts wallet={wallet} />
    </div>
  );
}
