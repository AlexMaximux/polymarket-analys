import { useEffect, useState, useRef } from 'react';
import { TrendingUp, Activity, BarChart2 } from 'lucide-react';

export default function UserCharts({ wallet }: { wallet: string }) {
  const [data, setData] = useState<{ series: any[], generatedAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/users/${wallet}/chart`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [wallet]);

  if (loading) {
    return <div className="p-8 text-center text-[#62666d] animate-pulse bg-white/[0.02] border border-white/[0.08] rounded-2xl">Loading charts...</div>;
  }

  if (!data || !data.series || data.series.length === 0) {
    return (
      <div className="p-8 text-center text-[#62666d] bg-white/[0.02] border border-white/[0.08] rounded-2xl shadow-sm">
        <p className="text-sm font-medium text-[#8a8f98]">Estimated from stored trade history — mark-to-market uses last traded price</p>
        <p className="mt-2 text-[#62666d]">No chart data available for this user.</p>
      </div>
    );
  }

  const series = data.series;
  
  const width = 800;
  const height = 240;
  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  // PnL Scale
  const minPnl = Math.min(...series.map(s => s.pnlPct));
  const maxPnl = Math.max(...series.map(s => s.pnlPct));
  const pnlRange = maxPnl - minPnl || 1;
  const pnlMinScaled = minPnl - (pnlRange * 0.1);
  const pnlMaxScaled = maxPnl + (pnlRange * 0.1);

  // Volume Scale
  const maxVol = Math.max(...series.map(s => s.deployed));
  const volMaxScaled = maxVol * 1.1 || 1;

  // Daily Avg Bet Size Scale (last 30 days)
  const last30 = series.slice(-30);
  const maxAvgBet = Math.max(...last30.map(s => s.betCount > 0 ? s.singleBetSum / s.betCount : 0));
  const avgBetMaxScaled = maxAvgBet * 1.1 || 1;

  const getX = (i: number, len: number) => padding.left + (i / Math.max(len - 1, 1)) * innerWidth;
  
  const getYPnl = (val: number) => padding.top + innerHeight - ((val - pnlMinScaled) / (pnlMaxScaled - pnlMinScaled)) * innerHeight;
  const getYVol = (val: number) => padding.top + innerHeight - (val / volMaxScaled) * innerHeight;
  const getYAvgBet = (val: number) => padding.top + innerHeight - (val / avgBetMaxScaled) * innerHeight;

  const pnlPath = series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${getX(i, series.length)} ${getYPnl(s.pnlPct)}`).join(' ');
  const volPath = series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${getX(i, series.length)} ${getYVol(s.deployed)}`).join(' ');

  const currentPnl = series[series.length - 1]?.pnlPct || 0;
  const isPositive = currentPnl >= 0;

  const handleMouseMove = (e: React.MouseEvent, len: number, setIdx: any) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - padding.left;
    if (x < 0 || x > innerWidth) {
      setIdx(null);
      return;
    }
    const idx = Math.round((x / innerWidth) * Math.max(len - 1, 1));
    setIdx(Math.max(0, Math.min(len - 1, idx)));
  };

  const lastSeries = series[series.length - 1];

  return (
    <div className="space-y-6 mt-8 pt-8 border-t border-white/[0.08] animate-in fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-white flex items-center gap-2"><TrendingUp className="w-5 h-5 text-[#8a8f98]"/> Performance</h2>
        <div className="text-xs text-[#62666d] uppercase tracking-wide px-3 py-1 bg-slate-800/30 rounded-full border border-white/[0.07]">
          Estimated from stored trade history — mark-to-market uses last traded price
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PnL Chart */}
        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-5 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-sm font-medium text-[#8a8f98]">Cumulative PnL %</h3>
              <p className={`text-2xl font-bold tabular-nums tracking-tight mt-1 ${isPositive ? 'text-[#10b981]' : 'text-[#fb7185]'}`}>
                {currentPnl > 0 ? '+' : ''}{currentPnl.toFixed(2)}%
              </p>
            </div>
          </div>
          
          <div className="relative w-full aspect-[800/240]" 
               onMouseMove={(e) => handleMouseMove(e, series.length, setHoverIndex)} 
               onMouseLeave={() => setHoverIndex(null)}>
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
              {/* Grid lines */}
              <line x1={padding.left} y1={getYPnl(0)} x2={width - padding.right} y2={getYPnl(0)} stroke="#334155" strokeWidth="1" strokeDasharray="4 4" />
              <path d={pnlPath} fill="none" stroke={isPositive ? '#34D399' : '#FB7185'} strokeWidth="2" />
              
              {hoverIndex !== null && (
                <g>
                  <line x1={getX(hoverIndex, series.length)} y1={padding.top} x2={getX(hoverIndex, series.length)} y2={height - padding.bottom} stroke="#64748b" strokeWidth="1" strokeDasharray="2 2" />
                  <circle cx={getX(hoverIndex, series.length)} cy={getYPnl(series[hoverIndex].pnlPct)} r="4" fill={series[hoverIndex].pnlPct >= 0 ? '#34D399' : '#FB7185'} />
                </g>
              )}
            </svg>
            
            {hoverIndex !== null && (
              <div className="absolute bg-white/[0.05] border border-white/[0.08] text-white text-xs px-3 py-2 rounded shadow-lg pointer-events-none whitespace-nowrap z-10"
                   style={{ left: `${(getX(hoverIndex, series.length) / width) * 100}%`, top: '10px', transform: 'translateX(-50%)' }}>
                <div className="font-medium text-[#d0d6e0] mb-1">{series[hoverIndex].t}</div>
                <div className={`tabular-nums ${series[hoverIndex].pnlPct >= 0 ? 'text-[#10b981]' : 'text-[#fb7185]'}`}>
                  PnL: {series[hoverIndex].pnlPct.toFixed(2)}%
                </div>
                <div className="tabular-nums text-[#8a8f98]">Deployed: ${series[hoverIndex].deployed.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                <div className="tabular-nums text-[#8a8f98]">Recovered: ${series[hoverIndex].recovered.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                <div className="tabular-nums text-[#8a8f98]">Mark: ${series[hoverIndex].markValue.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
              </div>
            )}
          </div>
        </div>

        {/* Volume Chart */}
        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-5 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-sm font-medium text-[#8a8f98]">Cumulative Volume Deployed</h3>
              <p className="text-2xl font-bold tabular-nums tracking-tight mt-1 text-[#7170ff]">
                ${(lastSeries?.deployed || 0).toLocaleString(undefined, {maximumFractionDigits:0})}
              </p>
            </div>
          </div>
          
          <div className="relative w-full aspect-[800/240]">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
              <path d={volPath} fill="none" stroke="#38BDF8" strokeWidth="2" />
              <path 
                d={`${volPath} L ${getX(series.length - 1, series.length)} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`}
                fill="url(#vol-gradient)" opacity="0.2"
              />
              <defs>
                <linearGradient id="vol-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38BDF8" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
        
        {/* Daily Bet-Size Histogram */}
        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-5 shadow-sm lg:col-span-2">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-sm font-medium text-[#8a8f98] flex items-center gap-2"><BarChart2 className="w-4 h-4"/> Daily Avg Bet Size (Last 30 Days)</h3>
              <p className="text-xl font-bold tabular-nums tracking-tight mt-1 text-indigo-400">
                ${(last30[last30.length - 1]?.betCount > 0 ? (last30[last30.length - 1].singleBetSum / last30[last30.length - 1].betCount) : 0).toLocaleString(undefined, {maximumFractionDigits:0})}
              </p>
            </div>
          </div>
          
          <div className="relative w-full aspect-[1600/240]">
             <svg viewBox={`0 0 ${width*2} ${height}`} className="w-full h-full overflow-visible">
                {last30.map((s, i) => {
                  const avg = s.betCount > 0 ? s.singleBetSum / s.betCount : 0;
                  const bw = (innerWidth * 2) / last30.length - 4;
                  const bx = padding.left + (i * ((innerWidth * 2) / last30.length));
                  const by = getYAvgBet(avg);
                  const bh = (height - padding.bottom) - by;
                  return (
                    <g key={s.t}>
                      <rect x={bx} y={by} width={Math.max(2, bw)} height={Math.max(0, bh)} fill="#818cf8" rx="2" className="hover:fill-indigo-400 transition-colors" />
                      <title>{s.t}: ${avg.toFixed(0)} avg ({s.betCount} bets)</title>
                    </g>
                  );
                })}
             </svg>
          </div>
        </div>

      </div>
    </div>
  );
}
