import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedFile = searchParams.get('file');

    const historyDir = path.join(process.cwd(), 'jev', 'history');
    if (!fs.existsSync(historyDir)) {
      return NextResponse.json({ files: [], count: 0 });
    }

    if (requestedFile) {
      // Prevent path traversal
      const safeName = path.basename(requestedFile);
      const filePath = path.join(historyDir, safeName);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        return new Response(data, {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `inline; filename="${safeName}"`,
          },
        });
      }
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const coinFilter = searchParams.get('coin')?.toLowerCase();

    let fileNames = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));
    if (coinFilter && coinFilter !== 'all') {
      fileNames = fileNames.filter(f => f.toLowerCase().startsWith(coinFilter + '_'));
    }
    // Sort descending by time
    fileNames.sort().reverse();

    const files = fileNames.map(f => {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8'));
        const p = content.prediction || {};
        const cards = content.cards || {};
        const fv = content.fair_values || {};
        const detectedCoin = content.coin || (f.toLowerCase().startsWith('btc') ? 'BTC' : f.split('_')[0].toUpperCase());

        return {
          filename: f,
          coin: detectedCoin,
          coin_label: content.coin_label || null,
          et_time: content.et_time || f,
          current_time_et: content.current_time_et || null,
          timestamp: content.timestamp || null,
          score: p.score != null ? Number(p.score) : null,
          score_label: p.score_interpretation || null,
          direction: p.direction || null,
          score_confidence:
            p.score_confidence != null
              ? Number((p.score_confidence * 100).toFixed(0))
              : p.raw_decision?.answers?.one_hour_score?.confidence != null
              ? Number((p.raw_decision.answers.one_hour_score.confidence * 100).toFixed(0))
              : null,
          direction_confidence:
            p.direction_confidence != null
              ? Number((p.direction_confidence * 100).toFixed(0))
              : p.raw_decision?.answers?.one_hour_direction?.confidence != null
              ? Number((p.raw_decision.answers.one_hour_direction.confidence * 100).toFixed(0))
              : null,
          confidence:
            p.score_confidence != null
              ? Number((p.score_confidence * 100).toFixed(0))
              : p.direction_confidence != null
              ? Number((p.direction_confidence * 100).toFixed(0))
              : null,
          prob_up: p.direction_probabilities?.UP != null ? Number((p.direction_probabilities.UP * 100).toFixed(1)) : null,
          prob_down: p.direction_probabilities?.DOWN != null ? Number((p.direction_probabilities.DOWN * 100).toFixed(1)) : null,
          up_1h: cards['1h']?.up_display ?? null,
          down_1h: cards['1h']?.down_display ?? null,
          up_1h_num: cards['1h']?.up != null ? Number((cards['1h'].up * 100).toFixed(1)) : null,
          up_15m: cards['15m']?.up_display ?? null,
          up_15m_num: cards['15m']?.up != null ? Number((cards['15m'].up * 100).toFixed(1)) : null,
          up_5m: cards['5m']?.up_display ?? null,
          up_5m_num: cards['5m']?.up != null ? Number((cards['5m'].up * 100).toFixed(1)) : null,
          fair_15m: fv.model_15m != null ? Number((fv.model_15m * 100).toFixed(2)) : null,
          fair_5m: fv.model_5m != null ? Number((fv.model_5m * 100).toFixed(2)) : null,
          fair_base: fv.base_no_drift != null ? Number((fv.base_no_drift * 100).toFixed(2)) : null,
          fair_joint: fv.joint_solve != null ? Number((fv.joint_solve * 100).toFixed(2)) : null,
          spot_price: content.spot_price != null ? Number(content.spot_price) : null,
          open_price: content.open_price != null ? Number(content.open_price) : null,
          price_to_beat: content.price_to_beat != null ? Number(content.price_to_beat) : (content.open_price != null ? Number(content.open_price) : null),
          tokens: p.tokens ?? null,
          cost: p.cost != null ? Number(p.cost.toFixed(6)) : null,
        };
      } catch {
        return { filename: f };
      }
    });

    return NextResponse.json({ count: files.length, files });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
