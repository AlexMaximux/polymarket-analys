"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow, format } from "date-fns";
import { Star, StickyNote, Loader2, X, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

export default function StarredPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [sortKey, setSortKey] = useState<"max_single_bet" | "last_active" | "trade_count">("max_single_bet");
  const [dir, setDir] = useState<1 | -1>(-1);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/watchlist");
    const d = await res.json();
    setRows(d.starred || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveNote = async (wallet: string) => {
    const res = await fetch("/api/watchlist", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, note: noteDraft }),
    });
    if (res.ok) {
      setRows(rs => rs.map(r => r.wallet === wallet ? { ...r, note: noteDraft } : r));
      setEditing(null);
    }
  };

  const unstar = async (wallet: string) => {
    await fetch(`/api/watchlist?wallet=${wallet}`, { method: "DELETE" });
    setRows(rs => rs.filter(r => r.wallet !== wallet));
  };

  const sorted = [...rows].sort((a, b) => {
    const va = a[sortKey] || 0, vb = b[sortKey] || 0;
    return (va - vb) * dir;
  });
  const th = (key: typeof sortKey, label: string, right = false) => (
    <th onClick={() => { sortKey === key ? setDir(d => (d === 1 ? -1 : 1)) : (setSortKey(key), setDir(-1)); }}
      className={`px-4 py-3 cursor-pointer select-none hover:text-slate-200 ${right ? "text-right" : ""}`}>
      {label} {sortKey === key && (dir === 1 ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)}
    </th>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-semibold mb-1 tracking-tight text-white flex items-center gap-2">
          <Star className="w-6 h-6 text-yellow-400 fill-yellow-400" /> Starred Wallets
        </h1>
        <p className="text-sm text-slate-400 uppercase tracking-wide">Your watchlist — starred wallets are automatically covered by ⭐ position-open alerts</p>
        <p className="text-xs text-slate-500 mt-1">Add notes to remember why you starred someone. Star people from the Users list or any profile page.</p>
      </div>

      <div className="bg-[#111827] border border-slate-800/50 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0B1120]/80 backdrop-blur text-slate-400 text-xs uppercase tracking-wider font-medium border-b border-slate-800/80">
              <tr>
                <th className="px-4 py-3 w-10"></th>
                <th className="px-4 py-3">Wallet</th>
                {th("max_single_bet", "Max Bet", true)}
                <th className="px-4 py-3 text-right">Total Vol</th>
                {th("trade_count", "Trades", true)}
                {th("last_active", "Last Active")}
                <th className="px-4 py-3">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">Nothing starred yet — tap the ☆ on any user.</td></tr>
              ) : (
                sorted.map(r => (
                  <tr key={r.wallet} className="hover:bg-[#1E2939]/60 align-top">
                    <td className="px-4 py-3">
                      <button onClick={() => unstar(r.wallet)} title="Remove from starred">
                        <Star className="w-4 h-4 text-yellow-400 fill-yellow-400 hover:text-slate-500 hover:fill-slate-600" />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/users/${r.wallet}`} className="text-[#38BDF8] hover:underline font-medium">
                        {r.pseudonym || r.name || (r.wallet.slice(0, 6) + "…" + r.wallet.slice(-4))}
                      </Link>
                      <a href={`https://polymarket.com/profile/${r.wallet}`} target="_blank" rel="noreferrer" className="ml-1.5 text-slate-600 hover:text-[#38BDF8]"><ExternalLink className="w-3 h-3 inline" /></a>
                      <p className="text-[10px] font-mono text-slate-600 mt-0.5">{r.wallet}</p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#34D399] font-medium">${(r.max_single_bet ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-300">${(r.total_notional ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-300">{(r.trade_count ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-400">{r.last_active ? formatDistanceToNow(new Date(r.last_active * 1000), { addSuffix: true }) : "—"}</td>
                    <td className="px-4 py-3 min-w-[240px]">
                      {editing === r.wallet ? (
                        <div>
                          <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={3} autoFocus
                            placeholder="Why did you star this wallet? Strategy, patterns, suspicions…"
                            className="w-full bg-[#1E2939] text-white border border-slate-700 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#38BDF8] placeholder:text-slate-600" />
                          <div className="flex gap-2 mt-1.5">
                            <button onClick={() => saveNote(r.wallet)} className="text-xs bg-[#38BDF8] text-[#0B1120] font-semibold rounded-md px-3 py-1">Save</button>
                            <button onClick={() => setEditing(null)} className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setEditing(r.wallet); setNoteDraft(r.note || ""); }} className="text-left w-full group">
                          {r.note ? (
                            <p className="text-xs text-slate-300 whitespace-pre-wrap group-hover:text-slate-100">{r.note}</p>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-600 group-hover:text-slate-400">
                              <StickyNote className="w-3 h-3" /> add note…
                            </span>
                          )}
                        </button>
                      )}
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
