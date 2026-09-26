"use client";
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Bell, Plus, Trash2, Play, Send, Power, CheckCircle2, XCircle } from "lucide-react";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>("");
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // form state
  const [name, setName] = useState("");
  const [hours, setHours] = useState("24");
  const [minBet, setMinBet] = useState("1000");
  const [token, setToken] = useState("");
  const [chat, setChat] = useState("");
  const [formError, setFormError] = useState("");
  const [alertType, setAlertType] = useState("new_whale");
  const [walletsText, setWalletsText] = useState("");
  const [watchStarred, setWatchStarred] = useState(true);

  const fetchAlerts = useCallback(async () => {
    const res = await fetch("/api/alerts");
    const data = await res.json();
    setAlerts(data.alerts || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAlerts();
    const t = setInterval(fetchAlerts, 30000);
    return () => clearInterval(t);
  }, [fetchAlerts]);

  const notify = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 5000);
  };

  const createAlert = async () => {
    setFormError("");
    const res = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, hours, minBet, telegramToken: token, telegramChat: chat,
        alertType,
        wallets: walletsText.split(/[\s,;]+/).map(w => w.trim()).filter(Boolean),
        watchStarred,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFormError(data.error || "failed to create");
      return;
    }
    setName(""); setToken(""); setChat(""); setWalletsText("");
    notify(true, "Alert created — the worker picks it up within 60s.");
    fetchAlerts();
  };

  const act = async (id: number, action: string) => {
    setBusy(`${id}:${action}`);
    try {
      const res = await fetch(`/api/alerts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (action === "test") {
        notify(!!data.ok, data.ok ? "Test message sent to Telegram ✅" : "Telegram send FAILED — check token/chat ❌");
      } else if (action === "run") {
        notify(true, data.matched > 0 ? (data.sent ? `Fired: ${data.matched} whale(s) sent` : "Matched but Telegram send failed") : "No NEW whales match right now");
      }
      fetchAlerts();
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1 tracking-tight text-white flex items-center gap-2"><Bell className="w-6 h-6 text-[#9fb4ee]" /> Alerts</h1>
        <p className="text-sm text-[#9a9ca3] tracking-wide">Get a Telegram ping when a TRUE new whale appears — evaluated every 60s, each whale notifies once per rule</p>
      </div>

      {toast && (
        <div className={`p-4 rounded-2xl border text-sm font-medium ${toast.ok ? "bg-[#5fbf9a]/10 border-[#5fbf9a]/35 text-[#5fbf9a]" : "bg-[#e5787f]/10 border-[#e5787f]/35 text-[#e5787f]"}`}>
          {toast.msg}
        </div>
      )}

      {/* Create form */}
      <div className="bg-white/[0.08] border border-[rgba(190,190,200,0.15)] p-5 rounded-2xl shadow-sm relative overflow-hidden">
        <h2 className="text-sm font-semibold text-[#e8e8e4] mb-4 flex items-center gap-2"><Plus className="w-4 h-4 text-[#9fb4ee]" /> New alert rule</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-medium text-[#9a9ca3] mb-1.5">Rule name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="New whale > $1k in 24h" className="w-full bg-white/[0.08] text-white border border-[rgba(190,190,200,0.15)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#9fb4ee] focus:ring-1 focus:ring-[#6aa9d8] transition-shadow placeholder:text-[#73757c]" />
          </div>
          {alertType === "new_whale" && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-medium text-[#9a9ca3] mb-1.5">First trade within (hours)</label>
              <input type="number" value={hours} onChange={e => setHours(e.target.value)} className="w-full bg-white/[0.08] text-white border border-[rgba(190,190,200,0.15)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#9fb4ee]" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#9a9ca3] mb-1.5">Max single bet ≥ ($)</label>
              <input type="number" value={minBet} onChange={e => setMinBet(e.target.value)} className="w-full bg-white/[0.08] text-white border border-[rgba(190,190,200,0.15)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#9fb4ee]" />
            </div>
          </div>
          )}
          <div className="md:col-span-2">
            <label className="block text-[11px] font-medium text-[#9a9ca3] mb-1.5">Alert type</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAlertType("new_whale")}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${alertType === "new_whale" ? "bg-[#8ea4e8]/12 border-[#6aa9d8]/40 text-[#9fb4ee]" : "bg-white/[0.08] border-[rgba(190,190,200,0.15)] text-[#9a9ca3]"}`}>
                🐋 New whale (first-ever bet)
              </button>
              <button type="button" onClick={() => setAlertType("starred_open")}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${alertType === "starred_open" ? "bg-yellow-400/10 border-yellow-400/40 text-yellow-300" : "bg-white/[0.08] border-[rgba(190,190,200,0.15)] text-[#9a9ca3]"}`}>
                ⭐ Watchlist opens position
              </button>
              <button type="button" onClick={() => setAlertType("updown")}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${alertType === "updown" ? "bg-[#e5787f]/10 border-[#e5787f]/40 text-[#e0a0a8]" : "bg-white/[0.08] border-[rgba(190,190,200,0.15)] text-[#9a9ca3]"}`}>
                📈 سیگنال UP/DOWN (Jev Multi-Model)
              </button>
              <button type="button" onClick={() => setAlertType("starred_gold")}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${alertType === "starred_gold" ? "bg-[#d4b063]/10 border-[#d4b063]/40 text-[#d4b063]" : "bg-white/[0.08] border-[rgba(190,190,200,0.15)] text-[#9a9ca3]"}`}>
                🥇 Gold starred opens
              </button>
            </div>
            {alertType === "updown" && (
              <p className="text-[11px] text-[#9a9ca3] mt-2 leading-relaxed">
                اسکن هر ۵ دقیقه برای ۷ کوین (BTC, ETH, SOL, XRP, DOGE, HYPE, BNB) با مدل‌های سه‌گانه هوش مصنوعی (Jev + Kev-4b + Span-01). در صورت تشخیص سیگنال نزول یا صعود قوی، پیام به تلگرام ارسال می‌شود و با دکمه‌های Pause/Resume قابل کنترل لحظه‌ای است.
              </p>
            )}
          </div>
          {alertType === "starred_open" ? (
            <div className="md:col-span-2">
              <label className="block text-[11px] font-medium text-[#9a9ca3] mb-1.5">Wallets to watch (one per line — or leave empty to watch ALL starred wallets)</label>
              <textarea value={walletsText} onChange={e => setWalletsText(e.target.value)} rows={3}
                placeholder={"0x78becf0a4e4f...\n0xde3131239a35..."}
                className="w-full bg-white/[0.08] text-white border border-[rgba(190,190,200,0.15)] rounded-xl px-4 py-2 text-sm font-mono focus:outline-none focus:border-[#9fb4ee] placeholder:text-[#73757c]" />
              <label className="flex items-center gap-2 text-[11px] text-[#9a9ca3] mt-2 cursor-pointer">
                <input type="checkbox" checked={watchStarred} onChange={e => setWatchStarred(e.target.checked)} className="accent-[#6aa9d8]" />
                Also watch every starred wallet automatically (they can be empty here)
              </label>
            </div>
          ) : null}
          <div>
            <label className="block text-[11px] font-medium text-[#9a9ca3] mb-1.5">Telegram bot token</label>
            <input value={token} onChange={e => setToken(e.target.value)} placeholder="6834899734:AAGi..." className="w-full bg-white/[0.08] text-white border border-[rgba(190,190,200,0.15)] rounded-xl px-4 py-2 text-sm font-mono focus:outline-none focus:border-[#9fb4ee] placeholder:text-[#73757c]" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#9a9ca3] mb-1.5">Telegram chat ID</label>
            <input value={chat} onChange={e => setChat(e.target.value)} placeholder="92866868" className="w-full bg-white/[0.08] text-white border border-[rgba(190,190,200,0.15)] rounded-xl px-4 py-2 text-sm font-mono focus:outline-none focus:border-[#9fb4ee] placeholder:text-[#73757c]" />
          </div>
        </div>
        {formError && <p className="text-[#e5787f] text-xs mt-3">{formError}</p>}
        <button onClick={createAlert} disabled={!name || !token || !chat || (alertType === "starred_open" && !walletsText.trim() && !watchStarred)} className="mt-4 flex items-center gap-2 bg-[#6aa9d8] hover:bg-[#6aa9d8]/80 disabled:opacity-40 disabled:cursor-not-allowed text-[#131418] font-semibold rounded-xl px-5 py-2 text-sm transition-colors">
          <Plus className="w-4 h-4" /> Create alert
        </button>
      </div>

      {/* Rules list */}
      <div className="space-y-4">
        {loading ? (
          <p className="text-center text-[#73757c] p-8">Loading...</p>
        ) : alerts.length === 0 ? (
          <p className="text-center text-[#73757c] p-8">No alert rules yet — create one above.</p>
        ) : (
          alerts.map(a => (
            <div key={a.id} className="bg-white/[0.08] border border-[rgba(190,190,200,0.15)] p-5 rounded-2xl shadow-sm flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[240px]">
                <div className="flex items-center gap-2">
                  {a.enabled ? <CheckCircle2 className="w-4 h-4 text-[#5fbf9a]" /> : <XCircle className="w-4 h-4 text-[#73757c]" />}
                  <span className="font-semibold text-white">{a.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${a.enabled ? "bg-[#5fbf9a]/10 text-[#5fbf9a] border-[#5fbf9a]/30" : "bg-slate-800 text-[#73757c] border-[rgba(190,190,200,0.15)]"}`}>
                    {a.enabled ? "ACTIVE" : "PAUSED"}
                  </span>
                </div>
                <p className="text-xs text-[#9a9ca3] mt-1.5">
                  {a.alert_type === "starred_gold"
                    ? <>Fires when a <b className="text-[#d4b063]">🥇 Gold</b> starred wallet <b className="text-[#e8e8e4]">opens a new position</b> <span className="text-[#73757c]">(Gold category only)</span></>
                    : a.alert_type === "starred_open"
                    ? <>Fires when a watchlisted/starred wallet <b className="text-[#e8e8e4]">opens a new position</b> <span className="text-[#73757c]">(watching {a.wallet_count} wallet{a.wallet_count !== 1 ? "s" : ""} + starred)</span></>
                    : a.alert_type === "updown"
                    ? <>کنترل سیگنال‌های <b className="text-[#e8e8e4]">UP/DOWN و مدل‌های سه‌گانه هوش مصنوعی (Jev + Kev + Span)</b> · ارسال خودکار به تلگرام در اسکور &gt; ۳.۵ یا &lt; ۰.۵ با اطمینان ≥ ۹۰٪</>
                    : <>First-ever trade within <b className="text-[#e8e8e4]">{a.hours}h</b> &amp; max single bet ≥ <b className="text-[#e8e8e4]">${Number(a.min_bet).toLocaleString()}</b></>}
                  {" · "}→ chat <span className="font-mono">{a.telegram_chat}</span>
                </p>
                <p className="text-[11px] text-[#73757c] mt-1">
                  {a.alert_type === "updown" ? `ارسال ${a.fired_count} سیگنال تلگرام تا این لحظه` : `Fired ${a.fired_count} whale(s) so far`}
                  {a.last_fired_at && <> · آخرین ارسال {formatDistanceToNow(new Date(a.last_fired_at * 1000), { addSuffix: true })}</>}
                  {a.last_evaluated_at && <> · آخرین ارزیابی {formatDistanceToNow(new Date(a.last_evaluated_at * 1000), { addSuffix: true })}</>}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => act(a.id, "test")} disabled={busy === `${a.id}:test`} className="flex items-center gap-1.5 bg-white/[0.08] hover:bg-[#8ea4e8]/12 border border-[rgba(190,190,200,0.15)] hover:border-[#6aa9d8]/40 text-[#e8e8e4] rounded-xl px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40">
                  <Send className="w-3.5 h-3.5" /> Test
                </button>
                <button onClick={() => act(a.id, "run")} disabled={busy === `${a.id}:run`} className="flex items-center gap-1.5 bg-white/[0.08] hover:bg-[#8ea4e8]/12 border border-[rgba(190,190,200,0.15)] hover:border-[#6aa9d8]/40 text-[#e8e8e4] rounded-xl px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40">
                  <Play className="w-3.5 h-3.5" /> Run now
                </button>
                <button onClick={() => act(a.id, a.enabled ? "disable" : "enable")} className="flex items-center gap-1.5 bg-white/[0.08] hover:bg-slate-800 border border-[rgba(190,190,200,0.15)] text-[#bdbdb8] rounded-xl px-3 py-2 text-xs font-medium transition-colors">
                  <Power className="w-3.5 h-3.5" /> {a.enabled ? "Pause" : "Resume"}
                </button>
                <button onClick={() => act(a.id, "delete")} className="flex items-center gap-1.5 bg-white/[0.08] hover:bg-[#e5787f]/10 border border-[rgba(190,190,200,0.15)] hover:border-[#e5787f]/40 text-[#e5787f] rounded-xl px-3 py-2 text-xs font-medium transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
