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
      className={`px-4 py-3 cursor-pointer select-none hover:text-[#eef0ff] ${right ? "text-right" : ""}`}>
      {label} {sortKey === key && (dir === 1 ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)}
    </th>
  );

  return (
    <div className="space-y-6 rise-in">
      <div>
        <h1 className="text-2xl font-semibold mb-1 tracking-tight text-white flex items-center gap-2">
          <Star className="w-6 h-6 text-yellow-400 fill-yellow-400" /> Starred Wallets
        </h1>
        <p className="text-sm text-[#8b91c5] uppercase tracking-wide">Your watchlist — starred wallets are automatically covered by ⭐ position-open alerts</p>
        <p className="text-xs text-[#5d628f] mt-1">Add notes to remember why you starred someone. Star people from the Users list or any profile page.</p>
      </div>

      <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0a0b1e]/70 backdrop-blur text-[#8b91c5] text-xs uppercase tracking-wider font-medium border-b border-[rgba(140,130,255,0.15)]">
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
            <tbody className="divide-y divide-[rgba(140,130,255,0.11)]">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-[#5d628f]"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-[#5d628f]">Nothing starred yet — tap the ☆ on any user.</td></tr>
              ) : (
                sorted.map(r => (
                  <tr key={r.wallet} className="hover:bg-white/[0.08] align-top">
                    <td className="px-4 py-3">
                      <button onClick={() => unstar(r.wallet)} title="Remove from starred">
                        <Star className="w-4 h-4 text-yellow-400 fill-yellow-400 hover:text-[#5d628f] hover:fill-slate-600" />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/users/${r.wallet}`} className="text-[#a99cff] hover:underline font-medium">
                        {r.pseudonym || r.name || (r.wallet.slice(0, 6) + "…" + r.wallet.slice(-4))}
                      </Link>
                      <a href={`https://polymarket.com/profile/${r.wallet}`} target="_blank" rel="noreferrer" className="ml-1.5 text-[#5d628f] hover:text-[#a99cff]"><ExternalLink className="w-3 h-3 inline" /></a>
                      <p className="text-[10px] font-mono text-[#5d628f] mt-0.5">{r.wallet}</p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#2ce5a7] font-medium">${(r.max_single_bet ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#c3c8ee]">${(r.total_notional ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#c3c8ee]">{(r.trade_count ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-[#8b91c5]">{r.last_active ? formatDistanceToNow(new Date(r.last_active * 1000), { addSuffix: true }) : "—"}</td>
                    <td className="px-4 py-3 min-w-[240px]">
                      {editing === r.wallet ? (
                        <div>
                          <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={3} autoFocus
                            placeholder="Why did you star this wallet? Strategy, patterns, suspicions…"
                            className="w-full bg-white/[0.08] text-white border border-[rgba(140,130,255,0.15)] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#a99cff] placeholder:text-[#5d628f]" />
                          <div className="flex gap-2 mt-1.5">
                            <button onClick={() => saveNote(r.wallet)} className="text-xs bg-gradient-to-r from-[#6c5ce7] to-[#7170ff] text-white font-semibold rounded-md px-3 py-1">Save</button>
                            <button onClick={() => setEditing(null)} className="text-xs text-[#8b91c5] hover:text-[#eef0ff] px-2 py-1">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setEditing(r.wallet); setNoteDraft(r.note || ""); }} className="text-left w-full group">
                          {r.note ? (
                            <p className="text-xs text-[#c3c8ee] whitespace-pre-wrap group-hover:text-[#eef0ff]">{r.note}</p>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-[#5d628f] group-hover:text-[#8b91c5]">
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
