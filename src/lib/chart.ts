export function buildChartSeries(trades: any[]) {
  let deployed = 0;
  let recovered = 0;
  
  const inventory: Record<string, { size: number, price: number }> = {};
  const seriesByDay: Record<string, any> = {};

  for (const t of trades) {
    // some timestamps may be in seconds or strings. Handle carefully.
    let ts = t.timestamp;
    if (typeof ts === 'string') {
      ts = new Date(ts).getTime();
    } else if (ts < 1e12) {
      ts = ts * 1000;
    }
    const day = new Date(ts).toISOString().split('T')[0];
    
    if (!seriesByDay[day]) {
      seriesByDay[day] = {
        t: day,
        deployed,
        recovered,
        markValue: 0,
        pnlPct: 0,
        dayVolume: 0,
        betCount: 0,
        singleBetSum: 0
      };
    }
    
    const size = Number(t.size) || 0;
    const price = Number(t.price) || 0;
    const notional = size * price;
    
    seriesByDay[day].dayVolume += notional;
    seriesByDay[day].betCount += 1;
    seriesByDay[day].singleBetSum += notional;
    
    const assetId = t.asset || (t.conditionId + '-' + t.outcome);
    if (!inventory[assetId]) inventory[assetId] = { size: 0, price: 0 };
    
    inventory[assetId].price = price; // update mark
    
    if (t.side === 'BUY') {
      deployed += notional;
      inventory[assetId].size += size;
    } else {
      recovered += notional;
      inventory[assetId].size -= size;
      if (inventory[assetId].size < 1e-6) inventory[assetId].size = 0;
    }
    
    let markValue = 0;
    for (const k in inventory) {
      markValue += inventory[k].size * inventory[k].price;
    }
    
    seriesByDay[day].deployed = deployed;
    seriesByDay[day].recovered = recovered;
    seriesByDay[day].markValue = markValue;
    seriesByDay[day].pnlPct = deployed > 0 ? ((recovered + markValue - deployed) / deployed) * 100 : 0;
  }
  
  return Object.values(seriesByDay).sort((a: any, b: any) => a.t.localeCompare(b.t));
}
