"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bitcoin, RefreshCw, Clock, Activity, Zap } from "lucide-react";

const COINS = [
  { key: "btc", label: "Bitcoin", sym: "₿", color: "#F7931A" },
  { key: "eth", label: "Ethereum", sym: "Ξ", color: "#627EEA" },
  { key: "sol", label: "Solana", sym: "◎", color: "#14F195" },
  { key: "xrp", label: "XRP", sym: "✕", color: "#7FA8C9" },
  { key: "doge", label: "Dogecoin", sym: "Ð", color: "#C2A633" },
  { key: "hype", label: "Hyperliquid", sym: "H", color: "#97FCE4" },
  { key: "zec", label: "ZCash", sym: "ⓩ", color: "#F4B728" },
  { key: "bnb", label: "BNB", sym: "◆", color: "#F3BA2F" },
];

interface MarketRow {
  slug: string; title: string; up: number; down: number; live: number | null; liveDown?: number | null;
  closed: boolean; accepting: boolean; tokenUp: string;
}

function pct(v: number | null | undefined) {
  return v == null ? "—" : (v * 100).toFixed(1) + "¢";
}

export default function UpDownPage() {
  const [coin, setCoin] = useState("btc");
  const [sigma, setSigma] = useState(0.02);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [countdown, setCountdown] = useState(5);
  const [liveMode, setLiveMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/updown?coin=${coin}&sigma=${sigma}`, { cache: "no-store" });
      if (!res.ok) throw new Error("API " + res.status);
      const d = await res.json();
      setData(d);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [coin, sigma]);

  // polling loop (5s default)
  useEffect(() => {
    load();
    if (!auto) return;
    const iv = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { load(); return 5; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [load, auto]);

  const m = data?.model;
  const m5model = data?.model5;
  const m1h: MarketRow | null = data?.m1h;
  const m15: MarketRow | null = data?.m15;
  const m5: MarketRow | null = data?.m5;
  const n15 = data?.n15, n5 = data?.n5;
  const market1h = m1h?.live ?? m1h?.up ?? null;
  const fair = m?.fairUp ?? null;
  const edge = m?.edge ?? null;

  const nowClk = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const fmt = (v: number | null | undefined, digits = 2) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits }));
  const snapshot = [
    `1- Current time (${nowClk})`,
    `2- S0 = ${fmt(m?.s0, 2)}`,
    `3- SA = ${fmt(m?.sa, 2)}`,
    `4- ST = ${fmt(m?.st, 2)}`,
    `5- P15 = ${m?.p15 != null ? (m.p15 * 100).toFixed(2) + "¢" : "—"}`,
    `6- P5 = ${m5?.live != null ? (m5.live * 100).toFixed(2) + "¢" : "—"}`,
  ].join("\n");

  const copySnapshot = async () => {
    try {
      await navigator.clipboard.writeText(snapshot);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const Row = ({ title, row, next }: { title: string; row: MarketRow | null; next?: MarketRow | null }) => (
    <div className="bg-[#111827] border border-slate-800/50 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-wider text-slate-400 font-medium">{title}</p>
        {row?.accepting ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-[#34D399]"><span className="w-1.5 h-1.5 rounded-full bg-[#34D399] animate-pulse" /> OPEN</span>
        ) : (
          <span className="text-[10px] text-slate-500">CLOSED</span>
        )}
      </div>
      {row ? (
        <>
          <p className="text-sm text-slate-200 font-medium mb-3 truncate" title={row.title}>{row.title}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-xl p-3 border ${ (row.live ?? row.up) >= 0.5 ? "bg-[#34D399]/10 border-[#34D399]/30" : "bg-[#1E2939]/60 border-slate-700/50"}`}>
              <p className="text-[10px] uppercase text-slate-400 mb-1">Up</p>
              <p className={`text-2xl font-bold tabular-nums ${(row.live ?? row.up) >= 0.5 ? "text-[#34D399]" : "text-slate-300"}`}>{pct(row.live ?? row.up)}</p>
            </div>
            <div className={`rounded-xl p-3 border ${ (row.liveDown ?? 1 - (row.live ?? row.up)) > 0.5 ? "bg-[#FB7185]/10 border-[#FB7185]/30" : "bg-[#1E2939]/60 border-slate-700/50"}`}>
              <p className="text-[10px] uppercase text-slate-400 mb-1">Down</p>
              <p className={`text-2xl font-bold tabular-nums ${(row.liveDown ?? 1 - (row.live ?? row.up)) > 0.5 ? "text-[#FB7185]" : "text-slate-300"}`}>{pct(row.liveDown ?? 1 - (row.live ?? row.up))}</p>
            </div>
          </div>
        </>
      ) : next ? (
        <p className="text-xs text-slate-500">
          no active market — next opens: <span className="text-slate-300">{next.title?.replace(/^.*? - /, "")}</span>
        </p>
      ) : (
        <p className="text-xs text-slate-500">market not found</p>
      )}
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1 tracking-tight text-white flex items-center gap-2">
            <Zap className="w-6 h-6 text-[#FBBF24]" /> Up/Down Markets — Live Fair Value
          </h1>
          <p className="text-sm text-slate-400">Polymarket hourly &amp; sub-hourly crypto markets, synced live · drift-extraction fair value for the 1H</p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />}
          {auto && !loading && <span className="text-xs text-slate-500 tabular-nums">next refresh {countdown}s</span>}
          <button onClick={() => setAuto(a => !a)}
            className={`text-xs font-medium rounded-lg px-3 py-1.5 border ${auto ? "bg-[#34D399]/10 text-[#34D399] border-[#34D399]/30" : "text-slate-400 border-slate-700"}`}>
            {auto ? "Auto 5s ON" : "Auto OFF"}
          </button>
          <button onClick={load} className="text-xs font-medium rounded-lg px-3 py-1.5 border border-slate-700 text-slate-300 hover:border-slate-500">
            Refresh
          </button>
        </div>
      </div>

      {/* coin selector */}
      <div className="flex flex-wrap gap-2">
        {COINS.map(c => (
          <button key={c.key} onClick={() => setCoin(c.key)}
            className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-full px-4 py-1.5 border transition-colors ${coin === c.key ? "text-[#0B1120] border-transparent" : "text-slate-400 border-slate-700 hover:border-slate-500"}`}
            style={coin === c.key ? { background: c.color } : {}}>
            <span>{c.sym}</span> {c.label}
          </button>
        ))}
      </div>

      {err && <div className="bg-[#FB7185]/10 border border-[#FB7185]/30 text-[#FB7185] rounded-xl px-4 py-3 text-sm">{err}</div>}

      {/* three market cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <Row title="1 Hour market" row={m1h} />
        <Row title="15 minute market" row={m15} next={n15} />
        <Row title="5 minute market" row={m5} next={n5} />
      </div>

      {/* model panel */}
      <div className="bg-[#111827] border border-slate-800/50 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-[#38BDF8]" />
            <h2 className="text-lg font-medium text-white">Fair Value Model — 1H Up</h2>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            σ₁ₕ (hourly vol):
            <input type="number" step="0.005" min="0.005" max="0.2" value={sigma}
              onChange={e => setSigma(parseFloat(e.target.value) || 0.02)}
              className="w-20 bg-[#1E2939] border border-slate-700 rounded-lg px-2 py-1 text-white tabular-nums focus:outline-none focus:border-[#38BDF8]" />
          </label>
        </div>

        {m ? (
          <div className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-[#0B1120] rounded-xl p-4 border border-slate-800/60">
                <p className="text-[10px] uppercase text-slate-500 mb-1">Model fair value (Up)</p>
                <p className="text-3xl font-bold text-[#38BDF8] tabular-nums">{(fair * 100).toFixed(1)}¢</p>
              </div>
              <div className="bg-[#0B1120] rounded-xl p-4 border border-slate-800/60">
                <p className="text-[10px] uppercase text-slate-500 mb-1">Market price (Up)</p>
                <p className="text-3xl font-bold text-white tabular-nums">{market1h != null ? (market1h * 100).toFixed(1) + "¢" : "—"}</p>
              </div>
              <div className={`bg-[#0B1120] rounded-xl p-4 border ${edge != null && Math.abs(edge) > 0.03 ? (edge > 0 ? "border-[#34D399]/40" : "border-[#FB7185]/40") : "border-slate-800/60"}`}>
                <p className="text-[10px] uppercase text-slate-500 mb-1">Edge (fair − market)</p>
                <p className={`text-3xl font-bold tabular-nums ${edge == null ? "text-slate-500" : edge > 0.03 ? "text-[#34D399]" : edge < -0.03 ? "text-[#FB7185]" : "text-slate-300"}`}>
                  {edge == null ? "—" : (edge > 0 ? "+" : "") + (edge * 100).toFixed(1) + "¢"}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">{edge != null && Math.abs(edge) > 0.03 ? (edge > 0 ? "Up looks underpriced" : "Down looks underpriced") : "within noise band ±3¢"}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="text-slate-500 uppercase tracking-wider border-b border-slate-800/80">
                  <tr><th className="py-2 pr-4">input</th><th className="py-2 pr-4">value</th><th className="py-2 pr-4">input</th><th className="py-2">value</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 text-slate-300 tabular-nums">
                  <tr><td className="py-1.5 pr-4">t (min into hour)</td><td className="py-1.5 pr-4">{m.t.toFixed(2)}</td><td className="py-1.5 pr-4">S₀ (hour open)</td><td className="py-1.5">${m.s0?.toLocaleString()}</td></tr>
                  <tr><td className="py-1.5 pr-4">a (15m block start)</td><td className="py-1.5 pr-4">:{String(Math.floor(m.a)).padStart(2, "0")}</td><td className="py-1.5 pr-4">Sₐ (block open)</td><td className="py-1.5">${m.sa?.toLocaleString()}</td></tr>
                  <tr><td className="py-1.5 pr-4">q (into block)</td><td className="py-1.5 pr-4">{m.q.toFixed(2)}</td><td className="py-1.5 pr-4">Sₜ (now)</td><td className="py-1.5">${m.st?.toLocaleString()}</td></tr>
                  <tr><td className="py-1.5 pr-4">τ₁₅ remaining</td><td className="py-1.5 pr-4">{m.tau15.toFixed(2)} min</td><td className="py-1.5 pr-4">xₜ = ln(Sₜ/S₀)</td><td>{m.xt.toFixed(5)}</td></tr>
                  <tr><td className="py-1.5 pr-4">τ₆₀ remaining</td><td className="py-1.5 pr-4">{m.tau60.toFixed(2)} min</td><td className="py-1.5 pr-4">y = ln(Sₜ/Sₐ)</td><td>{m.y.toFixed(5)}</td></tr>
                  <tr><td className="py-1.5 pr-4">σ₁ₕ / σₘ</td><td className="py-1.5 pr-4">{m.sigma1h} / {m.sigmaM.toFixed(5)}</td><td className="py-1.5 pr-4">p₁₅ (live 15m Up)</td><td>{(m.p15 * 100).toFixed(1)}¢</td></tr>
                  <tr><td className="py-1.5 pr-4">z₁₅ = Φ⁻¹(p₁₅)</td><td className="py-1.5 pr-4">{m.z15.toFixed(4)}</td><td className="py-1.5 pr-4">μ (implied drift)</td><td className={m.mu >= 0 ? "text-[#34D399]" : "text-[#FB7185]"}>{m.mu.toFixed(6)}/min</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500">
              μ extracted from the live 15¢ market: μ = (z₁₅·σₘ·√τ₁₅ − y) / τ₁₅ · fair = Φ((xₜ + μ·τ₆₀)/(σₘ·√τ₆₀)) · spot: Binance 1m klines (S₀ = hour open, Sₐ = active 15m block open) · market: CLOB midpoints
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            {m1h?.closed
              ? "1H market already settled — model needs an active hour market."
              : "Waiting for spot + market data (need S₀, Sₜ and a live 15m price in (0,1))."}
          </p>
        )}
      </div>

            {/* 5m-calibrated model panel */}
      {m5model ? (
        <div className="bg-[#111827] border border-slate-800/50 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-[#FBBF24]" />
            <h2 className="text-lg font-medium text-white">Fair Value Model — 1H Up <span className="text-xs text-slate-500">(calibrated on the 5-minute market)</span></h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-[#0B1120] rounded-xl p-4 border border-slate-800/60">
              <p className="text-[10px] uppercase text-slate-500 mb-1">Model fair value (Up) — 5m calib</p>
              <p className="text-3xl font-bold text-[#FBBF24] tabular-nums">{(m5model.fairUp * 100).toFixed(1)}¢</p>
            </div>
            <div className="bg-[#0B1120] rounded-xl p-4 border border-slate-800/60">
              <p className="text-[10px] uppercase text-slate-500 mb-1">Market price (Up)</p>
              <p className="text-3xl font-bold text-white tabular-nums">{market1h != null ? (market1h * 100).toFixed(1) + "¢" : "—"}</p>
            </div>
            <div className={`bg-[#0B1120] rounded-xl p-4 border ${m5model.edge != null && Math.abs(m5model.edge) > 0.03 ? (m5model.edge > 0 ? "border-[#34D399]/40" : "border-[#FB7185]/40") : "border-slate-800/60"}`}>
              <p className="text-[10px] uppercase text-slate-500 mb-1">Edge (fair − market)</p>
              <p className={`text-3xl font-bold tabular-nums ${m5model.edge == null ? "text-slate-500" : m5model.edge > 0.03 ? "text-[#34D399]" : m5model.edge < -0.03 ? "text-[#FB7185]" : "text-slate-300"}`}>
                {m5model.edge == null ? "—" : (m5model.edge > 0 ? "+" : "") + (m5model.edge * 100).toFixed(1) + "¢"}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <tbody className="divide-y divide-slate-800/40 text-slate-300 tabular-nums">
                <tr><td className="py-1.5 pr-4">a₅ (5m block start)</td><td className="py-1.5 pr-4">:{String(Math.floor(m5model.a5)).padStart(2, "0")}</td><td className="py-1.5 pr-4">Sₐ₅ (block open)</td><td className="py-1.5">${m5model.sa5?.toLocaleString()}</td></tr>
                <tr><td className="py-1.5 pr-4">q₅ (into block)</td><td className="py-1.5 pr-4">{m5model.q5.toFixed(2)}</td><td className="py-1.5 pr-4">y₅ = ln(Sₜ/Sₐ₅)</td><td>{m5model.y5.toFixed(5)}</td></tr>
                <tr><td className="py-1.5 pr-4">τ₅ remaining</td><td className="py-1.5 pr-4">{m5model.tau5.toFixed(2)} min</td><td className="py-1.5 pr-4">p₅ (live 5m Up)</td><td>{(m5model.p5 * 100).toFixed(1)}¢</td></tr>
                <tr><td className="py-1.5 pr-4">z₅ = Φ⁻¹(p₅)</td><td className="py-1.5 pr-4">{m5model.z5.toFixed(4)}</td><td className="py-1.5 pr-4">μ₅ (implied drift)</td><td className={m5model.mu5 >= 0 ? "text-[#34D399]" : "text-[#FB7185]"}>{m5model.mu5.toFixed(6)}/min</td></tr>
                <tr><td className="py-1.5 pr-4">τ₆₀ remaining</td><td className="py-1.5 pr-4">{m?.tau60?.toFixed(2) ?? "—"} min</td><td className="py-1.5 pr-4">xₜ = ln(Sₜ/S₀)</td><td>{m?.xt?.toFixed(5) ?? "—"}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500 mt-3">
            Same formula as the 15m panel, but μ extracted from the live 5¢ market: μ₅ = (z₅·σₘ·√τ₅ − y₅) / τ₅ · fair = Φ((xₜ + μ₅·τ₆₀)/(σₘ·√τ₆₀))
          </p>
        </div>
      ) : null}

{/* debug snapshot table */}
      <div className="bg-[#111827] border border-slate-800/50 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-300 uppercase tracking-wider">Model Inputs — Snapshot</h3>
          <button onClick={copySnapshot}
            className={`text-xs font-medium rounded-lg px-3 py-1.5 border transition-colors ${copied ? "bg-[#34D399]/10 text-[#34D399] border-[#34D399]/30" : "text-slate-300 border-slate-700 hover:border-slate-500"}`}>
            {copied ? "✓ Copied" : "Copy all"}
          </button>
        </div>
        <table className="w-full text-left text-sm whitespace-nowrap">
          <tbody className="divide-y divide-slate-800/40 text-slate-300 tabular-nums">
            <tr><td className="py-2 pr-6 text-slate-500">1- Current time</td><td className="py-2">{nowClk}</td></tr>
            <tr><td className="py-2 pr-6 text-slate-500">2- S0</td><td className="py-2">${fmt(m?.s0)}</td><td className="py-2 pl-6 text-[10px] text-slate-600">hour open ({data?.openSources?.s0 === "polymarket-chainlink" ? "Chainlink" : "Binance"})</td></tr>
            <tr><td className="py-2 pr-6 text-slate-500">3- SA</td><td className="py-2">${fmt(m?.sa)}</td><td className="py-2 pl-6 text-[10px] text-slate-600">15m block open ({data?.openSources?.sa === "polymarket-chainlink" ? "Chainlink" : "Binance"})</td></tr>
            <tr><td className="py-2 pr-6 text-slate-500">4- ST</td><td className="py-2">${fmt(m?.st)}</td><td className="py-2 pl-6 text-[10px] text-slate-600">live spot (Binance)</td></tr>
            <tr><td className="py-2 pr-6 text-slate-500">5- P15</td><td className="py-2">{m?.p15 != null ? (m.p15 * 100).toFixed(2) + "¢" : "—"}</td><td className="py-2 pl-6 text-[10px] text-slate-600">live 15m Up (CLOB mid)</td></tr>
            <tr><td className="py-2 pr-6 text-slate-500">6- P5</td><td className="py-2">{m5?.live != null ? (m5.live * 100).toFixed(2) + "¢" : "—"}</td><td className="py-2 pl-6 text-[10px] text-slate-600">live 5m Up (CLOB mid)</td></tr>
          </tbody>
        </table>
      </div>

      {/* debug slugs */}
      {data && (
        <p className="text-[10px] text-slate-600 font-mono">
          slugs · 1h: {m1h?.slug || "—"} · 15m: {m15?.slug || "—"} · 5m: {m5?.slug || "—"} · server t={data.t?.toFixed(1)}m
        </p>
      )}
    </div>
  );
}
