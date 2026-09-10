"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bitcoin, RefreshCw, Clock, Activity, Zap, ChevronRight } from "lucide-react";

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

function Collapsible({ id, openState, toggle, color, title, subtitle, badge, children }: {
  id: string; openState: boolean; toggle: () => void; color: string; title: string; subtitle?: string;
  badge?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-2xl shadow-sm overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-white/[0.08] transition-colors">
        <span className="flex items-center gap-2 min-w-0">
          <ChevronRight className={`w-4 h-4 text-[#5d628f] transition-transform shrink-0 ${openState ? "rotate-90" : ""}`} />
          <span className="text-base font-medium flex items-center gap-2 truncate" style={{ color: openState ? "#fff" : color }}>
            {title} {subtitle && <span className="text-xs text-[#5d628f] font-normal">{subtitle}</span>}
          </span>
        </span>
        <span className="shrink-0 ml-3">{badge}</span>
      </button>
      {openState && <div className="px-6 pb-6">{children}</div>}
    </div>
  );
}

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
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    console.log('[CLOCK EFFECT RUNNING]');
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // data polling — merged into a guaranteed-run effect
  useEffect(() => {
    console.log('[POLL EFFECT RUNNING]');
    let cancelled = false;
    const tick = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/updown?coin=${coin}&sigma=${sigma}`, { cache: "no-store" });
        if (!res.ok) throw new Error("API " + res.status);
        const d = await res.json();
        if (!cancelled) { setData(d); setErr(null); }
      } catch (e: any) { if (!cancelled) setErr(e.message); }
      finally { if (!cancelled) setLoading(false); }
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [coin, sigma]);
  const [open15, setOpen15] = useState(false);
  const [open5, setOpen5] = useState(false);
  const [openA, setOpenA] = useState(false);
  const [openC, setOpenC] = useState(false);
  const [openSnap, setOpenSnap] = useState(false);
  const [openAudit, setOpenAudit] = useState(false);
  const [copiedAudit, setCopiedAudit] = useState(false);
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

const m = data?.model;
  const m5model = data?.model5;
  const modelA = data?.modelA;
  const modelC = data?.modelC;
  const m1h: MarketRow | null = data?.m1h;
  const m15: MarketRow | null = data?.m15;
  const m5: MarketRow | null = data?.m5;
  const m5m: MarketRow | null = data?.m5;
  const n15 = data?.n15, n5 = data?.n5;
  const market1h = m1h?.live ?? m1h?.up ?? null;
  const fair = m?.fairUp ?? null;
  const edge = m?.edge ?? null;

  const badge15 = fair != null && (
    <span className={`text-sm font-bold tabular-nums ${edge != null && Math.abs(edge) > 0.03 ? (edge > 0 ? "text-[#2ce5a7]" : "text-[#ff6b9d]") : "text-[#8b91c5]"}`}>
      {(fair * 100).toFixed(1)}¢{edge != null && (edge > 0 ? " ↑" : " ↓")}
    </span>
  );
  const badge5 = m5model?.fairUp != null && (
    <span className="text-sm font-bold tabular-nums text-[#ffc94d]">{(m5model.fairUp * 100).toFixed(1)}¢</span>
  );
  const badgeA = modelA?.fairUp != null && (
    <span className="text-sm font-bold tabular-nums text-[#A78BFA]">{(modelA.fairUp * 100).toFixed(1)}¢</span>
  );
  const badgeC = modelC?.valid && modelC?.fairUp != null && (
    <span className="text-sm font-bold tabular-nums text-[#F472B6]">{(modelC.fairUp * 100).toFixed(1)}¢</span>
  );

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

  const fmtRemain = (tick: number, periodSec: number) => {
    const remain = periodSec - (Math.floor(tick / 1000) % periodSec);
    const m = Math.floor(remain / 60), s = remain % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const auditText = [
    "۱. ورودی‌های فرمول پایه‌ی ۱ ساعته (مدل الف):",
    `• S₀ = ${fmt(m?.s0)} | Sₜ = ${fmt(m?.st)} | xₜ = ln(Sₜ/S₀) = ${m?.xt != null ? m.xt.toFixed(6) : "—"}`,
    `• τ (hours) = ${modelA ? modelA.tauHours.toFixed(4) : "—"}`,
    `• σ₁ₕ = ${sigma}`,
    "",
    "۲. ورودی‌های حل دستگاه (مدل ب — ۵ و ۱۵ دقیقه‌ای):",
    `• τ₅ = ${m5model ? m5model.tau5.toFixed(2) : "—"} دقیقه | τ₁₅ = ${m ? m.tau15.toFixed(2) : "—"} دقیقه`,
    `• Sₐ₅ = ${fmt(m5model?.sa5)} | y₅ = ln(Sₜ/Sₐ₅) = ${m5model ? m5model.y5.toFixed(6) : "—"}`,
    `• Sₐ₁₅ = ${fmt(m?.sa)} | y₁₅ = ln(Sₜ/Sₐ₁₅) = ${m ? m.y.toFixed(6) : "—"}`,
    `• p₅ = ${m5m?.live != null ? (m5m.live * 100).toFixed(2) + "¢" : "—"} | p₁₅ = ${m?.p15 != null ? (m.p15 * 100).toFixed(2) + "¢" : "—"}`,
    "",
    "۳. ورودی‌های ارزش منصفانه‌ی نهایی (با رانش):",
    `• xₜ = ${m?.xt != null ? m.xt.toFixed(6) : "—"}`,
    `• τ₆₀ = ${m ? m.tau60.toFixed(2) : "—"} دقیقه`,
    `• σₘ (حل‌شده) = ${modelC ? modelC.sigmaM.toFixed(6) : "—"} | μ (حل‌شده) = ${modelC ? modelC.mu.toFixed(6) : "—"}`,
  ].join("\n");

  const copyAudit = async () => {
    try {
      await navigator.clipboard.writeText(auditText);
      setCopiedAudit(true);
      setTimeout(() => setCopiedAudit(false), 1500);
    } catch {}
  };

  const Row = ({ title, row, next }: { title: string; row: MarketRow | null; next?: MarketRow | null }) => (
    <div className="bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-wider text-[#8b91c5] font-medium">{title}</p>
        {row?.accepting ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-[#2ce5a7]"><span className="w-1.5 h-1.5 rounded-full bg-[#2ce5a7] animate-pulse" /> OPEN</span>
        ) : (
          <span className="text-[10px] text-[#5d628f]">CLOSED</span>
        )}
      </div>
      {row ? (
        <>
          <p className="text-sm text-[#eef0ff] font-medium mb-3 truncate" title={row.title}>{row.title}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-xl p-3 border ${ (row.live ?? row.up) >= 0.5 ? "bg-[#2ce5a7]/10 border-[#2ce5a7]/35" : "bg-white/[0.08] border-[rgba(140,130,255,0.13)]"}`}>
              <p className="text-[10px] uppercase text-[#8b91c5] mb-1">Up</p>
              <p className={`text-2xl font-bold tabular-nums ${(row.live ?? row.up) >= 0.5 ? "text-[#2ce5a7]" : "text-[#c3c8ee]"}`}>{pct(row.live ?? row.up)}</p>
            </div>
            <div className={`rounded-xl p-3 border ${ (row.liveDown ?? 1 - (row.live ?? row.up)) > 0.5 ? "bg-[#ff6b9d]/10 border-[#ff6b9d]/35" : "bg-white/[0.08] border-[rgba(140,130,255,0.13)]"}`}>
              <p className="text-[10px] uppercase text-[#8b91c5] mb-1">Down</p>
              <p className={`text-2xl font-bold tabular-nums ${(row.liveDown ?? 1 - (row.live ?? row.up)) > 0.5 ? "text-[#ff6b9d]" : "text-[#c3c8ee]"}`}>{pct(row.liveDown ?? 1 - (row.live ?? row.up))}</p>
            </div>
          </div>
        </>
      ) : next ? (
        <p className="text-xs text-[#5d628f]">
          no active market — next opens: <span className="text-[#c3c8ee]">{next.title?.replace(/^.*? - /, "")}</span>
        </p>
      ) : (
        <p className="text-xs text-[#5d628f]">market not found</p>
      )}
    </div>
  );

  return (
    <div className="space-y-6 rise-in">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1 tracking-tight flex items-center gap-2">
            <Zap className="w-6 h-6 text-[#ffc94d] drop-shadow-[0_0_8px_rgba(255,201,77,0.6)]" />
            <span className="text-aurora">Up/Down Markets</span>
            <span className="text-[#eef0ff]">— Live Fair Value</span>
            <span className="ml-1 inline-flex items-center gap-1.5 text-[11px] text-[#2ce5a7]"><span className="pulse-dot" /> LIVE</span>
          </h1>
          <p className="text-sm text-[#8b91c5]">Polymarket hourly &amp; sub-hourly crypto markets, synced live · drift-extraction fair value for the 1H</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-9 flex justify-center">{loading && <RefreshCw className="w-4 h-4 animate-spin text-[#5d628f]" />}</span>
          <span className="text-xs text-[#5d628f] tabular-nums w-24">{auto ? `next refresh ${countdown}s` : ""}</span>
          <button onClick={() => setAuto(a => !a)}
            className={`text-xs font-medium rounded-lg px-3 py-1.5 border ${auto ? "bg-[#2ce5a7]/10 text-[#2ce5a7] border-[#2ce5a7]/35" : "text-[#8b91c5] border-[rgba(140,130,255,0.15)]"}`}>
            {auto ? "Auto 5s ON" : "Auto OFF"}
          </button>
          <button onClick={load} className="text-xs font-medium rounded-lg px-3 py-1.5 border border-[rgba(140,130,255,0.15)] text-[#c3c8ee] hover:border-[rgba(140,130,255,0.28)]">
            Refresh
          </button>
        </div>
      </div>

      {/* live clock + candle countdowns — sticky, never moves */}
      <div className="sticky top-14 z-40 -mx-1 px-1 py-1.5 rounded-xl bg-[#0d0f22]/85 backdrop-blur-md border border-[rgba(140,130,255,0.14)] flex items-center justify-center gap-5 text-xs tabular-nums shadow-sm">
        <span className="flex items-center gap-1.5 text-[#eef0ff] font-medium">
          <Clock className="w-3.5 h-3.5 text-[#8b91c5]" />
          {new Date(nowTick).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          <span className="text-[#5d628f]">ET</span>
        </span>
        <span className="w-px h-4 bg-[rgba(140,130,255,0.2)]" />
        <span className="text-[#ffc94d]">5m close <b className="font-semibold">{fmtRemain(nowTick, 300)}</b></span>
        <span className="text-[#38bdf8]">15m close <b className="font-semibold">{fmtRemain(nowTick, 900)}</b></span>
        <span className="text-[#ff6b9d]">1h close <b className="font-semibold">{fmtRemain(nowTick, 3600)}</b></span>
      </div>

      {/* coin selector */}
      <div className="flex flex-wrap gap-2">
        {COINS.map(c => (
          <button key={c.key} onClick={() => setCoin(c.key)}
            className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-full px-4 py-1.5 border transition-colors ${coin === c.key ? "text-[#0B1120] border-transparent" : "text-[#8b91c5] border-[rgba(140,130,255,0.15)] hover:border-[rgba(140,130,255,0.28)]"}`}
            style={coin === c.key ? { background: c.color } : {}}>
            <span>{c.sym}</span> {c.label}
          </button>
        ))}
      </div>

      {err && <div className="bg-[#ff6b9d]/10 border border-[#ff6b9d]/35 text-[#ff6b9d] rounded-xl px-4 py-3 text-sm">{err}</div>}

      {/* three market cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <Row title="1 Hour market" row={m1h} />
        <Row title="15 minute market" row={m15} next={n15} />
        <Row title="5 minute market" row={m5} next={n5} />
      </div>

      {/* Fair Value — 1H Up (μ from 15m) — collapsible */}
      <Collapsible id="open15" openState={open15} toggle={() => setOpen15(!open15)}
        color="#38BDF8" title="Fair Value — 1H Up (μ from 15m)" subtitle="مدل ۱۵ دقیقه‌ای" badge={badge15}>
        <div className="flex items-center justify-end mb-4">
          <label className="flex items-center gap-2 text-xs text-[#8b91c5]">
            σ₁ₕ (hourly vol):
            <input type="number" step="0.005" min="0.005" max="0.2" value={sigma}
              onChange={e => setSigma(parseFloat(e.target.value) || 0.02)}
              className="w-20 bg-white/[0.08] border border-[rgba(140,130,255,0.15)] rounded-lg px-2 py-1 text-white tabular-nums focus:outline-none focus:border-[#a99cff]" />
          </label>
        </div>

        {m ? (
          <div className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-[#0d0f22]/80 rounded-xl p-4 border border-[rgba(140,130,255,0.13)]">
                <p className="text-[10px] uppercase text-[#5d628f] mb-1">Model fair value (Up)</p>
                <p className="text-3xl font-bold text-[#a99cff] tabular-nums">{(fair * 100).toFixed(1)}¢</p>
              </div>
              <div className="bg-[#0d0f22]/80 rounded-xl p-4 border border-[rgba(140,130,255,0.13)]">
                <p className="text-[10px] uppercase text-[#5d628f] mb-1">Market price (Up)</p>
                <p className="text-3xl font-bold text-white tabular-nums">{market1h != null ? (market1h * 100).toFixed(1) + "¢" : "—"}</p>
              </div>
              <div className={`bg-[#0d0f22]/80 rounded-xl p-4 border ${edge != null && Math.abs(edge) > 0.03 ? (edge > 0 ? "border-[#2ce5a7]/40" : "border-[#ff6b9d]/40") : "border-[rgba(140,130,255,0.13)]"}`}>
                <p className="text-[10px] uppercase text-[#5d628f] mb-1">Edge (fair − market)</p>
                <p className={`text-3xl font-bold tabular-nums ${edge == null ? "text-[#5d628f]" : edge > 0.03 ? "text-[#2ce5a7]" : edge < -0.03 ? "text-[#ff6b9d]" : "text-[#c3c8ee]"}`}>
                  {edge == null ? "—" : (edge > 0 ? "+" : "") + (edge * 100).toFixed(1) + "¢"}
                </p>
                <p className="text-[10px] text-[#5d628f] mt-1">{edge != null && Math.abs(edge) > 0.03 ? (edge > 0 ? "Up looks underpriced" : "Down looks underpriced") : "within noise band ±3¢"}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="text-[#5d628f] uppercase tracking-wider border-b border-[rgba(140,130,255,0.15)]">
                  <tr><th className="py-2 pr-4">input</th><th className="py-2 pr-4">value</th><th className="py-2 pr-4">input</th><th className="py-2">value</th></tr>
                </thead>
                <tbody className="divide-y divide-[rgba(140,130,255,0.10)] text-[#c3c8ee] tabular-nums">
                  <tr><td className="py-1.5 pr-4">t (min into hour)</td><td className="py-1.5 pr-4">{m.t.toFixed(2)}</td><td className="py-1.5 pr-4">S₀ (hour open)</td><td className="py-1.5">${m.s0?.toLocaleString()}</td></tr>
                  <tr><td className="py-1.5 pr-4">a (15m block start)</td><td className="py-1.5 pr-4">:{String(Math.floor(m.a)).padStart(2, "0")}</td><td className="py-1.5 pr-4">Sₐ (block open)</td><td className="py-1.5">${m.sa?.toLocaleString()}</td></tr>
                  <tr><td className="py-1.5 pr-4">q (into block)</td><td className="py-1.5 pr-4">{m.q.toFixed(2)}</td><td className="py-1.5 pr-4">Sₜ (now)</td><td className="py-1.5">${m.st?.toLocaleString()}</td></tr>
                  <tr><td className="py-1.5 pr-4">τ₁₅ remaining</td><td className="py-1.5 pr-4">{m.tau15.toFixed(2)} min</td><td className="py-1.5 pr-4">xₜ = ln(Sₜ/S₀)</td><td>{m.xt.toFixed(5)}</td></tr>
                  <tr><td className="py-1.5 pr-4">τ₆₀ remaining</td><td className="py-1.5 pr-4">{m.tau60.toFixed(2)} min</td><td className="py-1.5 pr-4">y = ln(Sₜ/Sₐ)</td><td>{m.y.toFixed(5)}</td></tr>
                  <tr><td className="py-1.5 pr-4">σ₁ₕ / σₘ</td><td className="py-1.5 pr-4">{m.sigma1h} / {m.sigmaM.toFixed(5)}</td><td className="py-1.5 pr-4">p₁₅ (live 15m Up)</td><td>{(m.p15 * 100).toFixed(1)}¢</td></tr>
                  <tr><td className="py-1.5 pr-4">z₁₅ = Φ⁻¹(p₁₅)</td><td className="py-1.5 pr-4">{m.z15.toFixed(4)}</td><td className="py-1.5 pr-4">μ (implied drift)</td><td className={m.mu >= 0 ? "text-[#2ce5a7]" : "text-[#ff6b9d]"}>{m.mu.toFixed(6)}/min</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[#5d628f]">
              μ extracted from the live 15¢ market: μ = (z₁₅·σₘ·√τ₁₅ − y) / τ₁₅ · fair = Φ((xₜ + μ·τ₆₀)/(σₘ·√τ₆₀)) · spot: Binance 1m klines (S₀ = hour open, Sₐ = active 15m block open) · market: CLOB midpoints
            </p>
          </div>
        ) : (
          <p className="text-sm text-[#5d628f]">
            {m1h?.closed
              ? "1H market already settled — model needs an active hour market."
              : "Waiting for spot + market data (need S₀, Sₜ and a live 15m price in (0,1))."}
          </p>
        )}
      </Collapsible>

      {/* Fair Value — 1H Up (μ from 5m) — collapsible */}
      <Collapsible id="open5" openState={open5} toggle={() => setOpen5(!open5)}
        color="#FBBF24" title="Fair Value — 1H Up (μ from 5m)" subtitle="مدل ۵ دقیقه‌ای" badge={badge5}>
        {m5model ? (
        <>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-[#0d0f22]/80 rounded-xl p-4 border border-[rgba(140,130,255,0.13)]">
              <p className="text-[10px] uppercase text-[#5d628f] mb-1">Model fair value (Up) — 5m calib</p>
              <p className="text-3xl font-bold text-[#ffc94d] tabular-nums">{(m5model.fairUp * 100).toFixed(1)}¢</p>
            </div>
            <div className="bg-[#0d0f22]/80 rounded-xl p-4 border border-[rgba(140,130,255,0.13)]">
              <p className="text-[10px] uppercase text-[#5d628f] mb-1">Market price (Up)</p>
              <p className="text-3xl font-bold text-white tabular-nums">{market1h != null ? (market1h * 100).toFixed(1) + "¢" : "—"}</p>
            </div>
            <div className={`bg-[#0d0f22]/80 rounded-xl p-4 border ${m5model.edge != null && Math.abs(m5model.edge) > 0.03 ? (m5model.edge > 0 ? "border-[#2ce5a7]/40" : "border-[#ff6b9d]/40") : "border-[rgba(140,130,255,0.13)]"}`}>
              <p className="text-[10px] uppercase text-[#5d628f] mb-1">Edge (fair − market)</p>
              <p className={`text-3xl font-bold tabular-nums ${m5model.edge == null ? "text-[#5d628f]" : m5model.edge > 0.03 ? "text-[#2ce5a7]" : m5model.edge < -0.03 ? "text-[#ff6b9d]" : "text-[#c3c8ee]"}`}>
                {m5model.edge == null ? "—" : (m5model.edge > 0 ? "+" : "") + (m5model.edge * 100).toFixed(1) + "¢"}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <tbody className="divide-y divide-[rgba(140,130,255,0.10)] text-[#c3c8ee] tabular-nums">
                <tr><td className="py-1.5 pr-4">a₅ (5m block start)</td><td className="py-1.5 pr-4">:{String(Math.floor(m5model.a5)).padStart(2, "0")}</td><td className="py-1.5 pr-4">Sₐ₅ (block open)</td><td className="py-1.5">${m5model.sa5?.toLocaleString()}</td></tr>
                <tr><td className="py-1.5 pr-4">q₅ (into block)</td><td className="py-1.5 pr-4">{m5model.q5.toFixed(2)}</td><td className="py-1.5 pr-4">y₅ = ln(Sₜ/Sₐ₅)</td><td>{m5model.y5.toFixed(5)}</td></tr>
                <tr><td className="py-1.5 pr-4">τ₅ remaining</td><td className="py-1.5 pr-4">{m5model.tau5.toFixed(2)} min</td><td className="py-1.5 pr-4">p₅ (live 5m Up)</td><td>{(m5model.p5 * 100).toFixed(1)}¢</td></tr>
                <tr><td className="py-1.5 pr-4">z₅ = Φ⁻¹(p₅)</td><td className="py-1.5 pr-4">{m5model.z5.toFixed(4)}</td><td className="py-1.5 pr-4">μ₅ (implied drift)</td><td className={m5model.mu5 >= 0 ? "text-[#2ce5a7]" : "text-[#ff6b9d]"}>{m5model.mu5.toFixed(6)}/min</td></tr>
                <tr><td className="py-1.5 pr-4">τ₆₀ remaining</td><td className="py-1.5 pr-4">{m?.tau60?.toFixed(2) ?? "—"} min</td><td className="py-1.5 pr-4">xₜ = ln(Sₜ/S₀)</td><td>{m?.xt?.toFixed(5) ?? "—"}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[#5d628f] mt-3">
            Same formula as the 15m panel, but μ extracted from the live 5¢ market: μ₅ = (z₅·σₘ·√τ₅ − y₅) / τ₅ · fair = Φ((xₜ + μ₅·τ₆₀)/(σₘ·√τ₆₀))
          </p>
        </>
        ) : <p className="text-xs text-[#5d628f]">5m model inactive (market near resolution or missing data).</p>}
      </Collapsible>

      {/* الف — Base (no drift) — collapsible */}
      <Collapsible id="openA" openState={openA} toggle={() => setOpenA(!openA)}
        color="#A78BFA" title="الف — Base (no drift)" subtitle="فرمول پایه" badge={badgeA}>
        {modelA ? (
        <>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-[#0d0f22]/80 rounded-xl p-4 border border-[rgba(140,130,255,0.13)]">
              <p className="text-[10px] uppercase text-[#5d628f] mb-1">Fair value (Up)</p>
              <p className="text-3xl font-bold text-[#A78BFA] tabular-nums">{(modelA.fairUp * 100).toFixed(1)}¢</p>
            </div>
            <div className="bg-[#0d0f22]/80 rounded-xl p-4 border border-[rgba(140,130,255,0.13)]">
              <p className="text-[10px] uppercase text-[#5d628f] mb-1">Market price (Up)</p>
              <p className="text-3xl font-bold text-white tabular-nums">{market1h != null ? (market1h * 100).toFixed(1) + "¢" : "—"}</p>
            </div>
            <div className={`bg-[#0d0f22]/80 rounded-xl p-4 border ${modelA.edge != null && Math.abs(modelA.edge) > 0.03 ? (modelA.edge > 0 ? "border-[#2ce5a7]/40" : "border-[#ff6b9d]/40") : "border-[rgba(140,130,255,0.13)]"}`}>
              <p className="text-[10px] uppercase text-[#5d628f] mb-1">Edge (fair − market)</p>
              <p className={`text-3xl font-bold tabular-nums ${modelA.edge == null ? "text-[#5d628f]" : modelA.edge > 0.03 ? "text-[#2ce5a7]" : modelA.edge < -0.03 ? "text-[#ff6b9d]" : "text-[#c3c8ee]"}`}>
                {modelA.edge == null ? "—" : (modelA.edge > 0 ? "+" : "") + (modelA.edge * 100).toFixed(1) + "¢"}
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <tbody className="divide-y divide-[rgba(140,130,255,0.10)] text-[#c3c8ee] tabular-nums">
                <tr><td className="py-1.5 pr-4">xₜ = ln(Sₜ/S₀)</td><td className="py-1.5 pr-4">{modelA.x_t.toFixed(5)}</td><td className="py-1.5 pr-4">τ (hours)</td><td className="py-1.5 pr-4">{modelA.tauHours.toFixed(4)} h</td><td className="py-1.5 pr-4">σ₁ₕ</td><td className="py-1.5">{modelA.sigma1h}</td></tr>
              </tbody>
            </table>
          </div>
        </>
        ) : <p className="text-xs text-[#5d628f]">مدل الف نیاز به S₀ و Sₜ زنده دارد.</p>}
      </Collapsible>

      {/* Joint Solve — σ & μ — collapsible */}
      <Collapsible id="openC" openState={openC} toggle={() => setOpenC(!openC)}
        color="#F472B6" title="Joint Solve — σ & μ" subtitle="حل دستگاه" badge={badgeC}>
        {modelC && modelC.valid ? (
        <>
          <p className="text-[11px] text-[#5d628f] mb-4">
            Φ⁻¹(p₅) = (y₅ + μ·τ₅)/(σₘ·√τ₅) · Φ⁻¹(p₁₅) = (y₁₅ + μ·τ₁₅)/(σₘ·√τ₁₅) → solves σₘ and μ simultaneously, then fair = Φ((xₜ + μ·τ₆₀)/(σₘ·√τ₆₀))
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-[#0d0f22]/80 rounded-xl p-4 border border-[rgba(140,130,255,0.13)]">
              <p className="text-[10px] uppercase text-[#5d628f] mb-1">Fair value (Up)</p>
              <p className="text-3xl font-bold text-[#F472B6] tabular-nums">{(modelC.fairUp * 100).toFixed(1)}¢</p>
            </div>
            <div className="bg-[#0d0f22]/80 rounded-xl p-4 border border-[rgba(140,130,255,0.13)]">
              <p className="text-[10px] uppercase text-[#5d628f] mb-1">Implied σ₁ₕ (joint)</p>
              <p className="text-3xl font-bold text-white tabular-nums">{modelC.sigma1h.toFixed(4)}</p>
            </div>
            <div className={`bg-[#0d0f22]/80 rounded-xl p-4 border ${modelC.edge != null && Math.abs(modelC.edge) > 0.03 ? (modelC.edge > 0 ? "border-[#2ce5a7]/40" : "border-[#ff6b9d]/40") : "border-[rgba(140,130,255,0.13)]"}`}>
              <p className="text-[10px] uppercase text-[#5d628f] mb-1">Edge (fair − market)</p>
              <p className={`text-3xl font-bold tabular-nums ${modelC.edge == null ? "text-[#5d628f]" : modelC.edge > 0.03 ? "text-[#2ce5a7]" : modelC.edge < -0.03 ? "text-[#ff6b9d]" : "text-[#c3c8ee]"}`}>
                {modelC.edge == null ? "—" : (modelC.edge > 0 ? "+" : "") + (modelC.edge * 100).toFixed(1) + "¢"}
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <tbody className="divide-y divide-[rgba(140,130,255,0.10)] text-[#c3c8ee] tabular-nums">
                <tr><td className="py-1.5 pr-4">τ₅ / τ₁₅</td><td className="py-1.5 pr-4">{modelC.tau5.toFixed(2)} / {modelC.tau15.toFixed(2)} min</td><td className="py-1.5 pr-4">y₅ / y₁₅</td><td className="py-1.5 pr-4">{modelC.y5.toFixed(5)} / {modelC.y15.toFixed(5)}</td></tr>
                <tr><td className="py-1.5 pr-4">p₅ / p₁₅</td><td className="py-1.5 pr-4">{(modelC.p5 * 100).toFixed(1)}¢ / {(modelC.p15 * 100).toFixed(1)}¢</td><td className="py-1.5 pr-4">z₅ / z₁₅</td><td className="py-1.5 pr-4">{modelC.z5.toFixed(4)} / {modelC.z15.toFixed(4)}</td></tr>
                <tr><td className="py-1.5 pr-4">σₘ (solved)</td><td className="py-1.5 pr-4">{modelC.sigmaM.toFixed(6)}</td><td className="py-1.5 pr-4">μ (solved)</td><td className={modelC.mu >= 0 ? "text-[#2ce5a7]" : "text-[#ff6b9d]"}>{modelC.mu.toFixed(6)}/min</td></tr>
              </tbody>
            </table>
          </div>
        </>
        ) : (
        <p className="text-xs text-[#8b91c5]">
          Joint solve needs both 5m &amp; 15m markets live (or they disagree → σ ≤ 0). System inputs this minute: τ₅={modelC?.tau5?.toFixed(1) ?? "—"}m τ₁₅={modelC?.tau15?.toFixed(1) ?? "—"}m y₅={modelC?.y5?.toFixed(5) ?? "—"} y₁₅={modelC?.y15?.toFixed(5) ?? "—"} z₅={modelC?.z5?.toFixed(3) ?? "—"} z₁₅={modelC?.z15?.toFixed(3) ?? "—"}
        </p>
        )}
      </Collapsible>

      {/* Snapshot (S₀/SA/ST/P15/P5) — collapsible */}
      <Collapsible id="openSnap" openState={openSnap} toggle={() => setOpenSnap(!openSnap)}
        color="#94a3b8" title="Snapshot (S₀/SA/ST/P15/P5)" subtitle="کپی سریع" badge={null}>
        <div className="flex items-center justify-end mb-3">
          <button onClick={copySnapshot}
            className={`text-xs font-medium rounded-lg px-3 py-1.5 border transition-colors ${copied ? "bg-[#2ce5a7]/10 text-[#2ce5a7] border-[#2ce5a7]/35" : "text-[#c3c8ee] border-[rgba(140,130,255,0.15)] hover:border-[rgba(140,130,255,0.28)]"}`}>
            {copied ? "✓ Copied" : "Copy all"}
          </button>
        </div>
        <table className="w-full text-left text-sm whitespace-nowrap">
          <tbody className="divide-y divide-[rgba(140,130,255,0.10)] text-[#c3c8ee] tabular-nums">
            <tr><td className="py-2 pr-6 text-[#5d628f]">1- Current time</td><td className="py-2">{nowClk}</td></tr>
            <tr><td className="py-2 pr-6 text-[#5d628f]">2- S0</td><td className="py-2">${fmt(m?.s0)}</td><td className="py-2 pl-6 text-[10px] text-[#5d628f]">hour open ({data?.openSources?.s0 === "polymarket-chainlink" ? "Chainlink" : "Binance"})</td></tr>
            <tr><td className="py-2 pr-6 text-[#5d628f]">3- SA</td><td className="py-2">${fmt(m?.sa)}</td><td className="py-2 pl-6 text-[10px] text-[#5d628f]">15m block open ({data?.openSources?.sa === "polymarket-chainlink" ? "Chainlink" : "Binance"})</td></tr>
            <tr><td className="py-2 pr-6 text-[#5d628f]">4- ST</td><td className="py-2">${fmt(m?.st)}</td><td className="py-2 pl-6 text-[10px] text-[#5d628f]">live spot (Binance)</td></tr>
            <tr><td className="py-2 pr-6 text-[#5d628f]">5- P15</td><td className="py-2">{m?.p15 != null ? (m.p15 * 100).toFixed(2) + "¢" : "—"}</td><td className="py-2 pl-6 text-[10px] text-[#5d628f]">live 15m Up (CLOB mid)</td></tr>
            <tr><td className="py-2 pr-6 text-[#5d628f]">6- P5</td><td className="py-2">{m5?.live != null ? (m5.live * 100).toFixed(2) + "¢" : "—"}</td><td className="py-2 pl-6 text-[10px] text-[#5d628f]">live 5m Up (CLOB mid)</td></tr>
          </tbody>
        </table>
      </Collapsible>

      {/* Formula Audit — ورودی‌های سه مدل — collapsible */}
      <Collapsible id="openAudit" openState={openAudit} toggle={() => setOpenAudit(!openAudit)}
        color="#94a3b8" title="Formula Audit — ورودی‌های سه مدل" subtitle="کپی کامل" badge={null}>
        <div className="flex items-center justify-end mb-3">
          <button onClick={copyAudit}
            className={`text-xs font-medium rounded-lg px-3 py-1.5 border transition-colors ${copiedAudit ? "bg-[#2ce5a7]/10 text-[#2ce5a7] border-[#2ce5a7]/35" : "text-[#c3c8ee] border-[rgba(140,130,255,0.15)] hover:border-[rgba(140,130,255,0.28)]"}`}>
            {copiedAudit ? "✓ Copied" : "Copy all"}
          </button>
        </div>
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-[#A78BFA] uppercase tracking-wide mb-1.5">۱. ورودی‌های فرمول پایه‌ی ۱ ساعته (مدل الف)</p>
            <ul className="text-[#c3c8ee] space-y-1 text-[13px] tabular-nums">
              <li>• S₀ (قیمت شروع ساعت) = <b className="text-white">{fmt(m?.s0)}</b> · Sₜ (قیمت لحظه‌ای) = <b className="text-white">{fmt(m?.st)}</b> → xₜ = ln(Sₜ/S₀) = <b className="text-white">{m?.xt != null ? m.xt.toFixed(6) : "—"}</b></li>
              <li>• τ (hours) = <b className="text-white">{modelA ? modelA.tauHours.toFixed(4) : "—"}</b></li>
              <li>• σ₁ₕ = <b className="text-white">{sigma}</b></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#ffc94d] uppercase tracking-wide mb-1.5">۲. ورودی‌های حل دستگاه (مدل ب — ۵ و ۱۵ دقیقه‌ای)</p>
            <ul className="text-[#c3c8ee] space-y-1 text-[13px] tabular-nums">
              <li>• τ₅ = <b className="text-white">{m5model ? m5model.tau5.toFixed(2) : "—"}</b> دقیقه · τ₁₅ = <b className="text-white">{m ? m.tau15.toFixed(2) : "—"}</b> دقیقه</li>
              <li>• Sₐ₅ (شروع بلاک ۵m) = <b className="text-white">{fmt(m5model?.sa5 ?? m5model?.sa5)}</b> → y₅ = ln(Sₜ/Sₐ₅) = <b className="text-white">{m5model ? m5model.y5.toFixed(6) : "—"}</b></li>
              <li>• Sₐ₁₅ (شروع بلاک ۱۵m) = <b className="text-white">{fmt(m?.sa)}</b> → y₁₅ = ln(Sₜ/Sₐ₁₅) = <b className="text-white">{m ? m.y.toFixed(6) : "—"}</b></li>
              <li>• p₅ = <b className="text-white">{m5m?.live != null ? (m5m.live * 100).toFixed(2) + "¢" : "—"}</b> · p₁₅ = <b className="text-white">{m?.p15 != null ? (m.p15 * 100).toFixed(2) + "¢" : "—"}</b></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#F472B6] uppercase tracking-wide mb-1.5">۳. ورودی‌های ارزش منصفانه‌ی نهایی (با رانش)</p>
            <ul className="text-[#c3c8ee] space-y-1 text-[13px] tabular-nums">
              <li>• xₜ = <b className="text-white">{m?.xt != null ? m.xt.toFixed(6) : "—"}</b></li>
              <li>• τ₆₀ = <b className="text-white">{m ? m.tau60.toFixed(2) + " دقیقه" : "—"}</b></li>
              <li>• σₘ (حل‌شده از دستگاه) = <b className="text-white">{modelC ? modelC.sigmaM.toFixed(6) : "—"}</b> · μ = <b className="text-white">{modelC ? modelC.mu.toFixed(6) : "—"}</b></li>
              <li className="text-[#5d628f] text-xs">(اگر مستقیماً همین خروجی را بفرستی، نیازی به محاسبه‌ی مجدد مرحله‌ی ۲ نیست)</li>
            </ul>
          </div>
        </div>
      </Collapsible>

{/* debug slugs */}
      {data && (
        <p className="text-[10px] text-[#5d628f] font-mono">
          slugs · 1h: {m1h?.slug || "—"} · 15m: {m15?.slug || "—"} · 5m: {m5?.slug || "—"} · server t={data.t?.toFixed(1)}m
        </p>
      )}
    </div>
  );
}
