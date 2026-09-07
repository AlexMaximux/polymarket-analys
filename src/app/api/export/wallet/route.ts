import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST { wallet, kind: 'trades' | 'closed', format: 'csv' | 'pdf' }
 * Downloads a wallet ledger as CSV or PDF:
 *  - trades: every BUY/SELL/REDEEM row, newest first
 *  - closed: per-market realized result (invested / got-back / pnl) — ledger accounting
 */

const short = (w: string) => w.slice(0, 6) + '\u2026' + w.slice(-4);
const csvEscape = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

async function fetchLedger(wallet: string): Promise<any[]> {
  const rows: any[] = [];
  for (let page = 0; page < 6; page++) {
    const res = await fetch(`https://data-api.polymarket.com/activity?user=${wallet}&limit=500&offset=${page * 500}`);
    if (!res.ok) break;
    const chunk: any[] = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < 500) break;
  }
  return rows.filter((r) => r.type === 'TRADE' || r.type === 'REDEEM');
}

function buildPdf(title: string, sections: { header: string; rows: string[] }[], meta: string[]): Uint8Array {
  const PAGE_W = 842, PAGE_H = 595, M = 36;
  let y = PAGE_H - M;
  const pages: string[][] = [];
  let pageOps: string[] = [];
  const objects: string[] = [];

  const ensure = (h: number) => {
    if (y - h < M) { pages.push(pageOps); pageOps = []; y = PAGE_H - M; }
  };
  const text = (x: number, yy: number, size: number, font: 'F1' | 'F2', s: string, gray = 0) => {
    const g = gray.toFixed(2);
    pageOps.push(`BT /${font} ${size} Tf ${g} ${g} ${g} rg ${x} ${yy} Td (${s.replace(/([()\\])/g, '\\$1')}) Tj ET`);
  };

  text(M, y, 16, 'F2', title.slice(0, 80), 0); y -= 20;
  meta.forEach((m) => { text(M, y, 9, 'F1', m, 0.35); y -= 12; });
  y -= 8;

  for (const sec of sections) {
    ensure(34);
    text(M, y, 11, 'F2', sec.header.slice(0, 95), 0.1); y -= 14;
    for (const line of sec.rows) { ensure(11); text(M, y, 8, 'F1', line, 0); y -= 11; }
    y -= 9;
  }
  pages.push(pageOps);

  const n = pages.length;
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  pages.forEach((ops, i) => {
    const pageObj = 5 + i * 2;
    const contObj = pageObj + 1;
    const content = ops.join('\n');
    objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contObj} 0 R >>`;
    objects[contObj] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const wallet = String(body?.wallet || '').trim().toLowerCase();
  const kind = body?.kind === 'closed' ? 'closed' : 'trades';
  const format = body?.format === 'pdf' ? 'pdf' : 'csv';
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'valid wallet required' }, { status: 400 });
  }

  const ledger = await fetchLedger(wallet);
  const newestFirst = [...ledger].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const stamp = new Date().toISOString().slice(0, 10);
  const fname = `${kind}-${short(wallet).replace('\u2026', '-')}-${stamp}`;

  const markets = new Map<string, { title: string; invested: number; returned: number; firstTs: number; lastTs: number }>();
  for (const r of ledger) {
    const cid = r.conditionId;
    if (!cid) continue;
    let m = markets.get(cid);
    if (!m) {
      m = { title: r.title || '', invested: 0, returned: 0, firstTs: r.timestamp || 0, lastTs: r.timestamp || 0 };
      markets.set(cid, m);
    }
    const usd = Number(r.usdcSize) || 0;
    if (r.type === 'TRADE' && r.side === 'BUY') m.invested += usd; else m.returned += usd;
    m.firstTs = Math.min(m.firstTs, r.timestamp || m.firstTs);
    m.lastTs = Math.max(m.lastTs, r.timestamp || 0);
  }
  const closedList = [...markets.entries()]
    .map(([conditionId, m]) => ({ conditionId, title: m.title, invested: m.invested, returned: m.returned, pnl: m.returned - m.invested, lastTs: m.lastTs }))
    .sort((a, b) => b.lastTs - a.lastTs);
  const totInvested = closedList.reduce((s, m) => s + m.invested, 0);
  const totReturned = closedList.reduce((s, m) => s + m.returned, 0);
  const totWins = closedList.filter((m) => m.pnl > 0.01).length;

  if (format === 'csv') {
    const lines: string[] = [];
    if (kind === 'trades') {
      lines.push('date_utc,action,outcome,shares,price_pct,amount_usdc,market,condition_id');
      for (const r of newestFirst) {
        lines.push([
          new Date(r.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 16),
          r.type === 'REDEEM' ? 'REDEEM' : r.side,
          r.outcome, r.size.toFixed(2), (r.price * 100).toFixed(1), r.usdcSize.toFixed(2),
          csvEscape(r.title || ''), r.conditionId || '',
        ].map(csvEscape).join(','));
      }
    } else {
      lines.push('market,date_last_active,invested_usdc,got_back_usdc,pnl_usdc,result,condition_id');
      for (const m of closedList) {
        lines.push([
          csvEscape(m.title),
          new Date(m.lastTs * 1000).toISOString().replace('T', ' ').slice(0, 16),
          m.invested.toFixed(2), m.returned.toFixed(2), m.pnl.toFixed(2),
          m.pnl > 0.01 ? 'WON' : m.pnl < -0.01 ? 'LOST' : 'FLAT',
          m.conditionId,
        ].map(csvEscape).join(','));
      }
      lines.push('');
      lines.push(`TOTAL markets=${closedList.length} wins=${totWins} invested=${totInvested.toFixed(2)} got_back=${totReturned.toFixed(2)} pnl=${(totReturned - totInvested).toFixed(2)}`);
    }
    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fname}.csv"`,
      },
    });
  }

  const usd = (v: number) => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const usd2 = (v: number) => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  let sections: { header: string; rows: string[] }[];
  if (kind === 'trades') {
    const rows = newestFirst.map((r) => {
      const date = new Date(r.timestamp * 1000).toISOString().slice(0, 16).replace('T', ' ');
      const act = r.type === 'REDEEM' ? 'REDEEM ' : (r.side || '').padEnd(6);
      return date + '  ' + act + ' ' + (r.outcome || '').slice(0, 16).padEnd(16) + ' ' +
        Math.round(r.size).toLocaleString('en-US').padStart(10) + '  ' + (r.price * 100).toFixed(1).padStart(5) + '%  ' +
        ('$' + Math.round(r.usdcSize).toLocaleString('en-US')).padStart(12) + '  ' + (r.title || '').slice(0, 40);
    });
    sections = [{ header: 'All trades (' + newestFirst.length + ')', rows }];
  } else {
    const sumHeader = 'All closed markets (' + closedList.length + ') - invested ' + usd(totInvested) +
      ' - got back ' + usd(totReturned) + ' - PnL ' + usd2(totReturned - totInvested);
    sections = [{
      header: sumHeader,
      rows: closedList.map((m) =>
        new Date(m.lastTs * 1000).toISOString().slice(0, 10) + '  ' +
        (m.pnl > 0.01 ? 'WON  ' : m.pnl < -0.01 ? 'LOST ' : 'FLAT ') + '  in ' + usd(m.invested).padStart(12) +
        '  back ' + usd(m.returned).padStart(12) + '  pnl ' + (m.pnl >= 0 ? '+' : '-') + usd(Math.abs(m.pnl)).padStart(11) +
        '  ' + (m.title || '').slice(0, 44)
      ),
    }];
  }

  const meta = [
    'Wallet: ' + wallet,
    kind === 'trades'
      ? 'Full trade history: ' + newestFirst.length + ' rows (buys / sells / redeems), newest first'
      : 'Closed positions: ' + closedList.length + ' markets / ' + totWins + ' won - invested ' + usd(totInvested) +
        ' - got back ' + usd(totReturned) + ' - PnL ' + usd2(totReturned - totInvested),
    'Generated ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC - source: Polymarket on-chain activity ledger',
  ];

  const pdfBytes = buildPdf(
    (kind === 'trades' ? 'Polymarket trade history - ' : 'Polymarket closed positions - ') + short(wallet),
    sections,
    meta
  );
  return new NextResponse(pdfBytes as any, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fname}.pdf"`,
    },
  });
}
