"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { GitBranch, Loader2, X, MousePointerClick, ChevronRight } from "lucide-react";

/**
 * Money-flow graph between wallets: wallets = nodes, shared markets = edges.
 * Click an edge → per-trade drill-down for both wallets on every shared market.
 */

const PALETTE = ["#38BDF8", "#34D399", "#FB7185", "#FBBF24", "#A78BFA", "#F472B6"];

interface EdgeMarket {
  conditionId: string;
  title: string;
  slug: string;
  a: { invested: number; returned: number; pnl: number; firstBuyTs: number };
  b: { invested: number; returned: number; pnl: number; firstBuyTs: number };
  leader: string;
}
interface Edge {
  a: string; b: string;
  sharedMarkets: number;
  aNetOnShared: number; bNetOnShared: number;
  combinedVolume: number;
  markets: EdgeMarket[];
}
interface Node {
  wallet: string;
  totals: { markets: number; invested: number; returned: number; pnl: number; firstTradeTs: number; lastTradeTs: number };
  markets: any[];
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtSign = (n: number) => (n >= 0 ? "+" : "−") + "$" + fmt(Math.abs(n));
const pnlColor = (n: number) => (n >= 0 ? "text-[#34D399]" : "text-[#FB7185]");

export default function FlowPage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [drill, setDrill] = useState<any>(null);

  const walletList = input.split(/[\s,;]+/).map(w => w.trim()).filter(Boolean);

  const analyze = useCallback(async () => {
    setError(""); setSelectedEdge(null); setDrill(null);
    setLoading(true);
    try {
      const res = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallets: walletList }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "analysis failed"); return; }
      setNodes(d.nodes); setEdges(d.edges);
    } catch {
      setError("request failed");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const openEdge = async (e: Edge) => {
    setSelectedEdge(e); setDrill({ loading: true, rows: [] });
    try {
      const res = await fetch("/api/analysis/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletA: e.a, walletB: e.b, conditionId: e.markets[0].conditionId }),
      });
      const d = await res.json();
      setDrill(d);
    } catch {
      setDrill({ error: "failed" });
    }
  };

  // --- layout: nodes on a circle ---
  const W = 760, H = 420, R = 150, CX = W / 2, CY = H / 2;
  const pos = (i: number, n: number) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    return { x: CX + R * Math.cos(ang), y: CY + R * Math.sin(ang) };
  };
  const colorOf = (wallet: string) => PALETTE[nodes.findIndex(n => n.wallet === wallet) % PALETTE.length];
  const label = (wallet: string) => {
    const n = nodes.find(n => n.wallet === wallet);
    return n ? wallet.slice(0, 6) + "…" + wallet.slice(-4) : wallet.slice(0, 8);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-semibold mb-1 tracking-tight text-white flex items-center gap-2">
          <GitBranch className="w-6 h-6 text-[#38BDF8]" /> Money Flow Graph
        </h1>
        <p className="text-sm text-slate-400 uppercase tracking-wide">Reveal money circulation between 2–6 wallets via shared markets</p>
        <p className="text-xs text-slate-500 mt-1">Real cashflow per market: invested vs got-back (buys/sells/redemptions). Click an edge for the exact trades behind it.</p>
      </div>

      {/* input */}
      <div className="bg-[#111827] border border-slate-800/50 p-5 rounded-2xl shadow-sm">
        <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">Wallet addresses (2–6, space/comma/newline separated)</label>
        <textarea value={input} onChange={e => setInput(e.target.value)} rows={3}
          placeholder={"0x14e7752d2716cd3b5bcbe8c08d4561491d9ebb64\n0x78becf0a4e4f2640380af0c19ad32e2557e6bde0"}
          className="w-full bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm font-mono focus:outline-none focus:border-[#38BDF8] placeholder:text-slate-500" />
        <div className="flex items-center gap-3 mt-3">
          <button onClick={analyze} disabled={loading || walletList.length < 2}
            className="flex items-center gap-2 bg-[#38BDF8] hover:bg-[#38BDF8]/80 disabled:opacity-40 disabled:cursor-not-allowed text-[#0B1120] font-semibold rounded-xl px-5 py-2 text-sm transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
            {loading ? "Analyzing ledgers…" : "Analyze flow"}
          </button>
          {error && <span className="text-[#FB7185] text-xs">{error}</span>}
        </div>
      </div>

      {/* graph */}
      {nodes.length >= 2 && (
        <div className="bg-[#111827] border border-slate-800/50 rounded-2xl p-4 shadow-sm overflow-x-auto">
          <svg width={W} height={H} className="mx-auto block">
            {/* edges */}
            {edges.map((e, i) => {
              const ia = nodes.findIndex(n => n.wallet === e.a);
              const ib = nodes.findIndex(n => n.wallet === e.b);
              const pa = pos(ia, nodes.length), pb = pos(ib, nodes.length);
              const active = selectedEdge?.a === e.a && selectedEdge?.b === e.b;
              const stroke = active ? "#FBBF24" : "#334155";
              const wdt = Math.min(10, 2 + e.sharedMarkets / 3);
              return (
                <g key={i} className="cursor-pointer" onClick={() => openEdge(e)}>
                  <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={stroke} strokeWidth={wdt} opacity={active ? 0.95 : 0.6} />
                  <circle cx={(pa.x + pb.x) / 2} cy={(pa.y + pb.y) / 2} r={13} fill="#0B1120" stroke={stroke} strokeWidth={1.5} />
                  <text x={(pa.x + pb.x) / 2} y={(pa.y + pb.y) / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={active ? "#FBBF24" : "#94A3B8"}>
                    {e.sharedMarkets}
                  </text>
                </g>
              );
            })}
            {/* nodes */}
            {nodes.map((n, i) => {
              const p = pos(i, nodes.length);
              const c = colorOf(n.wallet);
              return (
                <g key={n.wallet}>
                  <circle cx={p.x} cy={p.y} r={44} fill="#0B1120" stroke={c} strokeWidth={2.5} />
                  <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={13} fontWeight={700} fill={c}>
                    {n.wallet.slice(0, 6)}…{n.wallet.slice(-4)}
                  </text>
                  <text x={p.x} y={p.y + 10} textAnchor="middle" fontSize={12} fontWeight={600} fill={n.totals.pnl >= 0 ? "#34D399" : "#FB7185"}>
                    {fmtSign(n.totals.pnl)}
                  </text>
                  <text x={p.x} y={p.y + 26} textAnchor="middle" fontSize={10} fill="#64748B">
                    {n.totals.markets} markets · ${fmt(n.totals.invested)} in
                  </text>
                </g>
              );
            })}
          </svg>
          {edges.length === 0 && (
            <p className="text-center text-slate-500 text-sm pb-3">No shared markets between these wallets — no money circulation detected.</p>
          )}
          {edges.length > 0 && (
            <p className="text-center text-xs text-slate-500 flex items-center justify-center gap-1.5">
              <MousePointerClick className="w-3.5 h-3.5" /> Click an edge (number = shared markets) to drill into the exact trades
            </p>
          )}
        </div>
      )}

      {/* edge summary table */}
      {edges.length > 0 && (
        <div className="bg-[#111827] border border-slate-800/50 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0B1120]/80 text-slate-400 text-xs uppercase tracking-wider font-medium border-b border-slate-800/80">
                <tr>
                  <th className="px-5 py-3">Pair</th>
                  <th className="px-5 py-3 text-right">Shared Markets</th>
                  <th className="px-5 py-3 text-right">Combined Volume</th>
                  <th className="px-5 py-3 text-right">Net on Shared Markets</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {edges.map((e, i) => (
                  <tr key={i} className={`hover:bg-[#1E2939]/60 ${selectedEdge === e ? "bg-[#1E2939]/80" : ""}`}>
                    <td className="px-5 py-3">
                      <span style={{ color: colorOf(e.a) }} className="font-mono font-medium">{label(e.a)}</span>
                      <span className="text-slate-500 mx-1.5">↔</span>
                      <span style={{ color: colorOf(e.b) }} className="font-mono font-medium">{label(e.b)}</span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-200 font-semibold">{e.sharedMarkets}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-400">${fmt(e.combinedVolume)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      <span className={pnlColor(e.aNetOnShared)}>{label(e.a)} {fmtSign(e.aNetOnShared)}</span>
                      <span className="text-slate-600 mx-1">/</span>
                      <span className={pnlColor(e.bNetOnShared)}>{label(e.b)} {fmtSign(e.bNetOnShared)}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => openEdge(e)} className="text-[#38BDF8] hover:underline text-xs font-medium">Details →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* drill-down panel */}
      {selectedEdge && (
        <div className="bg-[#111827] border border-yellow-400/30 rounded-2xl shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/80">
            <h3 className="text-sm font-semibold text-slate-200">
              Shared markets: <span style={{ color: colorOf(selectedEdge.a) }} className="font-mono">{label(selectedEdge.a)}</span>
              <span className="text-slate-500 mx-1.5">↔</span>
              <span style={{ color: colorOf(selectedEdge.b) }} className="font-mono">{label(selectedEdge.b)}</span>
            </h3>
            <button onClick={() => { setSelectedEdge(null); setDrill(null); }} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
          </div>
          <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-800/50">
            {selectedEdge.markets.map(m => (
              <MarketDetail key={m.conditionId} m={m} e={selectedEdge} colorA={colorOf(selectedEdge.a)} colorB={colorOf(selectedEdge.b)} labelA={label(selectedEdge.a)} labelB={label(selectedEdge.b)} drill={drill} setDrill={setDrill} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MarketDetail({ m, e, colorA, colorB, labelA, labelB, drill, setDrill }: any) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setOpen(o => !o);
    if (!loaded && !open) {
      const res = await fetch("/api/analysis/market", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletA: e.a, walletB: e.b, conditionId: m.conditionId }),
      });
      const d = await res.json();
      setDrill({ ...d, key: m.conditionId });
      setLoaded(true);
    }
  };

  return (
    <div className="px-5 py-3">
      <button onClick={load} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="text-sm text-slate-200 truncate" title={m.title}>{m.title || m.conditionId.slice(0, 18)}</p>
          <p className="text-[11px] mt-0.5">
            <span style={{ color: colorA }}>{labelA} {fmtSign(m.a.pnl)}</span>
            <span className="text-slate-600 mx-1.5">·</span>
            <span className={pnlColor(m.a.pnl)}>${fmt(m.a.invested)} → ${fmt(m.a.returned)}</span>
            <span className="text-slate-600 mx-1.5">vs</span>
            <span style={{ color: colorB }}>{labelB} {fmtSign(m.b.pnl)}</span>
            <span className="text-slate-600 mx-1.5">·</span>
            <span className={pnlColor(m.b.pnl)}>${fmt(m.b.invested)} → ${fmt(m.b.returned)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-700 text-slate-400">
            {m.leader === "a" ? `◀ ${labelA} led` : m.leader === "b" ? `${labelB} led ▶` : "tie"}
          </span>
          <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${open ? "rotate-90" : ""}`} />
        </div>
      </button>

      {open && (
        <div className="mt-3 grid md:grid-cols-2 gap-3">
          {[{ k: "a", label: labelA, color: colorA, rows: drill?.key === m.conditionId ? drill.a : undefined },
            { k: "b", label: labelB, color: colorB, rows: drill?.key === m.conditionId ? drill.b : undefined }].map(col => (
            <div key={col.k} className="bg-[#0B1120] border border-slate-800 rounded-xl p-3">
              <p className="text-xs font-bold mb-2" style={{ color: col.color }}>{col.label} — exact trades</p>
              {!col.rows ? (
                <p className="text-xs text-slate-500">Loading…</p>
              ) : col.rows.length === 0 ? (
                <p className="text-xs text-slate-500">No activity rows.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <tbody>
                    {col.rows.map((r: any, i: number) => (
                      <tr key={i} className="border-b border-slate-800/50 last:border-0">
                        <td className="py-1 pr-2 text-slate-500">{format(new Date(r.timestamp * 1000), "MMM d HH:mm")}</td>
                        <td className={`py-1 pr-2 font-bold ${r.type === "REDEEM" ? "text-[#38BDF8]" : r.side === "BUY" ? "text-[#34D399]" : "text-[#FB7185]"}`}>
                          {r.type === "REDEEM" ? "REDEEM" : r.side}
                        </td>
                        <td className="py-1 pr-2 text-slate-400">{r.outcome}</td>
                        <td className="py-1 pr-2 text-right tabular-nums text-slate-300">{fmt(r.size)} sh</td>
                        <td className="py-1 pr-2 text-right tabular-nums text-slate-400">{(r.price * 100).toFixed(1)}¢</td>
                        <td className="py-1 text-right tabular-nums text-white font-medium">${fmt(r.usdcSize)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
