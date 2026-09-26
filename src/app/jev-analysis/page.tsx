"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Clock,
  Filter,
  Search,
  Download,
  Eye,
  RefreshCw,
  Check,
  SlidersHorizontal,
  FileJson,
  ArrowRight,
  BarChart3,
  Calendar,
  Layers,
  ChevronDown,
  Save,
  RotateCcw,
  CheckCircle2,
  Settings2,
  Sliders,
  Tag,
} from "lucide-react";

export interface SignalMarkerConfig {
  enabled: boolean;
  bullishScore: number;     // e.g. 3.5
  bullishMinConf: number;   // e.g. 90
  bearishScore: number;     // e.g. 0.5
  bearishMinConf: number;   // e.g. 90
  confidenceType: "score" | "direction" | "any";
  bullishColor: string;     // default "#38bdf8"
  bearishColor: string;     // default "#ef4444"
  modelSource?: "jev" | "kev" | "span" | "consensus"; // Default "jev"
}

export const DEFAULT_SIGNAL_CONFIG: SignalMarkerConfig = {
  enabled: true,
  bullishScore: 3.5,
  bullishMinConf: 90,
  bearishScore: 0.5,
  bearishMinConf: 90,
  confidenceType: "score",
  bullishColor: "#38bdf8",
  bearishColor: "#ef4444",
  modelSource: "jev",
};

export interface SignalMatch {
  type: "BULLISH" | "BEARISH";
  label: string;
  rule: string;
  color: string;
  bgColor: string;
  borderColor: string;
  score: number;
  confidence: number;
  sourceModel?: string;
}

export function evaluateSignal(r: JevFileRecord, cfg: SignalMarkerConfig): SignalMatch | null {
  if (!cfg.enabled) return null;

  const modelSrc = cfg.modelSource || "jev";
  let targetScore: number | null | undefined = null;
  let conf: number | null | undefined = null;
  let modelName = "Jev";

  if (modelSrc === "kev") {
    targetScore = r.kev_score;
    if (cfg.confidenceType === "direction") {
      conf = r.kev_direction_confidence ?? r.kev_confidence;
    } else {
      conf = r.kev_score_confidence ?? r.kev_confidence;
    }
    modelName = "Kev-4b";
  } else if (modelSrc === "span") {
    targetScore = r.span_score;
    conf = r.span_confidence;
    modelName = "Span-01";
  } else if (modelSrc === "consensus") {
    const scores = [r.score, r.kev_score, r.span_score].filter((s): s is number => s != null);
    targetScore = scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null;
    conf = r.consensus_agreement ?? r.score_confidence;
    modelName = "اجماع مدل‌ها";
  } else {
    // "jev" (default)
    targetScore = r.score;
    if (cfg.confidenceType === "direction") {
      conf = r.direction_confidence ?? null;
    } else {
      conf = r.score_confidence ?? null;
    }
    modelName = "Jev";
  }

  if (targetScore == null || conf == null || isNaN(conf)) return null;

  // Bullish: Target Score > 3.5 AND at the same time Confidence >= 90%
  if (targetScore > cfg.bullishScore && conf >= cfg.bullishMinConf) {
    return {
      type: "BULLISH",
      label: `سیگنال صعود (${modelName} - تیک آبی)`,
      rule: `اسکور ${modelName} > ${cfg.bullishScore} و اطمینان ≥ ${cfg.bullishMinConf}%`,
      color: cfg.bullishColor || "#38bdf8",
      bgColor: "rgba(56, 189, 248, 0.15)",
      borderColor: cfg.bullishColor || "#38bdf8",
      score: targetScore,
      confidence: conf,
      sourceModel: modelName,
    };
  }

  // Bearish: Target Score < 0.5 AND at the same time Confidence >= 90%
  if (targetScore < cfg.bearishScore && conf >= cfg.bearishMinConf) {
    return {
      type: "BEARISH",
      label: `سیگنال نزول (${modelName} - تیک قرمز)`,
      rule: `اسکور ${modelName} < ${cfg.bearishScore} و اطمینان ≥ ${cfg.bearishMinConf}%`,
      color: cfg.bearishColor || "#ef4444",
      bgColor: "rgba(239, 68, 68, 0.15)",
      borderColor: cfg.bearishColor || "#ef4444",
      score: targetScore,
      confidence: conf,
      sourceModel: modelName,
    };
  }

  return null;
}

interface JevFileRecord {
  filename: string;
  coin?: string;
  coin_label?: string | null;
  et_time: string;
  current_time_et?: string;
  timestamp?: string;
  score?: number | null;
  score_label?: string | null;
  direction?: "UP" | "DOWN" | null;
  score_confidence?: number | null;
  direction_confidence?: number | null;
  confidence?: number | null;
  prob_up?: number | null;
  prob_down?: number | null;
  up_1h?: string | null;
  down_1h?: string | null;
  up_1h_num?: number | null;
  up_15m?: string | null;
  up_15m_num?: number | null;
  up_5m?: string | null;
  up_5m_num?: number | null;
  fair_15m?: number | null;
  fair_5m?: number | null;
  fair_base?: number | null;
  fair_joint?: number | null;
  tokens?: number | null;
  cost?: number | null;

  // Kev-4b (jaredpalmer/kev-4b)
  kev_direction?: "UP" | "DOWN" | null;
  kev_score?: number | null;
  kev_score_label?: string | null;
  kev_confidence?: number | null;
  kev_score_confidence?: number | null;
  kev_direction_confidence?: number | null;
  kev_prob_up?: number | null;

  // Span-01 (respan/span-01)
  span_direction?: "UP" | "DOWN" | null;
  span_score?: number | null;
  span_score_label?: string | null;
  span_confidence?: number | null;
  span_prob_up?: number | null;
  span_prob_down?: number | null;

  // Consensus (3 Models)
  consensus_direction?: "UP" | "DOWN" | "SPLIT" | null;
  consensus_summary?: string | null;
  consensus_agreement?: number | null;
}

interface ColumnDef {
  id: string;
  label: string;
  shortLabel: string;
  category: "jev" | "market" | "fair" | "models";
  render: (row: JevFileRecord, signalConfig?: SignalMarkerConfig) => React.ReactNode;
  exportVal: (row: JevFileRecord, signalConfig?: SignalMarkerConfig) => string | number;
}

const ALL_COLUMNS: ColumnDef[] = [
  {
    id: "coin",
    label: "ارز (Coin)",
    shortLabel: "ارز",
    category: "jev",
    render: (r) => (
      <span className="font-bold text-xs px-2.5 py-0.5 rounded-full bg-white/[0.08] border border-white/[0.15] text-[#38bdf8]">
        {r.coin || "BTC"}
      </span>
    ),
    exportVal: (r) => r.coin || "BTC",
  },
  {
    id: "consensus",
    label: "اجماع ۳ مدل (Consensus: Jev + Kev + Span)",
    shortLabel: "اجماع مدل‌ها",
    category: "models",
    render: (r) => {
      const dirs = [r.direction, r.kev_direction, r.span_direction].filter(Boolean) as ("UP" | "DOWN")[];
      if (dirs.length === 0) return <span className="text-[#5d628f]">—</span>;
      const ups = dirs.filter((d) => d === "UP").length;
      const downs = dirs.filter((d) => d === "DOWN").length;

      if (ups === dirs.length) {
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#2ce5a7]/20 text-[#2ce5a7] border border-[#2ce5a7]/40">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2ce5a7] animate-pulse" />
            {ups}/3 صعود کامل (UP)
          </span>
        );
      }
      if (downs === dirs.length) {
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#ff6b9d]/20 text-[#ff6b9d] border border-[#ff6b9d]/40">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff6b9d] animate-pulse" />
            {downs}/3 نزول کامل (DOWN)
          </span>
        );
      }
      if (ups > downs) {
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[#2ce5a7]/10 text-[#86efac] border border-[#2ce5a7]/20">
            {ups}/3 تمایل صعود
          </span>
        );
      }
      if (downs > ups) {
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[#ff6b9d]/10 text-[#ffa8b8] border border-[#ff6b9d]/20">
            {downs}/3 تمایل نزول
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-[#8b91c5] bg-white/[0.05] border border-white/[0.1]">
          اختلاف نظر (Split)
        </span>
      );
    },
    exportVal: (r) => {
      const dirs = [r.direction, r.kev_direction, r.span_direction].filter(Boolean);
      const ups = dirs.filter((d) => d === "UP").length;
      return `${ups}/${dirs.length} UP`;
    },
  },
  {
    id: "signal",
    label: "تیک سیگنال شرطی (Signal Marker)",
    shortLabel: "سیگنال شرطی",
    category: "jev",
    render: (r, cfg) => {
      const sig = evaluateSignal(r, cfg || DEFAULT_SIGNAL_CONFIG);
      if (!sig) return <span className="text-[#5d628f]">—</span>;
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-sm"
          style={{
            color: sig.color,
            borderColor: `${sig.borderColor}60`,
            backgroundColor: sig.bgColor,
          }}
        >
          <span className="font-bold">✓</span>
          {sig.type === "BULLISH" ? "سیگنال صعود (آبی)" : "سیگنال نزول (قرمز)"}
        </span>
      );
    },
    exportVal: (r, cfg) => {
      const sig = evaluateSignal(r, cfg || DEFAULT_SIGNAL_CONFIG);
      return sig ? sig.label : "";
    },
  },
  {
    id: "direction",
    label: "جهت Jev (Direction)",
    shortLabel: "جهت Jev",
    category: "jev",
    render: (r) =>
      r.direction ? (
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
            r.direction === "UP"
              ? "bg-[#2ce5a7]/20 text-[#2ce5a7] border border-[#2ce5a7]/30"
              : "bg-[#ff6b9d]/20 text-[#ff6b9d] border border-[#ff6b9d]/30"
          }`}
        >
          {r.direction === "UP" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {r.direction}
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => r.direction || "",
  },
  {
    id: "score",
    label: "اسکور Jev (0 - 4)",
    shortLabel: "اسکور Jev",
    category: "jev",
    render: (r) =>
      r.score != null ? (
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-sm font-bold tabular-nums"
            style={{
              color:
                r.score >= 3.0
                  ? "#2ce5a7"
                  : r.score >= 2.2
                  ? "#86efac"
                  : r.score >= 1.8
                  ? "#8b91c5"
                  : r.score >= 1.0
                  ? "#ffa8b8"
                  : "#ff6b9d",
            }}
          >
            {r.score.toFixed(2)}
          </span>
          <span className="text-[10px] text-[#8b91c5] hidden sm:inline">
            {r.score >= 3 ? "صعودی قوی" : r.score <= 1 ? "نزولی قوی" : "خنثی"}
          </span>
        </div>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => r.score ?? "",
  },
  {
    id: "kev_direction",
    label: "جهت Kev-4b (Direction)",
    shortLabel: "جهت Kev",
    category: "models",
    render: (r) =>
      r.kev_direction ? (
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
              r.kev_direction === "UP"
                ? "bg-[#38bdf8]/20 text-[#38bdf8] border border-[#38bdf8]/30"
                : "bg-[#f43f5e]/20 text-[#f43f5e] border border-[#f43f5e]/30"
            }`}
          >
            {r.kev_direction === "UP" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {r.kev_direction}
          </span>
          {r.kev_score != null && (
            <span className="font-mono text-[11px] text-[#8b91c5]">({r.kev_score.toFixed(2)})</span>
          )}
        </div>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => r.kev_direction || "",
  },
  {
    id: "kev_score",
    label: "اسکور Kev-4b (0 - 4)",
    shortLabel: "اسکور Kev",
    category: "models",
    render: (r) =>
      r.kev_score != null ? (
        <div className="flex items-center gap-1.5">
          <span
            className="font-mono text-xs font-bold tabular-nums"
            style={{
              color:
                r.kev_score >= 3.0
                  ? "#2ce5a7"
                  : r.kev_score >= 2.2
                  ? "#86efac"
                  : r.kev_score >= 1.8
                  ? "#8b91c5"
                  : r.kev_score >= 1.0
                  ? "#ffa8b8"
                  : "#ff6b9d",
            }}
          >
            {r.kev_score.toFixed(2)}
          </span>
          {r.kev_confidence != null && (
            <span className="text-[10px] text-[#eab308]">({r.kev_confidence}%)</span>
          )}
        </div>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => r.kev_score ?? "",
  },
  {
    id: "kev_score_confidence",
    label: "درصد اطمینان اسکور Kev-4b (Score Confidence %)",
    shortLabel: "اطمینان اسکور Kev",
    category: "models",
    render: (r) =>
      r.kev_score_confidence != null ? (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-[#eab308] font-bold tabular-nums">
            {r.kev_score_confidence}%
          </span>
          <div className="w-12 h-1.5 bg-white/[0.08] rounded-full overflow-hidden hidden sm:block">
            <div
              className="h-full bg-gradient-to-r from-[#eab308] to-[#facc15] rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, r.kev_score_confidence))}%` }}
            />
          </div>
        </div>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.kev_score_confidence != null ? `${r.kev_score_confidence}%` : ""),
  },
  {
    id: "kev_direction_confidence",
    label: "درصد اطمینان سیگنال Kev-4b (Direction Confidence %)",
    shortLabel: "اطمینان سیگنال Kev",
    category: "models",
    render: (r) =>
      r.kev_direction_confidence != null ? (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-[#38bdf8] font-bold tabular-nums">
            {r.kev_direction_confidence}%
          </span>
          <div className="w-12 h-1.5 bg-white/[0.08] rounded-full overflow-hidden hidden sm:block">
            <div
              className="h-full bg-gradient-to-r from-[#0284c7] to-[#38bdf8] rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, r.kev_direction_confidence))}%` }}
            />
          </div>
        </div>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.kev_direction_confidence != null ? `${r.kev_direction_confidence}%` : ""),
  },
  {
    id: "kev_confidence",
    label: "اطمینان کلی Kev-4b (%)",
    shortLabel: "اطمینان Kev",
    category: "models",
    render: (r) =>
      r.kev_confidence != null ? (
        <span className="font-mono text-xs text-[#eab308] font-semibold tabular-nums">
          {r.kev_confidence}%
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.kev_confidence != null ? `${r.kev_confidence}%` : ""),
  },
  {
    id: "kev_prob_up",
    label: "احتمال صعود Kev-4b (%UP)",
    shortLabel: "Kev %UP",
    category: "models",
    render: (r) =>
      r.kev_prob_up != null ? (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-[#38bdf8] font-semibold tabular-nums">
            {r.kev_prob_up}%
          </span>
          <div className="w-10 h-1.5 bg-white/[0.08] rounded-full overflow-hidden hidden sm:block">
            <div
              className="h-full bg-gradient-to-r from-[#0284c7] to-[#38bdf8] rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, r.kev_prob_up))}%` }}
            />
          </div>
        </div>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.kev_prob_up != null ? `${r.kev_prob_up}%` : ""),
  },
  {
    id: "span_direction",
    label: "سیگنال Span-01",
    shortLabel: "سیگنال Span",
    category: "models",
    render: (r) =>
      r.span_direction ? (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
            r.span_direction === "UP"
              ? "bg-[#c084fc]/20 text-[#c084fc] border border-[#c084fc]/30"
              : "bg-[#fb7185]/20 text-[#fb7185] border border-[#fb7185]/30"
          }`}
        >
          {r.span_direction === "UP" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {r.span_direction}
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => r.span_direction || "",
  },
  {
    id: "span_score",
    label: "اسکور Span-01 (0 - 4)",
    shortLabel: "اسکور Span",
    category: "models",
    render: (r) =>
      r.span_score != null ? (
        <div className="flex items-center gap-1.5">
          <span
            className="font-mono text-xs font-bold tabular-nums"
            style={{
              color:
                r.span_score >= 3.0
                  ? "#2ce5a7"
                  : r.span_score >= 2.2
                  ? "#86efac"
                  : r.span_score >= 1.8
                  ? "#8b91c5"
                  : r.span_score >= 1.0
                  ? "#ffa8b8"
                  : "#ff6b9d",
            }}
          >
            {r.span_score.toFixed(2)}
          </span>
          {r.span_confidence != null && (
            <span className="text-[10px] text-[#eab308]">({r.span_confidence}%)</span>
          )}
          <span className="text-[10px] text-[#5d628f] hidden sm:inline">
            {r.span_score >= 3.0
              ? "Strong Up"
              : r.span_score >= 2.2
              ? "Lean Up"
              : r.span_score >= 1.8
              ? "Neutral"
              : r.span_score >= 1.0
              ? "Lean Down"
              : "Strong Down"}
          </span>
        </div>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => r.span_score ?? "",
  },
  {
    id: "span_confidence",
    label: "اطمینان اسکور Span-01",
    shortLabel: "اطمینان Span",
    category: "models",
    render: (r) =>
      r.span_confidence != null ? (
        <span className="font-mono text-xs text-[#eab308] font-semibold tabular-nums">
          {r.span_confidence}%
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.span_confidence != null ? `${r.span_confidence}%` : ""),
  },
  {
    id: "span_prob_up",
    label: "احتمال صعود Span-01 (%UP)",
    shortLabel: "Span-01 %UP",
    category: "models",
    render: (r) =>
      r.span_prob_up != null ? (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-[#c084fc] font-semibold tabular-nums">
            {r.span_prob_up}%
          </span>
          <div className="w-10 h-1.5 bg-white/[0.08] rounded-full overflow-hidden hidden sm:block">
            <div
              className="h-full bg-gradient-to-r from-[#a855f7] to-[#c084fc] rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, r.span_prob_up))}%` }}
            />
          </div>
        </div>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.span_prob_up != null ? `${r.span_prob_up}%` : ""),
  },
  {
    id: "prob_up",
    label: "احتمال صعود Jev (%UP)",
    shortLabel: "احتمال UP",
    category: "jev",
    render: (r) =>
      r.prob_up != null ? (
        <span className="font-mono text-xs text-[#2ce5a7] font-semibold tabular-nums">
          {r.prob_up}%
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.prob_up != null ? `${r.prob_up}%` : ""),
  },
  {
    id: "score_confidence",
    label: "درصد اطمینان اسکور Jev (Score Confidence %)",
    shortLabel: "اطمینان اسکور",
    category: "jev",
    render: (r) =>
      r.score_confidence != null ? (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-[#eab308] font-bold tabular-nums">
            {r.score_confidence}%
          </span>
          <div className="w-12 h-1.5 bg-white/[0.08] rounded-full overflow-hidden hidden sm:block">
            <div
              className="h-full bg-gradient-to-r from-[#eab308] to-[#facc15] rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, r.score_confidence))}%` }}
            />
          </div>
        </div>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.score_confidence != null ? `${r.score_confidence}%` : ""),
  },
  {
    id: "direction_confidence",
    label: "درصد اطمینان جهت Jev (Direction Confidence %)",
    shortLabel: "اطمینان جهت",
    category: "jev",
    render: (r) =>
      r.direction_confidence != null ? (
        <span className="font-mono text-xs text-[#a5b4fc] font-semibold tabular-nums">
          {r.direction_confidence}%
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.direction_confidence != null ? `${r.direction_confidence}%` : ""),
  },
  {
    id: "confidence",
    label: "درصد اطمینان کلی Jev",
    shortLabel: "اطمینان کلی",
    category: "jev",
    render: (r) =>
      r.confidence != null ? (
        <span className="font-mono text-xs text-[#c3c8ee] tabular-nums">
          {r.confidence}%
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.confidence != null ? `${r.confidence}%` : ""),
  },
  {
    id: "up_1h",
    label: "پلی‌مارکت ۱ ساعته (1H Up)",
    shortLabel: "1H Up %",
    category: "market",
    render: (r) =>
      r.up_1h ? (
        <div className="flex items-center gap-1.5 font-mono text-xs">
          <span className="text-[#38bdf8] font-semibold">{r.up_1h}</span>
          <span className="text-[#5d628f] text-[10px]">({r.down_1h || "—"})</span>
        </div>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => r.up_1h || "",
  },
  {
    id: "up_15m",
    label: "پلی‌مارکت ۱۵ دقیقه‌ای (15M Up)",
    shortLabel: "15M Up %",
    category: "market",
    render: (r) =>
      r.up_15m ? (
        <span className="font-mono text-xs text-[#a5b4fc] tabular-nums font-medium">
          {r.up_15m}
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => r.up_15m || "",
  },
  {
    id: "up_5m",
    label: "پلی‌مارکت ۵ دقیقه‌ای (5M Up)",
    shortLabel: "5M Up %",
    category: "market",
    render: (r) =>
      r.up_5m ? (
        <span className="font-mono text-xs text-[#f472b6] tabular-nums font-medium">
          {r.up_5m}
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => r.up_5m || "",
  },
  {
    id: "fair_15m",
    label: "Fair Value (مدل 15m)",
    shortLabel: "Fair 15m",
    category: "fair",
    render: (r) =>
      r.fair_15m != null ? (
        <span className="font-mono text-xs text-[#38bdf8] tabular-nums">
          {r.fair_15m.toFixed(1)}¢
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.fair_15m != null ? `${r.fair_15m}c` : ""),
  },
  {
    id: "fair_5m",
    label: "Fair Value (مدل 5m)",
    shortLabel: "Fair 5m",
    category: "fair",
    render: (r) =>
      r.fair_5m != null ? (
        <span className="font-mono text-xs text-[#a99cff] tabular-nums">
          {r.fair_5m.toFixed(1)}¢
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.fair_5m != null ? `${r.fair_5m}c` : ""),
  },
  {
    id: "fair_joint",
    label: "Fair Value (مدل Joint Solve)",
    shortLabel: "Fair Joint",
    category: "fair",
    render: (r) =>
      r.fair_joint != null ? (
        <span className="font-mono text-xs text-[#c084fc] tabular-nums">
          {r.fair_joint.toFixed(1)}¢
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.fair_joint != null ? `${r.fair_joint}c` : ""),
  },
  {
    id: "fair_base",
    label: "Fair Value (مدل Base No Drift)",
    shortLabel: "Fair Base",
    category: "fair",
    render: (r) =>
      r.fair_base != null ? (
        <span className="font-mono text-xs text-[#cbd5e1] tabular-nums">
          {r.fair_base.toFixed(1)}¢
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.fair_base != null ? `${r.fair_base}c` : ""),
  },
  {
    id: "tokens",
    label: "توکن و هزینه Jev",
    shortLabel: "هزینه استعلام",
    category: "jev",
    render: (r) =>
      r.tokens ? (
        <span className="font-mono text-[11px] text-[#5d628f] tabular-nums">
          {r.tokens} tok (${r.cost ?? 0})
        </span>
      ) : (
        <span className="text-[#5d628f]">—</span>
      ),
    exportVal: (r) => (r.tokens ? `${r.tokens} tokens ($${r.cost})` : ""),
  },
];

const PRESETS = [
  {
    id: "multi_models",
    title: "🤖 ۳ مدل هوش مصنوعی (Jev + Kev + Span)",
    cols: ["coin", "consensus", "direction", "score", "kev_direction", "kev_score", "span_direction", "span_score", "up_1h"],
  },
  {
    id: "top3",
    title: "🌟 شاخص‌های اصلی + ۳ مدل",
    cols: ["coin", "consensus", "direction", "score", "kev_direction", "kev_score", "span_direction", "span_score", "up_1h"],
  },
  {
    id: "ai",
    title: "🧠 مقایسه تفصیلی اسکور و اطمینان ۳ مدل",
    cols: ["coin", "direction", "score", "score_confidence", "kev_direction", "kev_score", "kev_score_confidence", "kev_direction_confidence", "span_direction", "span_score", "span_confidence"],
  },
  {
    id: "markets",
    title: "📈 مقایسه ۳ تایم‌فریم بازار (1h / 15m / 5m)",
    cols: ["coin", "direction", "up_1h", "up_15m", "up_5m"],
  },
  {
    id: "fair_values",
    title: "🧮 مقایسه مدل‌های Fair Value",
    cols: ["coin", "direction", "fair_15m", "fair_5m", "fair_joint"],
  },
  {
    id: "signals",
    title: "🎯 تمرکز روی سیگنال‌های شرطی (تیک آبی/قرمز)",
    cols: ["coin", "signal", "direction", "score", "score_confidence", "up_1h"],
  },
  {
    id: "full",
    title: "🔍 نمایش جامع (تمام شاخص‌های ۳ مدل + بازار)",
    cols: ["coin", "consensus", "direction", "score", "score_confidence", "kev_direction", "kev_score", "kev_score_confidence", "kev_direction_confidence", "span_direction", "span_score", "span_confidence", "span_prob_up", "up_1h", "fair_15m"],
  },
];

// Helper: generate smooth cubic bezier SVG path
function generateSmoothCurve(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export const AVAILABLE_COINS = [
  { key: "all", label: "همه ارزها (All)" },
  { key: "btc", label: "بیت‌کوین (BTC)", color: "#F7931A" },
  { key: "eth", label: "اتریوم (ETH)", color: "#627EEA" },
  { key: "sol", label: "سولانا (SOL)", color: "#14F195" },
  { key: "xrp", label: "ریپل (XRP)", color: "#7FA8C9" },
  { key: "doge", label: "دوج‌کوین (DOGE)", color: "#C2A633" },
  { key: "hype", label: "هایپرلیکوئید (HYPE)", color: "#97FCE4" },
  { key: "bnb", label: "بی‌ان‌بی (BNB)", color: "#F3BA2F" },
];

export default function JevAnalysisPage() {
  const [data, setData] = useState<JevFileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected coin filter (all, btc, eth, sol, ...)
  const [selectedCoin, setSelectedCoin] = useState<string>("all");

  // Selected columns (default: coin, consensus, Jev, Kev, Span, and 1H market)
  const [selectedColIds, setSelectedColIds] = useState<string[]>([
    "coin",
    "consensus",
    "direction",
    "score",
    "kev_direction",
    "kev_score",
    "span_direction",
    "span_score",
    "up_1h",
  ]);

  // Chart Curve Series toggles
  const [visibleCurves, setVisibleCurves] = useState<{
    score: boolean;
    scoreConfidence: boolean;
    up1h: boolean;
    up15m: boolean;
    fair15m: boolean;
    up5m: boolean;
    signals: boolean;
    kevScore: boolean;
    spanScore: boolean;
  }>({
    score: true,
    scoreConfidence: false,
    up1h: true,
    up15m: false,
    fair15m: true,
    up5m: false,
    signals: true,
    kevScore: false,
    spanScore: false,
  });

  // Signal Markers Configuration (تیک‌های شرطی آبی و قرمز روی منحنی)
  const [signals, setSignals] = useState<SignalMarkerConfig>(DEFAULT_SIGNAL_CONFIG);
  const [showSignalSettings, setShowSignalSettings] = useState(false);

  // Time Interval Filters
  const [dateFilter, setDateFilter] = useState<string>("ALL");
  const [startHour, setStartHour] = useState<number | null>(null);
  const [endHour, setEndHour] = useState<number | null>(null);
  const [activeIntervalPreset, setActiveIntervalPreset] = useState<string>("ALL");

  // General Filters & Search
  const [dirFilter, setDirFilter] = useState<"ALL" | "UP" | "DOWN">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFileForModal, setSelectedFileForModal] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  // Dashboard Persistence (ذخیره‌سازی تنظیمات در مرورگر)
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const STORAGE_KEY = "jev_dashboard_preferences_v4";

  // Load saved preferences on client mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.selectedCoin === "string") {
          setSelectedCoin(parsed.selectedCoin);
        }
        if (Array.isArray(parsed.selectedColIds) && parsed.selectedColIds.length > 0) {
          setSelectedColIds(parsed.selectedColIds);
        }
        if (parsed.visibleCurves) {
          setVisibleCurves((prev) => ({ ...prev, ...parsed.visibleCurves }));
        }
        if (parsed.signals) {
          setSignals((prev) => ({
            ...prev,
            ...parsed.signals,
            // Enforce score confidence as requested by user
            confidenceType: parsed.signals.confidenceType === "direction" ? "direction" : "score",
          }));
        }
        if (typeof parsed.dateFilter === "string") setDateFilter(parsed.dateFilter);
        if (parsed.startHour !== undefined) setStartHour(parsed.startHour);
        if (parsed.endHour !== undefined) setEndHour(parsed.endHour);
        if (parsed.activeIntervalPreset !== undefined) setActiveIntervalPreset(parsed.activeIntervalPreset);
        if (parsed.dirFilter !== undefined) setDirFilter(parsed.dirFilter);
      }
    } catch (e) {
      console.error("Error loading dashboard preferences:", e);
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  // Sync coin from URL search param if present (e.g. ?coin=eth)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const c = params.get("coin");
      if (c) {
        setSelectedCoin(c.toLowerCase());
      }
    }
  }, []);

  // Auto-save whenever relevant settings change after initial load
  useEffect(() => {
    if (!settingsLoaded) return;
    try {
      const payload = {
        selectedCoin,
        selectedColIds,
        visibleCurves,
        signals,
        dateFilter,
        startHour,
        endHour,
        activeIntervalPreset,
        dirFilter,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setSaveStatus("تنظیمات داشبورد به‌طور خودکار ذخیره شد");
      const t = setTimeout(() => setSaveStatus(null), 2500);
      return () => clearTimeout(t);
    } catch (e) {
      console.error("Error auto-saving preferences:", e);
    }
  }, [
    settingsLoaded,
    selectedCoin,
    selectedColIds,
    visibleCurves,
    signals,
    dateFilter,
    startHour,
    endHour,
    activeIntervalPreset,
    dirFilter,
  ]);

  const saveCurrentSettingsNow = () => {
    try {
      const payload = {
        selectedCoin,
        selectedColIds,
        visibleCurves,
        signals,
        dateFilter,
        startHour,
        endHour,
        activeIntervalPreset,
        dirFilter,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setSaveStatus("تنظیمات داشبورد با موفقیت ذخیره شد ✓");
      setTimeout(() => setSaveStatus(null), 3000);
    } catch {
      setSaveStatus("خطا در ذخیره تنظیمات");
    }
  };

  const resetAllSettingsToDefault = () => {
    if (confirm("آیا مایلید تمام تنظیمات، ستون‌ها، فیلترها و شروط سیگنال به حالت پیش‌فرض بازگردد؟")) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      setSelectedCoin("all");
      setSelectedColIds(["coin", "consensus", "direction", "score", "kev_direction", "kev_score", "span_direction", "span_score", "up_1h"]);
      setVisibleCurves({
        score: true,
        scoreConfidence: false,
        up1h: true,
        up15m: false,
        fair15m: true,
        up5m: false,
        signals: true,
        kevScore: false,
        spanScore: false,
      });
      setSignals(DEFAULT_SIGNAL_CONFIG);
      setDateFilter("ALL");
      setStartHour(null);
      setEndHour(null);
      setActiveIntervalPreset("ALL");
      setDirFilter("ALL");
      setSaveStatus("تمام تنظیمات به حالت اولیه بازنشانی شد");
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  // Chart hover state
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const loadHistory = useCallback(async (coinToLoad = selectedCoin) => {
    setLoading(true);
    setError(null);
    try {
      const url =
        coinToLoad && coinToLoad !== "all"
          ? `/api/jev/history?coin=${coinToLoad}`
          : "/api/jev/history";
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (json.files) {
        setData(json.files);
      } else {
        throw new Error(json.error || "خطا در بارگذاری اطلاعات");
      }
    } catch (err: any) {
      setError(err.message || "خطا در ارتباط با سرور");
    } finally {
      setLoading(false);
    }
  }, [selectedCoin]);

  useEffect(() => {
    loadHistory(selectedCoin);
  }, [selectedCoin, loadHistory]);

  const viewFile = async (filename: string) => {
    setSelectedFileForModal(filename);
    setFileLoading(true);
    try {
      const res = await fetch(`/api/jev/history?file=${filename}`);
      const text = await res.text();
      setFileContent(text);
    } catch {
      setFileContent("خطا در بارگذاری محتوا");
    } finally {
      setFileLoading(false);
    }
  };

  const toggleColumn = (id: string) => {
    setSelectedColIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter((c) => c !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  // Extract unique dates present in records
  const availableDates = useMemo(() => {
    const dates = new Set<string>();
    data.forEach((r) => {
      if (r.et_time) {
        const parts = r.et_time.split(" ");
        if (parts[0] && parts[0].length === 10) {
          dates.add(parts[0]);
        }
      }
    });
    return Array.from(dates).sort().reverse();
  }, [data]);

  // Set interval preset helper
  const applyIntervalPreset = (preset: string) => {
    setActiveIntervalPreset(preset);
    if (preset === "ALL") {
      setStartHour(null);
      setEndHour(null);
    } else if (preset === "13_14") {
      // 1PM to 2PM (13:00 - 14:00)
      setStartHour(13);
      setEndHour(14);
    } else if (preset === "14_15") {
      // 2PM to 3PM (14:00 - 15:00)
      setStartHour(14);
      setEndHour(15);
    } else if (preset === "15_16") {
      // 3PM to 4PM (15:00 - 16:00)
      setStartHour(15);
      setEndHour(16);
    } else if (preset === "01_02") {
      // 1AM to 2AM (01:00 - 02:00)
      setStartHour(1);
      setEndHour(2);
    } else if (preset === "23_24") {
      // 11PM to 12AM (23:00 - 24:00)
      setStartHour(23);
      setEndHour(24);
    }
  };

  // Filtered dataset (applied across table and chart!)
  const filteredData = useMemo(() => {
    return data.filter((row) => {
      // Date filter
      if (dateFilter !== "ALL") {
        if (!row.et_time.startsWith(dateFilter)) return false;
      }

      // Hour interval filter
      if (startHour != null && endHour != null) {
        try {
          const timePart = row.et_time.split(" ")[1];
          if (timePart) {
            const h = parseInt(timePart.split(":")[0], 10);
            if (h < startHour || h >= endHour) return false;
          }
        } catch {
          return false;
        }
      }

      // Direction filter
      if (dirFilter === "UP" && row.direction !== "UP") return false;
      if (dirFilter === "DOWN" && row.direction !== "DOWN") return false;

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTime = row.et_time?.toLowerCase().includes(q);
        const matchFile = row.filename?.toLowerCase().includes(q);
        const matchScore = row.score?.toString().includes(q);
        if (!matchTime && !matchFile && !matchScore) return false;
      }

      return true;
    });
  }, [data, dateFilter, startHour, endHour, dirFilter, searchQuery]);

  // Chronological data for charting (oldest to newest)
  const chartData = useMemo(() => {
    return [...filteredData].reverse();
  }, [filteredData]);

  // Summary KPIs for current view
  const stats = useMemo(() => {
    const total = filteredData.length;
    const withScore = filteredData.filter((d) => d.score != null);
    const avgScore =
      withScore.length > 0
        ? withScore.reduce((acc, cur) => acc + (cur.score || 0), 0) / withScore.length
        : 0;
    const upCount = filteredData.filter((d) => d.direction === "UP").length;
    const downCount = filteredData.filter((d) => d.direction === "DOWN").length;
    const upPct = total > 0 ? ((upCount / total) * 100).toFixed(0) : "0";
    const downPct = total > 0 ? ((downCount / total) * 100).toFixed(0) : "0";

    return { total, avgScore: avgScore.toFixed(2), upCount, downCount, upPct, downPct };
  }, [filteredData]);

  // Export CSV
  const exportCsv = () => {
    const activeCols = ALL_COLUMNS.filter((c) => selectedColIds.includes(c.id));
    const headers = ["زمان (ET)", "نام فایل", ...activeCols.map((c) => c.label)];
    const rows = filteredData.map((r) => [
      `"${r.et_time || ""}"`,
      `"${r.filename}"`,
      ...activeCols.map((c) => `"${c.exportVal(r, signals)}"`),
    ]);
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `jev_analysis_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeColumns = useMemo(
    () => ALL_COLUMNS.filter((c) => selectedColIds.includes(c.id)),
    [selectedColIds]
  );

  // SVG Chart Geometry
  const chartWidth = 920;
  const chartHeight = 280;
  const padding = { top: 25, right: 45, bottom: 35, left: 45 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  // Chart coordinates calculation
  const curveCoordinates = useMemo(() => {
    if (chartData.length < 2) return null;

    const n = chartData.length;
    const getX = (i: number) => padding.left + (i / (n - 1)) * plotWidth;

    // Y values:
    // Right Axis: 0% to 100% -> y: padding.top + plotHeight - (val / 100) * plotHeight
    // Left Axis: Score 0 to 4 -> y: padding.top + plotHeight - (score / 4) * plotHeight
    const getYPct = (pct: number) =>
      padding.top + plotHeight - (Math.max(0, Math.min(100, pct)) / 100) * plotHeight;
    const getYScore = (sc: number) =>
      padding.top + plotHeight - (Math.max(0, Math.min(4, sc)) / 4) * plotHeight;

    const scorePoints: { x: number; y: number }[] = [];
    const kevScorePoints: { x: number; y: number }[] = [];
    const spanScorePoints: { x: number; y: number }[] = [];
    const scoreConfidencePoints: { x: number; y: number }[] = [];
    const up1hPoints: { x: number; y: number }[] = [];
    const up15mPoints: { x: number; y: number }[] = [];
    const fair15mPoints: { x: number; y: number }[] = [];
    const up5mPoints: { x: number; y: number }[] = [];

    const signalMarkers: {
      index: number;
      x: number;
      y: number;
      signal: SignalMatch;
      item: JevFileRecord;
    }[] = [];

    chartData.forEach((d, i) => {
      const x = getX(i);
      if (d.score != null) {
        scorePoints.push({ x, y: getYScore(d.score) });
      }
      if (d.kev_score != null) {
        kevScorePoints.push({ x, y: getYScore(d.kev_score) });
      }
      if (d.span_score != null) {
        spanScorePoints.push({ x, y: getYScore(d.span_score) });
      }

      const sig = evaluateSignal(d, signals);
      if (sig) {
        signalMarkers.push({
          index: i,
          x,
          y: getYScore(sig.score),
          signal: sig,
          item: d,
        });
      }

      if (d.score_confidence != null) scoreConfidencePoints.push({ x, y: getYPct(d.score_confidence) });
      if (d.up_1h_num != null) up1hPoints.push({ x, y: getYPct(d.up_1h_num) });
      if (d.up_15m_num != null) up15mPoints.push({ x, y: getYPct(d.up_15m_num) });
      if (d.fair_15m != null) fair15mPoints.push({ x, y: getYPct(d.fair_15m) });
      if (d.up_5m_num != null) up5mPoints.push({ x, y: getYPct(d.up_5m_num) });
    });

    return {
      scorePath: generateSmoothCurve(scorePoints),
      scorePoints,
      kevScorePath: generateSmoothCurve(kevScorePoints),
      kevScorePoints,
      spanScorePath: generateSmoothCurve(spanScorePoints),
      spanScorePoints,
      scoreConfidencePath: generateSmoothCurve(scoreConfidencePoints),
      scoreConfidencePoints,
      up1hPath: generateSmoothCurve(up1hPoints),
      up1hPoints,
      up15mPath: generateSmoothCurve(up15mPoints),
      up15mPoints,
      fair15mPath: generateSmoothCurve(fair15mPoints),
      fair15mPoints,
      up5mPath: generateSmoothCurve(up5mPoints),
      up5mPoints,
      signalMarkers,
      getX,
      bottomY: padding.top + plotHeight,
    };
  }, [chartData, plotWidth, plotHeight, padding.left, padding.top, signals]);

  const bullishMatches = useMemo(
    () => curveCoordinates?.signalMarkers.filter((m) => m.signal.type === "BULLISH") || [],
    [curveCoordinates]
  );
  const bearishMatches = useMemo(
    () => curveCoordinates?.signalMarkers.filter((m) => m.signal.type === "BEARISH") || [],
    [curveCoordinates]
  );

  // Handle Chart mouse move
  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || chartData.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const relX = (mouseX / rect.width) * chartWidth;

    const clampedX = Math.max(padding.left, Math.min(padding.left + plotWidth, relX));
    const ratio = (clampedX - padding.left) / plotWidth;
    const idx = Math.round(ratio * (chartData.length - 1));
    setHoverIndex(idx);
  };

  const handleSvgMouseLeave = () => {
    setHoverIndex(null);
  };

  const hoveredItem = hoverIndex != null && chartData[hoverIndex] ? chartData[hoverIndex] : null;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/updown"
              className="inline-flex items-center gap-1 text-xs text-[#8b91c5] hover:text-[#38bdf8] transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5 rotate-180" />
              بازگشت به صفحه Up/Down
            </Link>
            <span className="text-xs text-[#5d628f]">/</span>
            <span className="text-xs text-[#38bdf8] font-medium">Jev JSON Analyzer</span>
          </div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <BarChart3 className="w-6 h-6 text-[#38bdf8]" />
            داشبورد آنالیز، فیلتر بازه زمانی و رسم منحنی Jev
          </h1>
          <p className="text-xs text-[#8b91c5] mt-1">
            رسم منحنی‌های زمانی مقادیر در بازه‌های دلخواه (مثلاً ساعت ۱ تا ۲) و مقایسه داده‌ها
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Save / Reset Buttons */}
          <button
            onClick={saveCurrentSettingsNow}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 text-xs text-[#38bdf8] border border-[#38bdf8]/30 transition-all font-medium"
            title="ذخیره تنظیمات فعلی، ستون‌ها، بازه‌ها و شروط سیگنال در مرورگر"
          >
            <Save className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">ذخیره تنظیمات</span>
          </button>

          <button
            onClick={resetAllSettingsToDefault}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs text-[#8b91c5] hover:text-[#ff6b9d] border border-white/[0.08] transition-all"
            title="بازنشانی تمام فیلترها، ستون‌ها و شروط به حالت اولیه"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">بازنشانی</span>
          </button>

          <button
            onClick={exportCsv}
            disabled={filteredData.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs text-[#c3c8ee] border border-white/[0.08] transition-all disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-[#38bdf8]" />
            دانلود خروجی CSV ({filteredData.length})
          </button>

          <button
            onClick={() => loadHistory(selectedCoin)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-[#6366f1] to-[#38bdf8] text-white text-xs font-medium hover:opacity-90 transition-opacity shadow-md disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            تازه‌سازی
          </button>
        </div>
      </div>

      {/* Floating Save Status Toast */}
      {saveStatus && (
        <div className="fixed bottom-6 left-6 z-50 bg-[#0d0f22]/95 border border-[#2ce5a7]/50 text-[#2ce5a7] px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-md text-xs flex items-center gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-[#2ce5a7]" />
          <span className="font-medium">{saveStatus}</span>
        </div>
      )}

      {/* COIN SELECTOR BAR (انتخاب و فیلتر ارزها) */}
      <div className="bg-[#0d0f22]/90 border border-[rgba(140,130,255,0.18)] p-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[#8b91c5] px-2 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#ffc94d]" />
            انتخاب ارز:
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {AVAILABLE_COINS.map((c) => {
              const isActive = selectedCoin === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => setSelectedCoin(c.key)}
                  className={`text-xs px-3 py-1.5 rounded-xl font-medium transition-all flex items-center gap-1.5 border ${
                    isActive
                      ? "bg-[#38bdf8]/20 border-[#38bdf8] text-white shadow-sm font-bold"
                      : "bg-white/[0.04] border-white/[0.08] text-[#8b91c5] hover:text-white hover:bg-white/[0.08]"
                  }`}
                >
                  {c.color && (
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                  )}
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="text-xs text-[#5d628f] mr-auto pl-2">
          {selectedCoin === "all" ? "نمایش تمام پیش‌بینی‌های ثبت‌شده" : `نمایش تحلیل‌های اختصاصی ${selectedCoin.toUpperCase()}`}
        </div>
      </div>

      {/* TIME RANGE FILTER CONTROLS (ساعت ۱ تا ۲ و بازه‌های دلخواه) */}
      <div className="bg-[#0d0f22]/90 border border-[#38bdf8]/30 rounded-2xl p-5 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#38bdf8]" />
            <span className="text-sm font-bold text-white">
              انتخاب بازه زمانی جهت رسم منحنی و فیلتر جدول (Time Window):
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#38bdf8]/15 text-[#38bdf8] font-bold">
              {filteredData.length} اسنپ‌شات در بازه انتخابی
            </span>
          </div>

          {/* Quick presets (ساعت ۱ تا ۲ و ...) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[#8b91c5] ml-1">بازه‌های سریع:</span>
            {[
              { id: "ALL", label: "کل داده‌ها" },
              { id: "13_14", label: "ساعت ۱ تا ۲ ظهر (13:00-14:00)" },
              { id: "14_15", label: "ساعت ۲ تا ۳ عصر (14:00-15:00)" },
              { id: "15_16", label: "ساعت ۳ تا ۴ عصر (15:00-16:00)" },
              { id: "23_24", label: "ساعت ۱۱ تا ۱۲ شب (23:00-24:00)" },
              { id: "01_02", label: "ساعت ۱ تا ۲ بامداد (01:00-02:00)" },
            ].map((preset) => (
              <button
                key={preset.id}
                onClick={() => applyIntervalPreset(preset.id)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                  activeIntervalPreset === preset.id
                    ? "bg-[#38bdf8]/20 border-[#38bdf8] text-[#38bdf8] font-semibold"
                    : "bg-white/[0.04] border-white/[0.08] text-[#8b91c5] hover:text-white hover:bg-white/[0.08]"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date & Custom Hour Pickers */}
        <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-3 text-xs">
          {/* Date Selector */}
          <div className="flex items-center gap-2 bg-white/[0.03] p-2.5 rounded-xl border border-white/[0.07]">
            <Calendar className="w-3.5 h-3.5 text-[#38bdf8]" />
            <span className="text-[#8b91c5]">تاریخ:</span>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-[#05060d] text-white border border-white/[0.15] rounded px-2 py-1 flex-1 focus:outline-none focus:border-[#38bdf8]"
            >
              <option value="ALL">تمام روزها ({availableDates.length} روز)</option>
              {availableDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Start Hour */}
          <div className="flex items-center gap-2 bg-white/[0.03] p-2.5 rounded-xl border border-white/[0.07]">
            <Clock className="w-3.5 h-3.5 text-[#2ce5a7]" />
            <span className="text-[#8b91c5]">از ساعت:</span>
            <select
              value={startHour ?? ""}
              onChange={(e) => {
                const val = e.target.value === "" ? null : parseInt(e.target.value, 10);
                setStartHour(val);
                setActiveIntervalPreset("custom");
              }}
              className="bg-[#05060d] text-white border border-white/[0.15] rounded px-2 py-1 flex-1 focus:outline-none focus:border-[#2ce5a7]"
            >
              <option value="">شروع (00:00)</option>
              {Array.from({ length: 24 }).map((_, i) => (
                <option key={i} value={i}>
                  {i.toString().padStart(2, "0")}:00 ({i === 13 ? "1 PM" : i === 1 ? "1 AM" : `${i}:00`})
                </option>
              ))}
            </select>
          </div>

          {/* End Hour */}
          <div className="flex items-center gap-2 bg-white/[0.03] p-2.5 rounded-xl border border-white/[0.07]">
            <Clock className="w-3.5 h-3.5 text-[#ff6b9d]" />
            <span className="text-[#8b91c5]">تا ساعت:</span>
            <select
              value={endHour ?? ""}
              onChange={(e) => {
                const val = e.target.value === "" ? null : parseInt(e.target.value, 10);
                setEndHour(val);
                setActiveIntervalPreset("custom");
              }}
              className="bg-[#05060d] text-white border border-white/[0.15] rounded px-2 py-1 flex-1 focus:outline-none focus:border-[#ff6b9d]"
            >
              <option value="">پایان (24:00)</option>
              {Array.from({ length: 24 }).map((_, i) => (
                <option key={i + 1} value={i + 1}>
                  {(i + 1).toString().padStart(2, "0")}:00 ({i + 1 === 14 ? "2 PM" : i + 1 === 2 ? "2 AM" : `${i + 1}:00`})
                </option>
              ))}
            </select>
          </div>

          {/* Reset Filters */}
          <div className="flex items-center">
            <button
              onClick={() => {
                setDateFilter("ALL");
                applyIntervalPreset("ALL");
              }}
              className="w-full text-center py-2 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-[#8b91c5] hover:text-white border border-white/[0.08] transition-colors"
            >
              بازنشانی بازه زمانی (کل داده‌ها)
            </button>
          </div>
        </div>
      </div>

      {/* INTERACTIVE CURVE CHART COMPONENT (رسم منحنی مقادیر) */}
      <div className="bg-[#090b1a] border border-[rgba(140,130,255,0.2)] rounded-2xl p-5 space-y-4 shadow-2xl relative">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#ffc94d]" />
              منحنی تغییرات مقادیر در بازه انتخابی (Interactive Value Curves)
            </h2>
            <p className="text-[11px] text-[#8b91c5] mt-0.5">
              نمایش همزمان و تطبیق منحنی اسکور Jev، درصدهای بازار و Fair Value با حرکت موس روی نمودار
            </p>
          </div>

          {/* Curve Toggles */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[#8b91c5] text-[11px]">منحنی‌های فعال:</span>

            {/* Signal Ticks Toggle Button */}
            <button
              onClick={() => setVisibleCurves((p) => ({ ...p, signals: !p.signals }))}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                visibleCurves.signals
                  ? "bg-gradient-to-r from-[#38bdf8]/20 via-[#2ce5a7]/15 to-[#ef4444]/20 border-[#38bdf8] text-white font-bold shadow-sm"
                  : "bg-white/[0.03] border-white/[0.1] text-[#5d628f] opacity-60"
              }`}
              title="نمایش تیک‌های شرطی آبی و قرمز روی نقاط منحنی"
            >
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#38bdf8] shadow-[0_0_6px_#38bdf8]" />
                <span className="w-2 h-2 rounded-full bg-[#ef4444] shadow-[0_0_6px_#ef4444]" />
              </div>
              <span>تیک‌های سیگنال</span>
              <span className="text-[10px] font-mono opacity-85 px-1.5 py-0.2 rounded bg-black/40">
                {bullishMatches.length} آبی / {bearishMatches.length} قرمز
              </span>
            </button>

            {/* Signal Settings Accordion Toggle */}
            <button
              onClick={() => setShowSignalSettings((p) => !p)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                showSignalSettings
                  ? "bg-[#38bdf8]/20 border-[#38bdf8] text-[#38bdf8] font-bold"
                  : "bg-white/[0.04] border-white/[0.1] text-[#8b91c5] hover:text-white"
              }`}
              title="تنظیم شروط مقادیر اسکور و درصد اطمینان برای تیک‌های آبی و قرمز"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>تنظیم شروط تیک‌ها</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showSignalSettings ? "rotate-180" : ""}`} />
            </button>

            <button
              onClick={() => setVisibleCurves((p) => ({ ...p, score: !p.score }))}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                visibleCurves.score
                  ? "bg-[#c084fc]/20 border-[#c084fc] text-[#c084fc] font-bold"
                  : "bg-white/[0.03] border-white/[0.1] text-[#5d628f] opacity-60"
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#c084fc]" />
              اسکور Jev (0-4)
            </button>

            <button
              onClick={() => setVisibleCurves((p) => ({ ...p, kevScore: !p.kevScore }))}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                visibleCurves.kevScore
                  ? "bg-[#38bdf8]/20 border-[#38bdf8] text-[#38bdf8] font-bold"
                  : "bg-white/[0.03] border-white/[0.1] text-[#5d628f] opacity-60"
              }`}
              title="نمایش منحنی اسکور مدل Kev-4b (۰ تا ۴)"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#38bdf8]" />
              اسکور Kev-4b (0-4)
            </button>

            <button
              onClick={() => setVisibleCurves((p) => ({ ...p, spanScore: !p.spanScore }))}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                visibleCurves.spanScore
                  ? "bg-[#e879f9]/20 border-[#e879f9] text-[#e879f9] font-bold"
                  : "bg-white/[0.03] border-white/[0.1] text-[#5d628f] opacity-60"
              }`}
              title="نمایش منحنی اسکور مدل Span-01 (۰ تا ۴)"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#e879f9]" />
              اسکور Span-01 (0-4)
            </button>

            <button
              onClick={() => setVisibleCurves((p) => ({ ...p, scoreConfidence: !p.scoreConfidence }))}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                visibleCurves.scoreConfidence
                  ? "bg-[#eab308]/20 border-[#eab308] text-[#eab308] font-bold"
                  : "bg-white/[0.03] border-white/[0.1] text-[#5d628f] opacity-60"
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#eab308]" />
              اطمینان اسکور Jev (%)
            </button>

            <button
              onClick={() => setVisibleCurves((p) => ({ ...p, up1h: !p.up1h }))}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                visibleCurves.up1h
                  ? "bg-[#2ce5a7]/20 border-[#2ce5a7] text-[#2ce5a7] font-bold"
                  : "bg-white/[0.03] border-white/[0.1] text-[#5d628f] opacity-60"
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#2ce5a7]" />
              1H Up % بازار
            </button>

            <button
              onClick={() => setVisibleCurves((p) => ({ ...p, up15m: !p.up15m }))}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                visibleCurves.up15m
                  ? "bg-[#38bdf8]/20 border-[#38bdf8] text-[#38bdf8] font-bold"
                  : "bg-white/[0.03] border-white/[0.1] text-[#5d628f] opacity-60"
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#38bdf8]" />
              15M Up % بازار
            </button>

            <button
              onClick={() => setVisibleCurves((p) => ({ ...p, fair15m: !p.fair15m }))}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                visibleCurves.fair15m
                  ? "bg-[#f59e0b]/20 border-[#f59e0b] text-[#f59e0b] font-bold"
                  : "bg-white/[0.03] border-white/[0.1] text-[#5d628f] opacity-60"
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" />
              Fair Value 15m
            </button>

            <button
              onClick={() => setVisibleCurves((p) => ({ ...p, up5m: !p.up5m }))}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                visibleCurves.up5m
                  ? "bg-[#f472b6]/20 border-[#f472b6] text-[#f472b6] font-bold"
                  : "bg-white/[0.03] border-white/[0.1] text-[#5d628f] opacity-60"
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#f472b6]" />
              5M Up % بازار
            </button>
          </div>
        </div>

        {/* CONDITIONAL SIGNAL MARKERS CONFIGURATION PANEL */}
        {showSignalSettings && (
          <div className="bg-[#05060d]/90 border border-[#38bdf8]/30 rounded-xl p-4 space-y-3.5 text-xs animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#38bdf8]" />
                <span className="font-bold text-white text-sm">
                  تعریف شروط تیک‌های روی منحنی (Conditional Signal Markers):
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[#c3c8ee] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={signals.enabled}
                    onChange={(e) => setSignals((p) => ({ ...p, enabled: e.target.checked }))}
                    className="accent-[#38bdf8] rounded"
                  />
                  <span>فعال‌سازی سیستم تیک‌های شرطی</span>
                </label>
                <button
                  onClick={() => setSignals(DEFAULT_SIGNAL_CONFIG)}
                  className="text-[11px] px-2.5 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-[#8b91c5] hover:text-white transition-colors"
                >
                  بازنشانی شروط
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Bullish Condition (Blue Tick) */}
              <div className="bg-[#090b1a] p-3 rounded-xl border border-[#38bdf8]/30 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-[#38bdf8]">
                    <span className="w-3.5 h-3.5 rounded-full bg-[#38bdf8] flex items-center justify-center text-[10px] text-black font-black">✓</span>
                    <span>شرط تیک آبی (صعودی / Bullish):</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#38bdf8]/15 text-[#38bdf8] font-bold">
                    {bullishMatches.length} مورد فعال
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <label className="text-[#8b91c5] block mb-1">حداقل اسکور (0 - 4):</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="4"
                      value={signals.bullishScore}
                      onChange={(e) =>
                        setSignals((p) => ({
                          ...p,
                          bullishScore: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="w-full bg-[#05060d] text-white border border-[#38bdf8]/40 rounded-lg px-2.5 py-1 font-mono font-bold focus:outline-none focus:border-[#38bdf8]"
                    />
                  </div>
                  <div>
                    <label className="text-[#8b91c5] block mb-1">حداقل اطمینان (%):</label>
                    <input
                      type="number"
                      step="5"
                      min="0"
                      max="100"
                      value={signals.bullishMinConf}
                      onChange={(e) =>
                        setSignals((p) => ({
                          ...p,
                          bullishMinConf: parseInt(e.target.value, 10) || 0,
                        }))
                      }
                      className="w-full bg-[#05060d] text-white border border-[#38bdf8]/40 rounded-lg px-2.5 py-1 font-mono font-bold focus:outline-none focus:border-[#38bdf8]"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-[#38bdf8]">
                  قانون تیک آبی: اسکور بالای {signals.bullishScore} و همزمان اطمینان اسکور حداقل {signals.bullishMinConf}%
                </p>
              </div>

              {/* Bearish Condition (Red Tick) */}
              <div className="bg-[#090b1a] p-3 rounded-xl border border-[#ef4444]/30 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-[#ef4444]">
                    <span className="w-3.5 h-3.5 rounded-full bg-[#ef4444] flex items-center justify-center text-[10px] text-white font-black">✓</span>
                    <span>شرط تیک قرمز (نزولی / Bearish):</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#ef4444]/15 text-[#ef4444] font-bold">
                    {bearishMatches.length} مورد فعال
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <label className="text-[#8b91c5] block mb-1">حداکثر اسکور (0 - 4):</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="4"
                      value={signals.bearishScore}
                      onChange={(e) =>
                        setSignals((p) => ({
                          ...p,
                          bearishScore: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="w-full bg-[#05060d] text-white border border-[#ef4444]/40 rounded-lg px-2.5 py-1 font-mono font-bold focus:outline-none focus:border-[#ef4444]"
                    />
                  </div>
                  <div>
                    <label className="text-[#8b91c5] block mb-1">حداقل اطمینان (%):</label>
                    <input
                      type="number"
                      step="5"
                      min="0"
                      max="100"
                      value={signals.bearishMinConf}
                      onChange={(e) =>
                        setSignals((p) => ({
                          ...p,
                          bearishMinConf: parseInt(e.target.value, 10) || 0,
                        }))
                      }
                      className="w-full bg-[#05060d] text-white border border-[#ef4444]/40 rounded-lg px-2.5 py-1 font-mono font-bold focus:outline-none focus:border-[#ef4444]"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-[#ef4444]">
                  قانون تیک قرمز: اسکور کمتر از {signals.bearishScore} و همزمان اطمینان اسکور حداقل {signals.bearishMinConf}%
                </p>
              </div>

              {/* Model Source & Confidence Settings */}
              <div className="bg-[#090b1a] p-3 rounded-xl border border-white/[0.1] space-y-2 flex flex-col justify-between">
                <div className="space-y-2">
                  <div>
                    <label className="text-[#8b91c5] block mb-1 font-medium">مدل هوش‌مصنوعی مبنای سیگنال:</label>
                    <select
                      value={signals.modelSource || "jev"}
                      onChange={(e) =>
                        setSignals((p) => ({
                          ...p,
                          modelSource: e.target.value as "jev" | "kev" | "span" | "consensus",
                        }))
                      }
                      className="w-full bg-[#05060d] text-white border border-white/[0.15] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#38bdf8]"
                    >
                      <option value="jev">مدل Jev (انحصاری Jev - پیش‌فرض)</option>
                      <option value="kev">مدل Kev-4b (اسکور ۰ تا ۴)</option>
                      <option value="span">مدل Span-01 (اسکور ۰ تا ۴)</option>
                      <option value="consensus">اجماع هر ۳ مدل (میانگین اسکور)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[#8b91c5] block mb-1 font-medium">مبنای سنجش درصد اطمینان:</label>
                    <select
                      value={signals.confidenceType}
                      onChange={(e) =>
                        setSignals((p) => ({
                          ...p,
                          confidenceType: e.target.value as "score" | "direction" | "any",
                        }))
                      }
                      className="w-full bg-[#05060d] text-white border border-white/[0.15] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#38bdf8]"
                    >
                      <option value="score">فقط درصد اطمینان اسکور (Score Confidence - قانون اصلی)</option>
                      <option value="direction">فقط درصد اطمینان جهت (Direction Confidence)</option>
                    </select>
                  </div>
                </div>
                <div className="text-[11px] text-[#8b91c5] bg-white/[0.03] p-2 rounded-lg border border-white/[0.05]">
                  💡 تیک‌ها به همراه خط چین راهنما مستقیماً در صورت برقراری همزمان هر دو شرط اسکور و اطمینان اسکور رسم می‌شوند.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* The SVG Smooth Curve Canvas */}
        {chartData.length < 2 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-[#8b91c5] bg-white/[0.02] rounded-xl border border-dashed border-white/[0.08]">
            <Clock className="w-8 h-8 text-[#5d628f] mb-2" />
            <p className="text-xs font-semibold text-white">برای این بازه داده کافی برای رسم منحنی وجود ندارد</p>
            <p className="text-[11px] text-[#5d628f] mt-1">
              لطفاً بازه زمانی را وسیع‌تر انتخاب کنید (مثلاً تمام ساعات یا ساعت‌های دیگر که داده ثبت شده است).
            </p>
          </div>
        ) : (
          <div className="relative overflow-hidden select-none">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full h-auto cursor-crosshair overflow-visible"
              onMouseMove={handleSvgMouseMove}
              onMouseLeave={handleSvgMouseLeave}
            >
              <defs>
                {/* Gradients for Curve Glow & Area */}
                <linearGradient id="scoreGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c084fc" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#c084fc" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="up1hGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2ce5a7" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#2ce5a7" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="fairGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              {[0, 25, 50, 75, 100].map((pct) => {
                const y = padding.top + plotHeight - (pct / 100) * plotHeight;
                const scoreEquiv = ((pct / 100) * 4).toFixed(1);
                return (
                  <g key={pct}>
                    <line
                      x1={padding.left}
                      y1={y}
                      x2={padding.left + plotWidth}
                      y2={y}
                      stroke="rgba(255, 255, 255, 0.07)"
                      strokeDasharray="4 4"
                    />
                    {/* Left Axis: Jev Score */}
                    <text
                      x={padding.left - 8}
                      y={y + 3}
                      fill="#a5b4fc"
                      fontSize="9"
                      textAnchor="end"
                      fontFamily="monospace"
                    >
                      {scoreEquiv}
                    </text>
                    {/* Right Axis: Percentage */}
                    <text
                      x={padding.left + plotWidth + 8}
                      y={y + 3}
                      fill="#8b91c5"
                      fontSize="9"
                      textAnchor="start"
                      fontFamily="monospace"
                    >
                      {pct}%
                    </text>
                  </g>
                );
              })}

              {/* Horizontal Center Baseline (Score 2.0 / 50%) */}
              <line
                x1={padding.left}
                y1={padding.top + plotHeight / 2}
                x2={padding.left + plotWidth}
                y2={padding.top + plotHeight / 2}
                stroke="rgba(140, 130, 255, 0.25)"
                strokeWidth="1.2"
              />

              {/* CURVE: Fair Value 15m */}
              {visibleCurves.fair15m && curveCoordinates?.fair15mPath && (
                <path
                  d={curveCoordinates.fair15mPath}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="2"
                  strokeDasharray="3 3"
                  className="transition-all duration-300"
                />
              )}

              {/* CURVE: 15M Up % */}
              {visibleCurves.up15m && curveCoordinates?.up15mPath && (
                <path
                  d={curveCoordinates.up15mPath}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.8"
                  className="transition-all duration-300"
                />
              )}

              {/* CURVE: 5M Up % */}
              {visibleCurves.up5m && curveCoordinates?.up5mPath && (
                <path
                  d={curveCoordinates.up5mPath}
                  fill="none"
                  stroke="#f472b6"
                  strokeWidth="1.5"
                  className="transition-all duration-300"
                />
              )}

              {/* CURVE: 1H Up % */}
              {visibleCurves.up1h && curveCoordinates?.up1hPath && (
                <g>
                  {/* Glowing Area under 1h Up */}
                  <path
                    d={`${curveCoordinates.up1hPath} L ${curveCoordinates.up1hPoints[curveCoordinates.up1hPoints.length - 1]?.x} ${curveCoordinates.bottomY} L ${curveCoordinates.up1hPoints[0]?.x} ${curveCoordinates.bottomY} Z`}
                    fill="url(#up1hGlow)"
                  />
                  <path
                    d={curveCoordinates.up1hPath}
                    fill="none"
                    stroke="#2ce5a7"
                    strokeWidth="2.5"
                    className="transition-all duration-300"
                  />
                </g>
              )}

              {/* CURVE: Jev Score Confidence % */}
              {visibleCurves.scoreConfidence && curveCoordinates?.scoreConfidencePath && (
                <path
                  d={curveCoordinates.scoreConfidencePath}
                  fill="none"
                  stroke="#eab308"
                  strokeWidth="2.2"
                  strokeDasharray="4 2"
                  className="transition-all duration-300"
                />
              )}

              {/* CURVE: Jev Score (0-4) */}
              {visibleCurves.score && curveCoordinates?.scorePath && (
                <g>
                  {/* Glowing Area under Score */}
                  <path
                    d={`${curveCoordinates.scorePath} L ${curveCoordinates.scorePoints[curveCoordinates.scorePoints.length - 1]?.x} ${curveCoordinates.bottomY} L ${curveCoordinates.scorePoints[0]?.x} ${curveCoordinates.bottomY} Z`}
                    fill="url(#scoreGlow)"
                  />
                  <path
                    d={curveCoordinates.scorePath}
                    fill="none"
                    stroke="#c084fc"
                    strokeWidth="3"
                    className="transition-all duration-300"
                  />
                </g>
              )}

              {/* CURVE: Kev-4b Score (0-4) */}
              {visibleCurves.kevScore && curveCoordinates?.kevScorePath && (
                <path
                  d={curveCoordinates.kevScorePath}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2.5"
                  strokeDasharray="4 2"
                  className="transition-all duration-300"
                />
              )}

              {/* CURVE: Span-01 Score (0-4) */}
              {visibleCurves.spanScore && curveCoordinates?.spanScorePath && (
                <path
                  d={curveCoordinates.spanScorePath}
                  fill="none"
                  stroke="#e879f9"
                  strokeWidth="2.5"
                  strokeDasharray="2 2"
                  className="transition-all duration-300"
                />
              )}

              {/* CONDITIONAL SIGNAL MARKER PINS ON THE CURVE */}
              {visibleCurves.signals &&
                curveCoordinates?.signalMarkers.map((marker) => {
                  const isHovered = hoverIndex === marker.index;
                  const isBull = marker.signal.type === "BULLISH";
                  // Pin position: 24px above the score point, clamped within canvas
                  const pinY = Math.max(padding.top + 16, marker.y - 24);
                  const stemBottom = marker.y - 4;

                  return (
                    <g
                      key={`sig-${marker.index}`}
                      className="cursor-pointer transition-all duration-200"
                      onMouseEnter={() => setHoverIndex(marker.index)}
                    >
                      {/* Vertical connecting dashed line to curve point */}
                      <line
                        x1={marker.x}
                        y1={pinY + 8}
                        x2={marker.x}
                        y2={stemBottom}
                        stroke={marker.signal.color}
                        strokeWidth={isHovered ? "2" : "1.2"}
                        strokeDasharray="2 2"
                        opacity={isHovered ? "1" : "0.75"}
                      />

                      {/* Pulsing glow halo */}
                      <circle
                        cx={marker.x}
                        cy={pinY}
                        r={isHovered ? 13 : 9.5}
                        fill={marker.signal.color}
                        opacity={isHovered ? "0.35" : "0.2"}
                        className="animate-pulse"
                      />

                      {/* Pin background circle */}
                      <circle
                        cx={marker.x}
                        cy={pinY}
                        r={isHovered ? 9.5 : 8}
                        fill="#05060d"
                        stroke={marker.signal.color}
                        strokeWidth={isHovered ? "2.5" : "1.8"}
                      />

                      {/* Checkmark icon inside pin */}
                      <text
                        x={marker.x}
                        y={pinY + 3.5}
                        fill={marker.signal.color}
                        fontSize={isHovered ? "11" : "9.5"}
                        fontWeight="bold"
                        textAnchor="middle"
                        fontFamily="sans-serif"
                      >
                        ✓
                      </text>

                      {/* Floating tag on hover */}
                      {isHovered && (
                        <g>
                          <rect
                            x={marker.x - 36}
                            y={pinY - 22}
                            width="72"
                            height="16"
                            rx="8"
                            fill={marker.signal.color}
                            filter="drop-shadow(0 2px 4px rgba(0,0,0,0.6))"
                          />
                          <text
                            x={marker.x}
                            y={pinY - 11}
                            fill="#000"
                            fontSize="9"
                            fontWeight="bold"
                            textAnchor="middle"
                            fontFamily="sans-serif"
                          >
                            {isBull ? "تیک صعودی" : "تیک نزولی"}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

              {/* Data Point Dots on Curves */}
              {curveCoordinates &&
                chartData.map((pt, i) => {
                  const x = curveCoordinates.getX(i);
                  const isHovered = hoverIndex === i;
                  return (
                    <g key={i}>
                      {visibleCurves.score && pt.score != null && (
                        <circle
                          cx={x}
                          cy={padding.top + plotHeight - (pt.score / 4) * plotHeight}
                          r={isHovered ? 5 : 2.5}
                          fill={isHovered ? "#fff" : "#c084fc"}
                          stroke="#0B1120"
                          strokeWidth="1.5"
                        />
                      )}
                      {visibleCurves.kevScore && pt.kev_score != null && (
                        <circle
                          cx={x}
                          cy={padding.top + plotHeight - (pt.kev_score / 4) * plotHeight}
                          r={isHovered ? 5 : 2.5}
                          fill={isHovered ? "#fff" : "#38bdf8"}
                          stroke="#0B1120"
                          strokeWidth="1.5"
                        />
                      )}
                      {visibleCurves.spanScore && pt.span_score != null && (
                        <circle
                          cx={x}
                          cy={padding.top + plotHeight - (pt.span_score / 4) * plotHeight}
                          r={isHovered ? 5 : 2.5}
                          fill={isHovered ? "#fff" : "#e879f9"}
                          stroke="#0B1120"
                          strokeWidth="1.5"
                        />
                      )}
                      {visibleCurves.scoreConfidence && pt.score_confidence != null && (
                        <circle
                          cx={x}
                          cy={padding.top + plotHeight - (pt.score_confidence / 100) * plotHeight}
                          r={isHovered ? 5 : 2.5}
                          fill={isHovered ? "#fff" : "#eab308"}
                          stroke="#0B1120"
                          strokeWidth="1.5"
                        />
                      )}
                      {visibleCurves.up1h && pt.up_1h_num != null && (
                        <circle
                          cx={x}
                          cy={padding.top + plotHeight - (pt.up_1h_num / 100) * plotHeight}
                          r={isHovered ? 5 : 2.5}
                          fill={isHovered ? "#fff" : "#2ce5a7"}
                          stroke="#0B1120"
                          strokeWidth="1.5"
                        />
                      )}
                    </g>
                  );
                })}

              {/* Interactive Hover Crosshair Line */}
              {hoverIndex != null && curveCoordinates && (
                <line
                  x1={curveCoordinates.getX(hoverIndex)}
                  y1={padding.top}
                  x2={curveCoordinates.getX(hoverIndex)}
                  y2={padding.top + plotHeight}
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
              )}

              {/* X Axis Time Labels */}
              {curveCoordinates &&
                [0, Math.floor(chartData.length / 4), Math.floor(chartData.length / 2), Math.floor((chartData.length * 3) / 4), chartData.length - 1].map(
                  (idx) => {
                    const item = chartData[idx];
                    if (!item) return null;
                    const x = curveCoordinates.getX(idx);
                    const timeLabel = item.current_time_et || item.et_time.split(" ")[1] || item.et_time;
                    return (
                      <text
                        key={idx}
                        x={x}
                        y={padding.top + plotHeight + 20}
                        fill="#8b91c5"
                        fontSize="10"
                        textAnchor="middle"
                        fontFamily="monospace"
                      >
                        {timeLabel}
                      </text>
                    );
                  }
                )}
            </svg>

            {/* Hover Tooltip Card */}
            {hoveredItem && hoverIndex != null && curveCoordinates && (
              <div
                className="absolute top-2 pointer-events-none z-30 transition-all duration-100"
                style={{
                  left: `min(${Math.max(10, (curveCoordinates.getX(hoverIndex) / chartWidth) * 100)}%, calc(100% - 240px))`,
                }}
              >
                <div className="bg-[#05060d]/95 border border-[#38bdf8]/40 rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs space-y-1.5 min-w-[210px]">
                  <div className="flex items-center justify-between border-b border-white/[0.08] pb-1">
                    <span className="font-mono text-[#38bdf8] font-bold">
                      {hoveredItem.current_time_et || hoveredItem.et_time}
                    </span>
                    {hoveredItem.direction && (
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                          hoveredItem.direction === "UP" ? "bg-[#2ce5a7]/20 text-[#2ce5a7]" : "bg-[#ff6b9d]/20 text-[#ff6b9d]"
                        }`}
                      >
                        {hoveredItem.direction}
                      </span>
                    )}
                  </div>

                  {/* Signal Match Banner in Tooltip */}
                  {hoveredItem && (() => {
                    const sig = evaluateSignal(hoveredItem, signals);
                    if (!sig) return null;
                    return (
                      <div
                        className="px-2 py-1.5 rounded-lg border flex items-center justify-between gap-2 shadow-md animate-in fade-in"
                        style={{
                          backgroundColor: sig.bgColor,
                          borderColor: sig.borderColor,
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-black text-black"
                            style={{ backgroundColor: sig.color }}
                          >
                            ✓
                          </span>
                          <span className="font-bold text-[11px]" style={{ color: sig.color }}>
                            {sig.label}
                          </span>
                        </div>
                        <span className="text-[10px] opacity-85 font-mono text-[#c3c8ee]">
                          {sig.rule}
                        </span>
                      </div>
                    );
                  })()}

                  {hoveredItem.score != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#8b91c5]">اسکور Jev:</span>
                      <span className="font-mono text-[#c084fc] font-bold tabular-nums">
                        {hoveredItem.score.toFixed(2)} / 4.0
                      </span>
                    </div>
                  )}

                  {hoveredItem.score_confidence != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#8b91c5]">اطمینان اسکور:</span>
                      <span className="font-mono text-[#eab308] font-bold tabular-nums">
                        {hoveredItem.score_confidence}%
                      </span>
                    </div>
                  )}

                  {hoveredItem.kev_score != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#8b91c5]">اسکور Kev-4b:</span>
                      <span className="font-mono text-[#38bdf8] font-bold tabular-nums">
                        {hoveredItem.kev_score.toFixed(2)} / 4.0 {hoveredItem.kev_confidence != null ? `(${hoveredItem.kev_confidence}%)` : ""}
                      </span>
                    </div>
                  )}

                  {hoveredItem.span_score != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#8b91c5]">اسکور Span-01:</span>
                      <span className="font-mono text-[#e879f9] font-bold tabular-nums">
                        {hoveredItem.span_score.toFixed(2)} / 4.0 {hoveredItem.span_confidence != null ? `(${hoveredItem.span_confidence}%)` : ""}
                      </span>
                    </div>
                  )}

                  {hoveredItem.up_1h_num != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#8b91c5]">1H Up بازار:</span>
                      <span className="font-mono text-[#2ce5a7] font-bold tabular-nums">
                        {hoveredItem.up_1h_num}%
                      </span>
                    </div>
                  )}

                  {hoveredItem.up_15m_num != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#8b91c5]">15M Up بازار:</span>
                      <span className="font-mono text-[#38bdf8] font-medium tabular-nums">
                        {hoveredItem.up_15m_num}%
                      </span>
                    </div>
                  )}

                  {hoveredItem.fair_15m != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#8b91c5]">Fair Value 15m:</span>
                      <span className="font-mono text-[#f59e0b] font-medium tabular-nums">
                        {hoveredItem.fair_15m.toFixed(1)}¢
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between text-[11px] text-[#5d628f] pt-2 border-t border-white/[0.06]">
          <span>محور عمودی چپ: اسکور هوش‌مصنوعی (۰ تا ۴) · محور عمودی راست: درصد بازار (۰٪ تا ۱۰۰٪)</span>
          <span>تعداد نقاط متصل روی منحنی: {chartData.length} مقطع ۵ دقیقه‌ای</span>
        </div>
      </div>

      {/* Column & Metric Selector (User customizable view) */}
      <div className="bg-[#0d0f22]/90 border border-[rgba(140,130,255,0.18)] rounded-2xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-[#38bdf8]" />
            <span className="text-sm font-semibold text-white">
              انتخاب شاخص‌های جدول (مشخص کنید چه مواردی را فقط نشان دهد):
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#38bdf8]/15 text-[#38bdf8] font-bold">
              {selectedColIds.length} ستون فعال
            </span>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[#8b91c5] ml-1">پیش‌فرض‌ها:</span>
            {PRESETS.map((p) => {
              const isActive =
                selectedColIds.length === p.cols.length &&
                p.cols.every((c) => selectedColIds.includes(c));
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedColIds(p.cols)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                    isActive
                      ? "bg-[#38bdf8]/20 border-[#38bdf8] text-[#38bdf8] font-semibold"
                      : "bg-white/[0.04] border-white/[0.08] text-[#8b91c5] hover:text-white hover:bg-white/[0.08]"
                  }`}
                >
                  {p.title}
                </button>
              );
            })}
          </div>
        </div>

        {/* Individual Column Chips / Toggles */}
        <div className="flex flex-wrap gap-2">
          {ALL_COLUMNS.map((col) => {
            const isSelected = selectedColIds.includes(col.id);
            return (
              <button
                key={col.id}
                onClick={() => toggleColumn(col.id)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
                  isSelected
                    ? "bg-[#6c5ce7]/25 border-[#8b7cff] text-white shadow-sm"
                    : "bg-white/[0.03] border-white/[0.07] text-[#8b91c5] hover:text-[#c3c8ee] hover:bg-white/[0.06]"
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[10px] ${
                    isSelected ? "bg-[#38bdf8] text-black font-bold" : "border border-white/20"
                  }`}
                >
                  {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                </div>
                <span>{col.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0d0f22]/70 p-3 rounded-xl border border-[rgba(140,130,255,0.12)]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[#8b91c5]">
            <Filter className="w-3.5 h-3.5 text-[#38bdf8]" />
            <span>فیلتر جهت:</span>
          </div>
          <button
            onClick={() => setDirFilter("ALL")}
            className={`text-xs px-2.5 py-1 rounded-md transition-all ${
              dirFilter === "ALL"
                ? "bg-white/[0.15] text-white font-medium"
                : "text-[#8b91c5] hover:text-white"
            }`}
          >
            همه ({data.length})
          </button>
          <button
            onClick={() => setDirFilter("UP")}
            className={`text-xs px-2.5 py-1 rounded-md transition-all ${
              dirFilter === "UP"
                ? "bg-[#2ce5a7]/20 text-[#2ce5a7] font-semibold"
                : "text-[#8b91c5] hover:text-[#2ce5a7]"
            }`}
          >
            فقط صعودی UP ({stats.upCount})
          </button>
          <button
            onClick={() => setDirFilter("DOWN")}
            className={`text-xs px-2.5 py-1 rounded-md transition-all ${
              dirFilter === "DOWN"
                ? "bg-[#ff6b9d]/20 text-[#ff6b9d] font-semibold"
                : "text-[#8b91c5] hover:text-[#ff6b9d]"
            }`}
          >
            فقط نزولی DOWN ({stats.downCount})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#5d628f] absolute right-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="جستجو در زمان، ساعت یا اسکور..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white/[0.05] border border-white/[0.1] rounded-lg pr-8 pl-3 py-1 text-xs text-white placeholder-[#5d628f] focus:outline-none focus:border-[#38bdf8] w-56"
            />
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-[#090b1a] border border-[rgba(140,130,255,0.15)] rounded-2xl overflow-hidden shadow-lg">
        {loading ? (
          <div className="p-12 text-center text-xs text-[#8b91c5] flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-[#38bdf8]" />
            <span>در حال بارگذاری فایل‌های تاریخی Jev...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-[#ff6b9d]">{error}</div>
        ) : filteredData.length === 0 ? (
          <div className="p-12 text-center text-xs text-[#8b91c5]">
            هیچ داده‌ای مطابق با بازه زمانی یا فیلترهای انتخابی یافت نشد.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[650px] overflow-y-auto">
            <table className="w-full text-right text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-[#0d0f22] text-[#8b91c5] border-b border-white/[0.1] uppercase text-[11px] tracking-wider">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">ردیف</th>
                  <th className="py-3.5 px-4 font-semibold">زمان و ساعت (ET)</th>
                  {activeColumns.map((col) => (
                    <th key={col.id} className="py-3.5 px-4 font-semibold">
                      {col.label}
                    </th>
                  ))}
                  <th className="py-3.5 px-4 font-semibold text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {filteredData.map((row, index) => (
                  <tr
                    key={row.filename}
                    className="hover:bg-white/[0.03] transition-colors group cursor-pointer"
                    onClick={() => viewFile(row.filename)}
                  >
                    <td className="py-3 px-4 text-[#5d628f] font-mono tabular-nums">
                      {filteredData.length - index}
                    </td>

                    <td className="py-3 px-4 font-mono text-[#eef0ff] whitespace-nowrap">
                      <div className="font-semibold text-white">
                        {row.current_time_et || row.et_time}
                      </div>
                      <div className="text-[10px] text-[#5d628f] truncate max-w-[170px]" title={row.filename}>
                        {row.filename}
                      </div>
                    </td>

                    {activeColumns.map((col) => (
                      <td key={col.id} className="py-3 px-4 whitespace-nowrap">
                        {col.render(row, signals)}
                      </td>
                    ))}

                    <td
                      className="py-3 px-4 text-center whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => viewFile(row.filename)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 text-[#38bdf8] text-[11px] transition-colors"
                        >
                          <Eye className="w-3 h-3" />
                          مشاهده
                        </button>
                        <a
                          href={`/api/jev/history?file=${row.filename}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[#8b91c5] hover:text-white transition-colors"
                          title="دانلود فایل JSON"
                        >
                          <Download className="w-3 h-3" />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="bg-[#0d0f22]/90 border-t border-white/[0.08] px-4 py-2.5 flex items-center justify-between text-[11px] text-[#8b91c5]">
          <span>نمایش {filteredData.length} از {data.length} فایل اسنپ‌شات (در بازه انتخابی)</span>
          <span>مسیر فایل‌ها در سرور: <code className="text-[#38bdf8]">/jev/history/</code></span>
        </div>
      </div>

      {/* JSON Viewer Modal */}
      {selectedFileForModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#090b1a] border border-[#38bdf8]/40 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08] bg-[#0d0f22]">
              <div className="flex items-center gap-2">
                <FileJson className="w-4 h-4 text-[#38bdf8]" />
                <span className="text-xs font-semibold text-white">
                  محتوای کامل فایل: <b className="font-mono text-[#38bdf8]">{selectedFileForModal}</b>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/jev/history?file=${selectedFileForModal}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 rounded bg-white/[0.08] hover:bg-white/[0.15] text-[11px] text-[#c3c8ee] transition-colors"
                >
                  دانلود مستقیم
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedFileForModal(null)}
                  className="text-[#8b91c5] hover:text-white text-base px-2"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 bg-[#05060d]">
              {fileLoading ? (
                <div className="p-12 text-center text-xs text-[#8b91c5]">
                  در حال بازخوانی فایل JSON...
                </div>
              ) : (
                <pre className="font-mono text-[11px] leading-relaxed text-[#c3c8ee] whitespace-pre selection:bg-[#38bdf8]/30">
                  {fileContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
