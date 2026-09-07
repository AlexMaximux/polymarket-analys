import { describe, it, expect } from 'vitest';
import { buildChartSeries } from '../src/lib/chart';

describe('chart series builder', () => {
  it('should compute deployed, recovered, and pnlPct correctly', () => {
    const trades = [
      {
        timestamp: 1600000000,
        side: 'BUY',
        size: 100,
        price: 0.5,
        asset: 'A'
      },
      {
        timestamp: 1600000000,
        side: 'BUY',
        size: 200,
        price: 0.6,
        asset: 'B'
      },
      {
        timestamp: 1600086400, // next day
        side: 'SELL',
        size: 50,
        price: 0.8,
        asset: 'A'
      }
    ];

    const series = buildChartSeries(trades);

    expect(series.length).toBe(2);
    
    // Day 1
    expect(series[0].deployed).toBe(170); // 100*0.5 + 200*0.6
    expect(series[0].recovered).toBe(0);
    // Inventory Day 1: A(100 @ 0.5) -> 50, B(200 @ 0.6) -> 120
    expect(series[0].markValue).toBe(170);
    expect(series[0].pnlPct).toBe(0); // (0+170-170)/170 = 0

    // Day 2
    expect(series[1].deployed).toBe(170);
    expect(series[1].recovered).toBe(40); // 50 * 0.8
    // Inventory Day 2: A(50 left @ 0.8 mark) = 40. B(200 left @ 0.6 mark) = 120. Total mark = 160.
    expect(series[1].markValue).toBe(160);
    // Pnl: (recovered + mark - deployed) / deployed
    // = (40 + 160 - 170) / 170 = 30 / 170 = 0.1764 -> 17.64%
    expect(series[1].pnlPct).toBeCloseTo(17.647, 2);
  });
});
