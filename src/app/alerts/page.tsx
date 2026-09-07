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
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-semibold mb-1 tracking-tight text-white flex items-center gap-2"><Bell className="w-6 h-6 text-[#38BDF8]" /> Alerts</h1>
        <p className="text-sm text-slate-400 uppercase tracking-wide">Get a Telegram ping when a TRUE new whale appears — evaluated every 60s, each whale notifies once per rule</p>
      </div>

      {toast && (
        <div className={`p-4 rounded-2xl border text-sm font-medium ${toast.ok ? "bg-[#34D399]/10 border-[#34D399]/30 text-[#34D399]" : "bg-[#FB7185]/10 border-[#FB7185]/30 text-[#FB7185]"}`}>
          {toast.msg}
        </div>
      )}

      {/* Create form */}
      <div className="bg-[#111827] border border-slate-800/50 p-5 rounded-2xl shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-slate-700/50 to-transparent"></div>
        <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2"><Plus className="w-4 h-4 text-[#38BDF8]" /> New alert rule</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">Rule name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="New whale > $1k in 24h" className="w-full bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#38BDF8] focus:ring-1 focus:ring-[#38BDF8] transition-shadow placeholder:text-slate-500" />
          </div>
          {alertType === "new_whale" && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">First trade within (hours)</label>
              <input type="number" value={hours} onChange={e => setHours(e.target.value)} className="w-full bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#38BDF8]" />
            </div>
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">Max single bet ≥ ($)</label>
              <input type="number" value={minBet} onChange={e => setMinBet(e.target.value)} className="w-full bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#38BDF8]" />
            </div>
          </div>
          )}
          <div className="md:col-span-2">
            <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">Alert type</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAlertType("new_whale")}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${alertType === "new_whale" ? "bg-[#38BDF8]/10 border-[#38BDF8]/40 text-[#38BDF8]" : "bg-[#1E2939] border-slate-700 text-slate-400"}`}>
                🐋 New whale (first-ever bet)
              </button>
              <button type="button" onClick={() => setAlertType("starred_open")}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${alertType === "starred_open" ? "bg-yellow-400/10 border-yellow-400/40 text-yellow-300" : "bg-[#1E2939] border-slate-700 text-slate-400"}`}>
                ⭐ Watchlist opens position
              </button>
            </div>
          </div>
          {alertType === "starred_open" ? (
            <div className="md:col-span-2">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">Wallets to watch (one per line — or leave empty to watch ALL starred wallets)</label>
              <textarea value={walletsText} onChange={e => setWalletsText(e.target.value)} rows={3}
                placeholder={"0x78becf0a4e4f...\n0xde3131239a35..."}
                className="w-full bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm font-mono focus:outline-none focus:border-[#38BDF8] placeholder:text-slate-500" />
              <label className="flex items-center gap-2 text-[11px] text-slate-400 mt-2 cursor-pointer">
                <input type="checkbox" checked={watchStarred} onChange={e => setWatchStarred(e.target.checked)} className="accent-[#38BDF8]" />
                Also watch every starred wallet automatically (they can be empty here)
              </label>
            </div>
          ) : null}
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">Telegram bot token</label>
            <input value={token} onChange={e => setToken(e.target.value)} placeholder="123456789:AAExample_Token_Placeholder" className="w-full bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm font-mono focus:outline-none focus:border-[#38BDF8] placeholder:text-slate-500" />
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">Telegram chat ID</label>
            <input value={chat} onChange={e => setChat(e.target.value)} placeholder="92866868" className="w-full bg-[#1E2939] text-white border border-slate-700 rounded-xl px-4 py-2 text-sm font-mono focus:outline-none focus:border-[#38BDF8] placeholder:text-slate-500" />
          </div>
        </div>
        {formError && <p className="text-[#FB7185] text-xs mt-3">{formError}</p>}
        <button onClick={createAlert} disabled={!name || !token || !chat || (alertType === "starred_open" && !walletsText.trim() && !watchStarred)} className="mt-4 flex items-center gap-2 bg-[#38BDF8] hover:bg-[#38BDF8]/80 disabled:opacity-40 disabled:cursor-not-allowed text-[#0B1120] font-semibold rounded-xl px-5 py-2 text-sm transition-colors">
          <Plus className="w-4 h-4" /> Create alert
        </button>
      </div>

      {/* Rules list */}
      <div className="space-y-4">
        {loading ? (
          <p className="text-center text-slate-500 p-8">Loading...</p>
        ) : alerts.length === 0 ? (
          <p className="text-center text-slate-500 p-8">No alert rules yet — create one above.</p>
        ) : (
          alerts.map(a => (
            <div key={a.id} className="bg-[#111827] border border-slate-800/50 p-5 rounded-2xl shadow-sm flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[240px]">
                <div className="flex items-center gap-2">
                  {a.enabled ? <CheckCircle2 className="w-4 h-4 text-[#34D399]" /> : <XCircle className="w-4 h-4 text-slate-600" />}
                  <span className="font-semibold text-white">{a.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${a.enabled ? "bg-[#34D399]/10 text-[#34D399] border-[#34D399]/20" : "bg-slate-800 text-slate-500 border-slate-700"}`}>
                    {a.enabled ? "ACTIVE" : "PAUSED"}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1.5">
                  {a.alert_type === "starred_open"
                    ? <>Fires when a watchlisted/starred wallet <b className="text-slate-200">opens a new position</b> <span className="text-slate-500">(watching {a.wallet_count} wallet{a.wallet_count !== 1 ? "s" : ""} + starred)</span></>
                    : <>First-ever trade within <b className="text-slate-200">{a.hours}h</b> &amp; max single bet ≥ <b className="text-slate-200">${Number(a.min_bet).toLocaleString()}</b></>}
                  {" · "}→ chat <span className="font-mono">{a.telegram_chat}</span>
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Fired {a.fired_count} whale(s) so far
                  {a.last_fired_at && <> · last fire {formatDistanceToNow(new Date(a.last_fired_at * 1000), { addSuffix: true })}</>}
                  {a.last_evaluated_at && <> · checked {formatDistanceToNow(new Date(a.last_evaluated_at * 1000), { addSuffix: true })}</>}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => act(a.id, "test")} disabled={busy === `${a.id}:test`} className="flex items-center gap-1.5 bg-[#1E2939] hover:bg-[#38BDF8]/10 border border-slate-700 hover:border-[#38BDF8]/40 text-slate-200 rounded-xl px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40">
                  <Send className="w-3.5 h-3.5" /> Test
                </button>
                <button onClick={() => act(a.id, "run")} disabled={busy === `${a.id}:run`} className="flex items-center gap-1.5 bg-[#1E2939] hover:bg-[#38BDF8]/10 border border-slate-700 hover:border-[#38BDF8]/40 text-slate-200 rounded-xl px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40">
                  <Play className="w-3.5 h-3.5" /> Run now
                </button>
                <button onClick={() => act(a.id, a.enabled ? "disable" : "enable")} className="flex items-center gap-1.5 bg-[#1E2939] hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-xl px-3 py-2 text-xs font-medium transition-colors">
                  <Power className="w-3.5 h-3.5" /> {a.enabled ? "Pause" : "Resume"}
                </button>
                <button onClick={() => act(a.id, "delete")} className="flex items-center gap-1.5 bg-[#1E2939] hover:bg-[#FB7185]/10 border border-slate-700 hover:border-[#FB7185]/40 text-[#FB7185] rounded-xl px-3 py-2 text-xs font-medium transition-colors">
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
