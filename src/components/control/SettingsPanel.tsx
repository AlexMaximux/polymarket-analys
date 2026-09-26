"use client";

import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Save } from "lucide-react";
import type { PublicSetting, SettingKey } from "@/lib/settings";
import { btn, card, input } from "./format";

type Kind = "secret" | "text" | "int" | "coins" | "flags";
interface Field {
  label: string;
  kind: Kind;
  hint?: string;
  flags?: Record<string, string>;
}

const FIELDS: Record<SettingKey, Field> = {
  "openrouter.apiKey": { label: "API key", kind: "secret" },
  "jev.telegramToken": { label: "Bot token", kind: "secret", hint: "Default target for Jev signal alerts" },
  "jev.telegramChat": { label: "Chat ID", kind: "text" },
  "llm.baseUrl": { label: "Base URL", kind: "text", hint: "OpenAI-compatible endpoint, e.g. https://…/v1" },
  "llm.apiKey": { label: "API key", kind: "secret" },
  "llm.model": { label: "Model", kind: "text" },
  "jev.coins": { label: "Coins", kind: "coins" },
  "jev.models": {
    label: "Models",
    kind: "flags",
    flags: { jev: "Jev", kev: "Kev-4b", span: "Span-01" },
    hint: "Each enabled model is one paid OpenRouter call per coin per record",
  },
  "jev.recordIntervalSec": { label: "Record every (s)", kind: "int", hint: "60–3600" },
  "jev.snapshotIntervalSec": { label: "Snapshot refresh (s)", kind: "int", hint: "10–600" },
  "crawl.intervalSec": { label: "Crawl poll (s)", kind: "int", hint: "10–600" },
  "alerts.intervalSec": { label: "Alert evaluation (s)", kind: "int", hint: "30–3600" },
  "supervisor.autostart": {
    label: "Start with supervisor",
    kind: "flags",
    flags: { crawl: "crawl", backfill: "backfill", alerts: "alerts", jev: "jev" },
    hint: "Applies next time the supervisor starts",
  },
};

const GROUPS: Array<{ title: string; keys: SettingKey[]; test?: "openrouter" | "telegram" | "llm" }> = [
  { title: "OpenRouter", keys: ["openrouter.apiKey"], test: "openrouter" },
  { title: "Jev Telegram", keys: ["jev.telegramToken", "jev.telegramChat"], test: "telegram" },
  { title: "Wallet-analysis LLM", keys: ["llm.baseUrl", "llm.apiKey", "llm.model"], test: "llm" },
  { title: "Jev collector", keys: ["jev.coins", "jev.models", "jev.recordIntervalSec", "jev.snapshotIntervalSec"] },
  { title: "Intervals", keys: ["crawl.intervalSec", "alerts.intervalSec"] },
  { title: "Supervisor", keys: ["supervisor.autostart"] },
];

export function SettingsPanel({ notify }: { notify: (ok: boolean, msg: string) => void }) {
  const [settings, setSettings] = useState<Record<SettingKey, PublicSetting> | null>(null);
  const [coins, setCoins] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<SettingKey, unknown>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch("/api/settings", { cache: "no-store" })
        .then(r => r.json())
        .then(d => {
          setSettings(d.settings);
          setCoins(d.coins);
        }),
    []
  );
  useEffect(() => {
    load().catch(() => notify(false, "Could not load settings"));
  }, [load, notify]);

  if (!settings) return <section className={`${card} p-5 text-sm text-[#73757c]`}>Loading settings…</section>;

  const current = (key: SettingKey): unknown => {
    if (key in drafts) return drafts[key];
    const s = settings[key];
    return s.secret ? "" : s.value;
  };
  const setDraft = (key: SettingKey, value: unknown) => setDrafts(d => ({ ...d, [key]: value }));

  const save = async (title: string, keys: SettingKey[]) => {
    const changes = Object.fromEntries(keys.filter(k => k in drafts).map(k => [k, drafts[k]]));
    if (!Object.keys(changes).length) return notify(true, "Nothing changed");
    setBusy(`save:${title}`);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const d = await res.json();
      if (!res.ok) {
        setErrors(e => ({ ...e, ...d.errors }));
        return notify(false, "Not saved — fix the highlighted fields");
      }
      setErrors(e => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k as SettingKey))));
      setDrafts(dr => Object.fromEntries(Object.entries(dr).filter(([k]) => !keys.includes(k as SettingKey))));
      await load();
      const parts = ["Saved."];
      if (d.restarted.length) parts.push(`Restarted: ${d.restarted.join(", ")}.`);
      if (d.pending.length) parts.push(`Restart ${d.pending.join(", ")} to apply${d.supervisor ? "" : " (supervisor not running)"}.`);
      notify(true, parts.join(" "));
    } catch {
      notify(false, "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const test = async (target: string) => {
    setBusy(`test:${target}`);
    try {
      const d = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      }).then(r => r.json());
      notify(!!d.ok, d.message);
    } catch {
      notify(false, "Test failed");
    } finally {
      setBusy(null);
    }
  };

  const renderField = (key: SettingKey) => {
    const f = FIELDS[key];
    const s = settings[key];
    const value = current(key);
    const err = errors[key];
    let control: React.ReactNode;
    if (f.kind === "secret" && s.secret) {
      control = (
        <input
          type="password"
          autoComplete="off"
          className={input}
          value={String(value ?? "")}
          placeholder={s.set ? `set ${s.masked ?? ""} (${s.source === "env" ? ".env.local" : "saved"}) — leave empty to keep` : "not set"}
          onChange={e => setDraft(key, e.target.value)}
        />
      );
    } else if (f.kind === "text") {
      control = <input className={input} value={String(value ?? "")} onChange={e => setDraft(key, e.target.value)} />;
    } else if (f.kind === "int") {
      control = (
        <input className={`${input} max-w-[8rem] tabular-nums`} inputMode="numeric" value={String(value ?? "")} onChange={e => setDraft(key, e.target.value)} />
      );
    } else if (f.kind === "coins") {
      const picked = new Set((value as string[]) ?? []);
      control = (
        <div className="flex flex-wrap gap-3">
          {coins.map(c => (
            <label key={c} className="flex items-center gap-1.5 text-xs text-[#bdbdb8] cursor-pointer uppercase">
              <input
                type="checkbox"
                className="accent-[#6aa9d8]"
                checked={picked.has(c)}
                onChange={e => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(c);
                  else next.delete(c);
                  setDraft(key, coins.filter(x => next.has(x)));
                }}
              />
              {c}
            </label>
          ))}
        </div>
      );
    } else {
      const flags = (value as Record<string, boolean>) ?? {};
      control = (
        <div className="flex flex-wrap gap-3">
          {Object.entries(f.flags ?? {}).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5 text-xs text-[#bdbdb8] cursor-pointer">
              <input
                type="checkbox"
                className="accent-[#6aa9d8]"
                checked={!!flags[k]}
                onChange={e => setDraft(key, { ...flags, [k]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      );
    }
    return (
      <div key={key}>
        <label className="block text-[11px] font-medium text-[#9a9ca3] mb-1.5">
          {f.label}
          {!s.secret && s.source !== "db" && (
            <span className="text-[#73757c] font-normal"> · {s.source === "env" ? "from .env.local" : "default"}</span>
          )}
        </label>
        {control}
        {err ? <p className="text-[11px] text-[#e5787f] mt-1">{err}</p> : f.hint ? <p className="text-[11px] text-[#73757c] mt-1">{f.hint}</p> : null}
      </div>
    );
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-[#e8e8e4]">Settings</h2>
      <div className="grid md:grid-cols-2 gap-3">
        {GROUPS.map(g => (
          <div key={g.title} className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-4 gap-2">
              <h3 className="text-sm text-[#e8e8e4]">{g.title}</h3>
              <div className="flex gap-2">
                {g.test && (
                  <button className={btn} disabled={busy === `test:${g.test}`} onClick={() => test(g.test!)} title="Uses the saved values">
                    <FlaskConical className="w-3.5 h-3.5" /> Test saved
                  </button>
                )}
                <button className={btn} disabled={busy === `save:${g.title}`} onClick={() => save(g.title, g.keys)}>
                  <Save className="w-3.5 h-3.5" /> Save
                </button>
              </div>
            </div>
            <div className="space-y-4">{g.keys.map(renderField)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
