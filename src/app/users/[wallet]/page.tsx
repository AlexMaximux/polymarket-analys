"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ExternalLink, Wallet, Activity, PieChart, Archive, History as HistoryIcon, ChevronDown, ChevronUp, Star, ChevronRight, Download, FileText, Loader2, Sparkles } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

/* ---------- tiny sortable-table helpers ---------- */

function SortHeader({ label, col, sort, onSort, right }: { label: string; col: string; sort: { col: string; dir: 1 | -1 }; onSort: (c: string) => void; right?: boolean }) {
  const active = sort.col === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-5 py-4 cursor-pointer select-none hover:text-[#eef0ff] transition-colors ${right ? "text-right" : ""}`}
    >
      {label}
      {active && (sort.dir === 1 ? <ChevronUp className="w-3.5 h-3.5 inline ml-1 text-[#a99cff]" /> : <ChevronDown className="w-3.5 h-3.5 inline ml-1 text-[#a99cff]" />)}
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

function Section({ id, title, count, open, onToggle, subtitle, accent, icon, actions, children }: {
  id: string; title: string; count?: number; open: boolean; onToggle: () => void;
  subtitle?: string; accent?: string; icon: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <button onClick={onToggle} className="flex-1 flex items-center gap-2 text-left group min-w-0">
          <ChevronRight className={`w-4 h-4 text-[#5d628f] transition-transform shrink-0 ${open ? "rotate-90" : ""}`} />
          <span className={`text-lg font-medium flex items-center gap-2 ${open ? "text-white" : "text-[#c3c8ee]"}`}>
            {icon} {title}{count != null && ` (${count})`}
          </span>
          {subtitle && <span className="text-xs font-normal text-[#5d628f] hidden md:inline truncate">— {subtitle}</span>}
        </button>
        {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
      </div>
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
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiMeta, setAiMeta] = useState("");
  const [aiHistory, setAiHistory] = useState<any[]>([]);
  const [aiExpanded, setAiExpanded] = useState<Record<number, boolean>>({});
  const [closedSearch, setClosedSearch] = useState("");
  const [tradesSearch, setTradesSearch] = useState("");
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [llmCfg, setLlmCfg] = useState<any>(null);
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmMsg, setLlmMsg] = useState("");
  const [isStarred, setIsStarred] = useState<boolean | null>(null);
  const [userNote, setUserNote] = useState("");
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [sections, setSections] = useState<Record<string, boolean>>({
    open: true, resolved: false, closed: true, trades: false, ai: false,
  });
  const toggleSection = (k: string) => setSections(s => ({ ...s, [k]: !s[k] }));

  useEffect(() => {
    fetch(`/api/users/${wallet}`).then(res => res.json()).then(setData).catch(() => {});
    loadAi(); loadLlm();
    fetch(`/api/watchlist`).then(res => res.json()).then(d => {
      const me = (d.starred || []).find((s: any) => s.wallet.toLowerCase() === wallet.toLowerCase());
      setIsStarred(!!me);
      if (me?.note) setUserNote(me.note);
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
  const closedLosses = closedTotals.losses != null ? closedTotals.losses : (closedTotals.count || 0) - closedWins;
  const resolvedWins = resolved.filter((p: any) => (parseFloat(p.cashPnl) || 0) > 0.01).length;
  const resolvedLosses = resolved.length - resolvedWins;
  const totalWins = closedWins + resolvedWins;
  const totalLosses = closedLosses + resolvedLosses;
  const winPct = totalWins + totalLosses > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 1000) / 10 : 0;
  // dollar amounts won / lost (closed markets by realized pnl + resolved-on-hand by cashPnl)
  const wonDollars = closedRows.reduce((s: number, m: any) => (m.pnl ?? 0) > 0.01 ? s + (m.pnl ?? 0) : s, 0)
    + resolved.reduce((s: number, p: any) => (parseFloat(p.cashPnl) || 0) > 0.01 ? s + (parseFloat(p.cashPnl) || 0) : s, 0);
  const lostDollars = Math.abs(closedRows.reduce((s: number, m: any) => (m.pnl ?? 0) < -0.01 ? s + (m.pnl ?? 0) : s, 0)
    + resolved.reduce((s: number, p: any) => (parseFloat(p.cashPnl) || 0) < -0.01 ? s + (parseFloat(p.cashPnl) || 0) : s, 0));
  // simple risk grade from win% + realized pnl
  let riskGrade = '—', riskColor = 'text-[#5d628f]';
  if (totalWins + totalLosses >= 3) {
    const score = winPct + (realizedProfit >= 0 ? 10 : -10);
    if (score >= 85) { riskGrade = 'LOW'; riskColor = 'text-[#2ce5a7]'; }
    else if (score >= 60) { riskGrade = 'MODERATE'; riskColor = 'text-[#ffc94d]'; }
    else { riskGrade = 'HIGH'; riskColor = 'text-[#ff6b9d]'; }
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

  const closedFiltered = useMemo(() => {
    const q = closedSearch.trim().toLowerCase();
    if (!q) return closedRows;
    return closedRows.filter((r: any) =>
      (r.title || "").toLowerCase().includes(q) ||
      (r.outcome || "").toLowerCase().includes(q) ||
      String(r.invested ?? "").includes(q) ||
      String(Math.round(r.pnl ?? 0)).includes(q)
    );
  }, [closedRows, closedSearch]);
  const closedSorted = useMemo(() => makeSorter(closedFiltered, closedSort, {
    market: (p: any) => p.title || "",
    outcome: (p: any) => p.outcome || "",
    invested: (p: any) => p.invested || 0,
    back: (p: any) => p.gotBack ?? p.returned ?? 0,
    won: (p: any) => p.pnl || 0,
    traded: (p: any) => p.totalTraded || 0,
  }), [closedFiltered, closedSort]);

  const tradesFiltered = useMemo(() => {
    const q = tradesSearch.trim().toLowerCase();
    if (!q) return tradeRows;
    return tradeRows.filter((r: any) =>
      (r.title || "").toLowerCase().includes(q) ||
      (r.outcome || "").toLowerCase().includes(q) ||
      (r.side || "").toLowerCase().includes(q) ||
      (r.type || "").toLowerCase().includes(q) ||
      String(Math.round(r.usdcSize ?? 0)).includes(q)
    );
  }, [tradeRows, tradesSearch]);
  const tradesSorted = useMemo(() => makeSorter(tradesFiltered, tradeSort, {
    time: (t: any) => t.timestamp || 0,
    side: (t: any) => t.side || "",
    market: (t: any) => t.title || "",
    outcome: (t: any) => t.outcome || "",
    size: (t: any) => parseFloat(t.size) || 0,
    price: (t: any) => parseFloat(t.price) || 0,
    notional: (t: any) => parseFloat(t.usdcSize) || (parseFloat(t.size) * parseFloat(t.price)) || 0,
  }), [tradesFiltered, tradeSort]);

  const saveUserNote = async () => {
    setNoteSaving(true);
    try {
      await fetch("/api/watchlist", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, note: noteDraft }) });
      setUserNote(noteDraft);
      setNoteEditing(false);
    } catch {} finally { setNoteSaving(false); }
  };

  const loadAi = async () => {
    try {
      const res = await fetch(`/api/users/${wallet}/analyze`);
      const d = await res.json();
      setAiHistory(d.analyses || []);
    } catch {}
  };
  const loadLlm = async () => {
    try {
      const res = await fetch("/api/llm");
      setLlmCfg(await res.json());
    } catch {}
  };
  const runAnalysis = async () => {
    setAiLoading(true); setAiError(""); setAiText(null);
    try {
      const res = await fetch(`/api/users/${wallet}/analyze`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) setAiError(d.error || "analysis failed");
      else { setAiText(d.analysis); setAiMeta(`${d.model} · just now`); loadAi(); }
    } catch (e: any) { setAiError(e.message || "failed"); }
    finally { setAiLoading(false); }
  };
  const saveLlm = async () => {
    setLlmSaving(true); setLlmMsg("");
    const baseUrl = (document.getElementById("llm-url") as HTMLInputElement)?.value ?? "";
    const apiKey = (document.getElementById("llm-key") as HTMLInputElement)?.value ?? "";
    const model = (document.getElementById("llm-model") as HTMLInputElement)?.value ?? "";
    try {
      const res = await fetch("/api/llm", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey, model }) });
      const d = await res.json();
      if (!res.ok) setLlmMsg("❌ " + (d.testError || d.error || "failed"));
      else { setLlmMsg("✅ saved & connection tested"); loadLlm(); }
    } catch { setLlmMsg("❌ failed"); }
    finally { setLlmSaving(false); }
  };

  const [entriesModal, setEntriesModal] = useState<{ open: boolean; title: string; conditionId: string; loading: boolean; rows: any[] }>({ open: false, title: "", conditionId: "", loading: false, rows: [] });
  const openEntries = async (p: any) => {
    setEntriesModal({ open: true, title: p.title, conditionId: p.conditionId, loading: true, rows: [] });
    try {
      const res = await fetch(`/api/users/${wallet}/entries?conditionId=${p.conditionId}`);
      const d = await res.json();
      setEntriesModal(m => ({ ...m, loading: false, rows: d.entries || [] }));
    } catch { setEntriesModal(m => ({ ...m, loading: false })); }
  };

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
      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#5d628f] hover:text-[#a99cff] transition-colors disabled:opacity-40">
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
    return <div className="p-8 text-center text-[#5d628f] animate-in fade-in">Loading...</div>;
  }
  if (data.error) {
    return (
      <div className="p-8 max-w-md mx-auto mt-12 text-center bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-2xl animate-in fade-in">
        <Wallet className="w-12 h-12 text-[#5d628f] mx-auto mb-4 opacity-50"/>
        <h2 className="text-xl font-medium text-white mb-2">User not found</h2>
        <p className="text-[#8b91c5] text-sm">This wallet is not tracked by the crawler and has no activity on Polymarket.</p>
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
              <Star className={`w-6 h-6 ${isStarred ? "text-yellow-400 fill-yellow-400" : "text-[#5d628f] hover:text-yellow-300"}`} />
            </button>
            {user.pseudonym || user.name || "Anonymous"}
            <a href={`https://polymarket.com/profile/${wallet}`} target="_blank" rel="noreferrer" className="text-[#5d628f] hover:text-[#a99cff] transition-colors p-1 hover:bg-[#8b7cff]/12 rounded-md">
              <ExternalLink className="w-5 h-5" />
            </a>
          </h1>
          <div className="mb-3">
            {noteEditing ? (
              <div className="flex flex-wrap items-center gap-2">
                <input value={noteDraft} onChange={e => setNoteDraft(e.target.value)} autoFocus
                  placeholder="توضیح درباره‌ی این والت…"
                  onKeyDown={e => { if (e.key === "Enter") saveUserNote(); }}
                  className="flex-1 min-w-[260px] bg-white/[0.05] border border-[rgba(140,130,255,0.25)] rounded-lg px-3 py-2 text-sm text-[#eef0ff] placeholder:text-[#5d628f] focus:outline-none focus:border-[#a99cff]" />
                <button onClick={saveUserNote} disabled={noteSaving}
                  className="text-xs font-semibold rounded-lg px-3 py-2 bg-gradient-to-r from-[#6c5ce7] to-[#7170ff] text-white disabled:opacity-50">
                  {noteSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                </button>
                <button onClick={() => setNoteEditing(false)}
                  className="text-xs text-[#8b91c5] hover:text-[#eef0ff] px-2">cancel</button>
              </div>
            ) : (
              <button onClick={() => { setNoteDraft(userNote); setNoteEditing(true); }}
                className="group inline-flex items-center gap-2 text-sm">
                {userNote ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8b7cff]/10 border border-[rgba(139,124,255,0.3)] text-[#dfe3ff]">
                    <FileText className="w-3.5 h-3.5 text-[#a99cff]" /> {userNote}
                    <span className="text-[10px] text-[#5d628f] group-hover:text-[#a99cff] ml-1">(edit)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[#5d628f] group-hover:text-[#a99cff]">
                    <FileText className="w-3.5 h-3.5" /> add note about this wallet…
                  </span>
                )}
              </button>
            )}
          </div>
          <p className="text-[#8b91c5] flex items-center gap-2 text-sm"><Wallet className="w-4 h-4"/> <span className="font-mono text-[13px]">{wallet}</span></p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] p-6 rounded-2xl relative overflow-hidden group hover:border-[rgba(140,130,255,0.15)] transition-colors shadow-sm">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-slate-600 to-transparent opacity-30"></div>
          <p className="text-xs uppercase tracking-wider text-[#8b91c5] font-medium mb-1.5">Realized Profit (all-time)</p>
          {settledCount > 0 ? (
            <>
              <p className={`text-2xl font-bold tabular-nums tracking-tight ${realizedProfit >= 0 ? 'text-[#2ce5a7]' : 'text-[#ff6b9d]'}`}>
                {realizedProfit >= 0 ? '+' : ''}${realizedProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              <p className="text-[11px] text-[#5d628f] mt-1.5">closed history {closedTotals.count || 0} + resolved-on-hand {resolved.length} — settled markets only</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold tabular-nums text-[#5d628f]">—</p>
              <p className="text-[11px] text-[#5d628f] mt-1.5">no settled positions yet</p>
            </>
          )}
        </div>
        <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] p-6 rounded-2xl relative overflow-hidden group hover:border-[rgba(140,130,255,0.15)] transition-colors shadow-sm">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-slate-600 to-transparent opacity-30"></div>
          <p className="text-xs uppercase tracking-wider text-[#8b91c5] font-medium mb-1.5">Trades (full history)</p>
          <p className="text-2xl font-bold tabular-nums text-white tracking-tight">{tradesData?.totals?.count ?? user.trade_count ?? 0}</p>
          <p className="text-[11px] text-[#5d628f] mt-1.5">
            vol ${tradesVolume > 0 ? tradesVolume.toLocaleString(undefined, { maximumFractionDigits: 0 }) : (user.total_notional || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        {user.true_first_trade_at ? (
          <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] p-6 rounded-2xl relative overflow-hidden group hover:border-[rgba(140,130,255,0.15)] transition-colors shadow-sm">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#34D399] to-transparent opacity-50"></div>
            <p className="text-xs uppercase tracking-wider text-[#8b91c5] font-medium mb-1.5">First-Ever Bet</p>
            <p className="text-2xl font-bold tabular-nums text-white tracking-tight">${(user.true_first_trade_size || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            <p className="text-[11px] text-[#5d628f] mt-1.5">{format(new Date(user.true_first_trade_at * 1000), "MMM d, yyyy HH:mm")} UTC — verified from full history</p>
          </div>
        ) : (
          <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] p-6 rounded-2xl relative overflow-hidden group hover:border-[rgba(140,130,255,0.15)] transition-colors shadow-sm">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-slate-600 to-transparent opacity-30"></div>
            <p className="text-xs uppercase tracking-wider text-[#8b91c5] font-medium mb-1.5">First-Ever Bet</p>
            <p className="text-2xl font-bold tabular-nums text-[#5d628f]">—</p>
            <p className="text-[11px] text-[#5d628f] mt-1.5">{user.true_first_checked_at ? "no on-chain trades found" : "scanning history…"}</p>
          </div>
        )}
        <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] p-6 rounded-2xl relative overflow-hidden group hover:border-[rgba(140,130,255,0.15)] transition-colors shadow-sm">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-slate-600 to-transparent opacity-30"></div>
          <p className="text-xs uppercase tracking-wider text-[#8b91c5] font-medium mb-1.5">Open Positions Value</p>
          <p className="text-2xl font-bold tabular-nums text-white tracking-tight">
            ${openValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[11px] text-[#5d628f] mt-1.5">{positions.length} position{positions.length !== 1 ? "s" : ""} still held</p>
        </div>
        <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] p-6 rounded-2xl relative overflow-hidden group hover:border-[rgba(140,130,255,0.15)] transition-colors shadow-sm md:col-span-2">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-slate-600 to-transparent opacity-30"></div>
          <p className="text-xs uppercase tracking-wider text-[#8b91c5] font-medium mb-1.5">Risk Assessment</p>
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className={`text-2xl font-bold tracking-tight ${riskColor}`}>{riskGrade}</p>
            <p className="text-sm tabular-nums text-[#c3c8ee]">
              {totalPositions} total positions
            </p>
          </div>
          <div className="mt-3 flex items-center gap-4 flex-wrap">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold tabular-nums text-[#2ce5a7]">{totalWins}</span>
              <span className="text-xs text-[#8b91c5] uppercase tracking-wide">wins</span>
            </div>
            <span className="text-[#5d628f] text-lg font-light">/</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold tabular-nums text-[#ff6b9d]">{totalLosses}</span>
              <span className="text-xs text-[#8b91c5] uppercase tracking-wide">losses</span>
            </div>
            {totalWins + totalLosses > 0 && (
              <div className="flex items-baseline gap-1.5 ml-2">
                <span className="text-lg font-semibold tabular-nums text-[#eef0ff]">{winPct}%</span>
                <span className="text-xs text-[#8b91c5] uppercase tracking-wide">win rate</span>
              </div>
            )}
          </div>
          <div className="mt-2.5 flex items-center gap-3 flex-wrap text-[13px]">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#2ce5a7]/10 border border-[#2ce5a7]/25">
              <span className="text-[#2ce5a7] font-semibold tabular-nums">+${wonDollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="text-[#8b91c5]">won (total)</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#ff6b9d]/10 border border-[#ff6b9d]/25">
              <span className="text-[#ff6b9d] font-semibold tabular-nums">−${lostDollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="text-[#8b91c5]">lost (total)</span>
            </span>
          </div>
          <div className="flex gap-4 mt-2 text-[11px] text-[#5d628f] flex-wrap">
            <span>Closed History: <b className="text-[#c3c8ee]">{closedTotals.count || 0}</b> ({closedWins}W/{closedLosses}L)</span>
            <span>Resolved on hand: <b className="text-[#c3c8ee]">{resolved.length}</b> ({resolvedWins}W/{resolvedLosses}L)</span>
            <span>Live open: <b className="text-[#c3c8ee]">{positions.length}</b></span>
          </div>
        </div>
      </div>

            {/* ---------- AI Analysis ---------- */}
      <Section id="ai" title="AI Analysis"
        open={aiOpen} onToggle={() => setAiOpen(o => !o)}
        subtitle="LLM briefing on this wallet's full trading history"
        icon={<Sparkles className="w-5 h-5 text-[#a99cff]" />}
        actions={
          <>
            <button onClick={() => { setAiSettingsOpen(s => !s); loadLlm(); }}
              className="text-[11px] font-medium text-[#8b91c5] hover:text-[#eef0ff]">⚙ LLM</button>
            <button onClick={runAnalysis} disabled={aiLoading}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-lg px-3 py-1.5 bg-gradient-to-r from-[#6c5ce7] to-[#7170ff] text-white shadow-[0_0_14px_rgba(108,92,231,0.4)] disabled:opacity-50">
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {aiLoading ? "Analyzing full history…" : aiText ? "Re-analyze" : "Analyze wallet"}
            </button>
          </>
        }>
        {aiSettingsOpen && (
          <div className="pm-panel p-5 mb-4 space-y-3">
            <p className="text-xs uppercase tracking-wide text-[#8b91c5] font-medium">LLM Endpoint (OpenAI-compatible)</p>
            {llmCfg?.configured && (
              <p className="text-[11px] text-[#5d628f]">current: {llmCfg.baseUrl} · {llmCfg.model} · key {llmCfg.apiKeyMasked}</p>
            )}
            <div className="grid md:grid-cols-3 gap-3">
              <input id="llm-url" defaultValue={llmCfg?.baseUrl || ""} placeholder="http://host:port/v1"
                className="bg-white/[0.05] border border-[rgba(140,130,255,0.2)] rounded-lg px-3 py-2 text-sm text-[#eef0ff] placeholder:text-[#5d628f] focus:outline-none focus:border-[#a99cff]" />
              <input id="llm-key" defaultValue="" placeholder="API key (sk-…)"
                className="bg-white/[0.05] border border-[rgba(140,130,255,0.2)] rounded-lg px-3 py-2 text-sm text-[#eef0ff] placeholder:text-[#5d628f] focus:outline-none focus:border-[#a99cff]" />
              <input id="llm-model" defaultValue={llmCfg?.model || ""} placeholder="model id (e.g. ag/gemini-3.8-flash-medium)"
                className="bg-white/[0.05] border border-[rgba(140,130,255,0.2)] rounded-lg px-3 py-2 text-sm text-[#eef0ff] placeholder:text-[#5d628f] focus:outline-none focus:border-[#a99cff]" />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={saveLlm} disabled={llmSaving}
                className="text-xs font-semibold rounded-lg px-4 py-2 bg-gradient-to-r from-[#6c5ce7] to-[#7170ff] text-white disabled:opacity-50">
                {llmSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> : null}
                Test & save
              </button>
              {llmMsg && <span className="text-xs text-[#c3c8ee]">{llmMsg}</span>}
            </div>
          </div>
        )}

        {aiError && <div className="bg-[#ff6b9d]/10 border border-[#ff6b9d]/30 text-[#ff6b9d] rounded-xl px-4 py-3 text-sm mb-4">{aiError}</div>}

        {!aiText && !aiLoading && !aiError && (
          <p className="text-sm text-[#8b91c5]">
            Press <b className="text-[#a99cff]">Analyze wallet</b> — the full trading history (closed markets, live positions, recent trades) is sent to the configured LLM and its briefing appears here.
          </p>
        )}

        {/* history list — every run kept as a dated collapsible entry */}
        {aiHistory.length > 0 && (
          <div className="space-y-2">
            {aiHistory.map((h: any) => (
              <div key={h.id} className="pm-panel overflow-hidden">
                <button onClick={() => setAiExpanded(s => ({ ...s, [h.id]: !s[h.id] }))}
                  className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-white/[0.04] transition-colors">
                  <span className="flex items-center gap-2 text-sm">
                    <ChevronRight className={`w-3.5 h-3.5 text-[#5d628f] transition-transform ${aiExpanded[h.id] ? "rotate-90" : ""}`} />
                    <Sparkles className="w-3.5 h-3.5 text-[#a99cff]" />
                    <span className="text-[#eef0ff] font-medium">{h.model}</span>
                    <span className="text-[#5d628f] text-xs">· {new Date(h.created_at * 1000).toLocaleString()}</span>
                  </span>
                  <span className="text-[11px] text-[#8b91c5]">{aiExpanded[h.id] ? "بستن" : "نمایش"}</span>
                </button>
                {aiExpanded[h.id] && (
                  <div dir="rtl" style={{ fontFamily: "Vazirmatn, IRANSans, Tahoma, system-ui, sans-serif" }}
                    className="relative px-6 pb-6 pt-2 overflow-hidden border-t border-[rgba(139,124,255,0.2)]"
                  >
                    <div className="space-y-4 text-[15px] md:text-base leading-[1.9] text-[#dfe3ff]">
                      {h.analysis.split("\n").map((line: string, k: number) => {
                        const render = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, m2) =>
                          part.startsWith("**") ? <b key={m2} className="text-white font-semibold">{part.slice(2, -2)}</b> : part);
                        if (line.startsWith("## ")) return (
                          <h3 key={k} className="text-xl md:text-[22px] font-semibold text-aurora pt-4 pb-1 border-b border-[rgba(140,130,255,0.18)]">
                            {render(line.slice(3))}
                          </h3>);
                        if (line.startsWith("### ")) return <h4 key={k} className="text-lg font-semibold text-[#eef0ff] pt-2">{render(line.slice(4))}</h4>;
                        if (line.startsWith("* ") || line.startsWith("- ")) return (
                          <li key={k} className="ml-6 list-disc marker:text-[#a99cff]">{render(line.slice(2))}</li>);
                        if (!line.trim()) return <div key={k} className="h-2" />;
                        return <p key={k}>{render(line)}</p>;
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

{/* ---------- Open (Live) Positions ---------- */}
      <Section id="open" title="Current Positions (Live)" count={positions.length}
        open={sections.open} onToggle={() => toggleSection("open")}
        subtitle="matches what polymarket.com shows as open · click headers to sort"
        icon={<PieChart className="w-5 h-5 text-[#8b91c5]" />}>
        <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0a0b1e]/70 backdrop-blur text-[#8b91c5] text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-[rgba(140,130,255,0.15)]">
                <tr>
                  <SortHeader label="Market" col="market" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} />
                  <SortHeader label="Outcome" col="outcome" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} />
                  <SortHeader label="Entries" col="entries" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} right />
                  <SortHeader label="Shares" col="shares" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} right />
                  <SortHeader label="Avg Price" col="avg" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} right />
                  <SortHeader label="Current Value" col="value" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} right />
                  <SortHeader label="PnL" col="pnl" sort={openSort} onSort={c => setOpenSort(flip(openSort, c))} right />
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(140,130,255,0.11)]">
                {openSorted.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-[#5d628f]">No open positions found.</td></tr>
                ) : (
                  openSorted.map((p: any, i: number) => (
                    <tr key={`${p.asset ?? "o"}-${i}`} className="hover:bg-white/[0.08] transition-colors group">
                      <td className="px-5 py-4 max-w-[200px] truncate text-[#eef0ff]">
                        <a href={`https://polymarket.com/event/${p.eventSlug || p.slug}`} target="_blank" rel="noreferrer"
                          title={p.title + " — open on Polymarket"}
                          className="hover:text-[#a99cff] hover:underline">
                          {p.title} <ExternalLink className="w-3 h-3 inline opacity-40" />
                        </a>
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center px-2 py-0.5 bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-md text-[11px] font-bold uppercase tracking-wide text-[#c3c8ee]">
                          {p.outcome}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        {(p.entryCount ?? 0) > 1 ? (
                          <button onClick={() => openEntries(p)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#8b7cff]/15 border border-[rgba(139,124,255,0.35)] text-[#a99cff] text-xs font-bold hover:bg-[#8b7cff]/25">
                            {p.entryCount} entries
                          </button>
                        ) : (
                          <span className="text-[#5d628f] text-xs">1</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums text-[#c3c8ee]">{(parseFloat(p.size) || 0).toLocaleString()}</td>
                      <td className="px-5 py-4 text-right tabular-nums text-[#c3c8ee]">${parseFloat(p.avgPrice).toFixed(3)}</td>
                      <td className="px-5 py-4 text-right tabular-nums font-medium text-white">${parseFloat(p.currentValue).toFixed(2)}</td>
                      <td className={`px-5 py-4 text-right tabular-nums font-medium ${parseFloat(p.cashPnl) >= 0 ? 'text-[#2ce5a7]' : 'text-[#ff6b9d]'}`}>
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
        icon={<Archive className="w-5 h-5 text-[#5d628f]" />}>
        <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0a0b1e]/70 backdrop-blur text-[#5d628f] text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-[rgba(140,130,255,0.15)]">
                <tr>
                  <SortHeader label="Market" col="market" sort={resSort} onSort={c => setResSort(flip(resSort, c))} />
                  <SortHeader label="Outcome" col="outcome" sort={resSort} onSort={c => setResSort(flip(resSort, c))} />
                  <SortHeader label="Invested" col="invested" sort={resSort} onSort={c => setResSort(flip(resSort, c))} right />
                  <SortHeader label="Got Back" col="back" sort={resSort} onSort={c => setResSort(flip(resSort, c))} right />
                  <SortHeader label="Result" col="result" sort={resSort} onSort={c => setResSort(flip(resSort, c))} right />
                  <SortHeader label="Settled" col="settled" sort={resSort} onSort={c => setResSort(flip(resSort, c))} />
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(140,130,255,0.11)]">
                {resSorted.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-[#5d628f]">No resolved positions.</td></tr>
                ) : (
                  resSorted.map((p: any, i: number) => {
                    const inv = parseFloat(p.initialValue) || 0;
                    const back = parseFloat(p.currentValue) || 0;
                    const pnl = parseFloat(p.cashPnl) || 0;
                    return (
                      <tr key={`${p.asset ?? 'r'}-${i}`} className="hover:bg-white/[0.08] transition-colors">
                        <td className="px-5 py-4 max-w-[220px] truncate text-[#c3c8ee]" title={p.title}>{p.title}</td>
                        <td className="px-5 py-4">
                          <span className="inline-flex items-center px-2 py-0.5 bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-md text-[11px] font-bold uppercase tracking-wide text-[#8b91c5]">
                            {p.outcome}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right tabular-nums text-[#8b91c5]">${inv.toFixed(2)}</td>
                        <td className="px-5 py-4 text-right tabular-nums text-[#8b91c5]">${back.toFixed(2)}</td>
                        <td className={`px-5 py-4 text-right tabular-nums font-bold ${pnl >= 0 ? 'text-[#2ce5a7]' : 'text-[#ff6b9d]'}`}>
                          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                          {p.redeemable && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[#8b7cff]/12 text-[#a99cff] border border-[#8b7cff]/30">REDEEMABLE</span>}
                        </td>
                        <td className="px-5 py-4 text-[#5d628f]">{p.endDate ? format(new Date(p.endDate), 'MMM d, HH:mm') : '—'}</td>
                      </tr>
                    );
                  })
                )}
                {resolved.length > 0 && (
                  <tr className="bg-[#0a0b1e]/80 border-t-2 border-[rgba(140,130,255,0.13)]">
                    <td className="px-5 py-4 font-semibold text-[#c3c8ee]" colSpan={2}>TOTAL — {resolved.length} settled</td>
                    <td className="px-5 py-4 text-right tabular-nums font-semibold text-[#eef0ff]">${resolvedInvested.toFixed(2)}</td>
                    <td className="px-5 py-4 text-right tabular-nums font-semibold text-[#eef0ff]">${resolvedReturned.toFixed(2)}</td>
                    <td className={`px-5 py-4 text-right tabular-nums font-bold ${resolvedPnl >= 0 ? 'text-[#2ce5a7]' : 'text-[#ff6b9d]'}`}>
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
        subtitle={closedTotals.truncated ? "most recent 2000 closed markets (Polymarket API cap) — newest first · click headers to sort" : "every fully-exited market (same source as polymarket.com RESULT list) · click headers to sort"}
        icon={<HistoryIcon className="w-5 h-5 text-[#a99cff]" />}
        actions={<>
          <input value={closedSearch} onChange={e => setClosedSearch(e.target.value)}
            placeholder="search market / $ / result…"
            className="w-44 bg-white/[0.05] border border-[rgba(140,130,255,0.2)] rounded-lg px-2.5 py-1 text-xs text-[#eef0ff] placeholder:text-[#5d628f] focus:outline-none focus:border-[#a99cff]" />
          <ExportBtn kind="closed" format="csv" label="Closed Positions History" />
          <ExportBtn kind="closed" format="pdf" label="Closed Positions History" />
        </>}>
        <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0a0b1e]/70 backdrop-blur text-[#8b91c5] text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-[rgba(140,130,255,0.15)]">
                <tr>
                  <SortHeader label="Market" col="market" sort={closedSort} onSort={c => setClosedSort(flip(closedSort, c))} />
                  <SortHeader label="Outcome" col="outcome" sort={closedSort} onSort={c => setClosedSort(flip(closedSort, c))} />
                  <SortHeader label="Invested" col="invested" sort={closedSort} onSort={c => setClosedSort(flip(closedSort, c))} right />
                  <SortHeader label="Got Back" col="back" sort={closedSort} onSort={c => setClosedSort(flip(closedSort, c))} right />
                  <SortHeader label="WON" col="won" sort={closedSort} onSort={c => setClosedSort(flip(closedSort, c))} right />
                  <SortHeader label="Total Traded" col="traded" sort={closedSort} onSort={c => setClosedSort(flip(closedSort, c))} right />
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(140,130,255,0.11)]">
                {closedSorted.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-[#5d628f]">No closed positions found.</td></tr>
                ) : (
                  closedSorted.map((p: any, i: number) => (
                    <tr key={`${p.conditionId}-${p.outcome}-${i}`} className="hover:bg-white/[0.08] transition-colors">
                      <td className="px-5 py-4 max-w-[220px] truncate text-[#eef0ff]" title={p.title}>{p.title}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide border ${p.pnl > 0.01 ? "bg-[#2ce5a7]/10 text-[#2ce5a7] border-[#2ce5a7]/30" : p.pnl < -0.01 ? "bg-[#ff6b9d]/10 text-[#ff6b9d] border-[#ff6b9d]/30" : "bg-slate-500/10 text-[#8b91c5] border-slate-500/20"}`}>
                          {p.result === "WON" ? "Won" : p.result === "LOST" ? "Lost" : "Flat"} · {p.outcome}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums text-[#8b91c5]">${(p.invested ?? 0).toFixed(2)}</td>
                      <td className="px-5 py-4 text-right tabular-nums text-[#8b91c5]">${(p.gotBack ?? 0).toFixed(2)}</td>
                      <td className={`px-5 py-4 text-right tabular-nums font-bold ${(p.pnl ?? 0) >= 0 ? 'text-[#2ce5a7]' : 'text-[#ff6b9d]'}`}>
                        {(p.pnl ?? 0) >= 0 ? '+' : ''}${(p.pnl ?? 0).toFixed(2)}
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums text-[#5d628f]">${(((p.invested ?? 0)) + ((p.gotBack ?? 0))).toFixed(2)}</td>
                    </tr>
                  ))
                )}
                {closedTotals.count > 0 && (
                  <tr className="bg-[#0a0b1e]/80 border-t-2 border-[rgba(140,130,255,0.13)]">
                    <td className="px-5 py-4 font-semibold text-[#c3c8ee]" colSpan={2}>
                      TOTAL — {closedTotals.count} closed ({closedTotals.wins} won)
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums font-semibold text-[#eef0ff]">${(closedTotals.invested ?? 0).toFixed(2)}</td>
                    <td className="px-5 py-4 text-right tabular-nums font-semibold text-[#eef0ff]">${(closedTotals.gotBack ?? 0).toFixed(2)}</td>
                    <td className={`px-5 py-4 text-right tabular-nums font-bold ${(closedTotals.pnl ?? 0) >= 0 ? 'text-[#2ce5a7]' : 'text-[#ff6b9d]'}`}>
                      {(closedTotals.pnl ?? 0) >= 0 ? '+' : ''}${(closedTotals.pnl ?? 0).toFixed(2)}
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
        icon={<Activity className="w-5 h-5 text-[#8b91c5]" />}
        actions={<>
          <input value={tradesSearch} onChange={e => setTradesSearch(e.target.value)}
            placeholder="search market / side / $…"
            className="w-44 bg-white/[0.05] border border-[rgba(140,130,255,0.2)] rounded-lg px-2.5 py-1 text-xs text-[#eef0ff] placeholder:text-[#5d628f] focus:outline-none focus:border-[#a99cff]" />
          <ExportBtn kind="trades" format="csv" label="Trade History" />
          <ExportBtn kind="trades" format="pdf" label="Trade History" />
        </>}>
        <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0a0b1e]/70 backdrop-blur text-[#8b91c5] text-xs uppercase tracking-wider font-medium sticky top-0 z-10 border-b border-[rgba(140,130,255,0.15)]">
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
              <tbody className="divide-y divide-[rgba(140,130,255,0.11)]">
                {tradesSorted.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-[#5d628f]">No trades found.</td></tr>
                ) : (
                  tradesSorted.map((t: any, i: number) => {
                    const notional = parseFloat(t.usdcSize) || (parseFloat(t.size) * parseFloat(t.price)) || 0;
                    return (
                      <tr key={`${t.transactionHash ?? "t"}-${t.asset ?? "x"}-${t.timestamp ?? i}-${i}`} className="hover:bg-white/[0.08] transition-colors group">
                        <td className="px-5 py-4 text-[#8b91c5] tabular-nums">{t.timestamp ? format(new Date(t.timestamp * 1000), "MMM d, HH:mm") : "—"}</td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase border ${
                            t.side === 'BUY'
                              ? 'bg-[#2ce5a7]/10 text-[#2ce5a7] border-[#2ce5a7]/30'
                              : 'bg-[#ff6b9d]/10 text-[#ff6b9d] border-[#ff6b9d]/30'
                          }`}>
                            {t.side}
                          </span>
                        </td>
                        <td className="px-5 py-4 max-w-[200px] truncate text-[#eef0ff]" title={t.title}>{t.title}</td>
                        <td className="px-5 py-4 text-[11px] text-[#8b91c5]">{t.outcome}</td>
                        <td className="px-5 py-4 text-right tabular-nums text-[#c3c8ee]">{(parseFloat(t.size) || 0).toLocaleString()}</td>
                        <td className="px-5 py-4 text-right tabular-nums text-[#c3c8ee]">${parseFloat(t.price).toFixed(3)}</td>
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

          {entriesModal.open && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setEntriesModal(m => ({ ...m, open: false }))}>
          <div className="pm-panel w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(140,130,255,0.15)]">
              <div>
                <p className="text-sm font-semibold text-[#eef0ff]">{entriesModal.title}</p>
                <p className="text-[11px] text-[#5d628f] mt-0.5">
                  {entriesModal.loading ? "loading entries…" : `${entriesModal.rows.length} entries · total $${entriesModal.rows.reduce((s, r) => s + (r.usdc || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                </p>
              </div>
              <button onClick={() => setEntriesModal(m => ({ ...m, open: false }))}
                className="text-[#8b91c5] hover:text-[#eef0ff] text-lg">✕</button>
            </div>
            <div className="overflow-y-auto">
              <table className="w-full text-left text-xs whitespace-nowrap pm-table">
                <thead className="bg-[#0a0b1e]/80 text-[#8b91c5] uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="px-5 py-2.5">Time</th>
                    <th className="px-5 py-2.5 text-right">Shares</th>
                    <th className="px-5 py-2.5 text-right">Price</th>
                    <th className="px-5 py-2.5 text-right">USD</th>
                    <th className="px-5 py-2.5">Tx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(140,130,255,0.1)] text-[#c3c8ee] tabular-nums">
                  {entriesModal.rows.map((r, k) => (
                    <tr key={k}>
                      <td className="px-5 py-2">{new Date(r.ts * 1000).toLocaleString()}</td>
                      <td className="px-5 py-2 text-right">{(r.size || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                      <td className="px-5 py-2 text-right">{((r.price || 0) * 100).toFixed(1)}¢</td>
                      <td className="px-5 py-2 text-right text-[#eef0ff]">${(r.usdc || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className="px-5 py-2 font-mono text-[10px] text-[#5d628f]">{(r.txHash || "").slice(0, 10)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}