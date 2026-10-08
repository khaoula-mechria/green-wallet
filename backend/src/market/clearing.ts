/**
 * Uniform-price double auction (docs/DESIGN.md §4.2), as on electricity spot
 * exchanges. Pure: takes bids, fills their `matched` field, returns the price.
 *
 * 1. Sellers sorted by limit ascending (merit order), buyers descending.
 * 2. Match from the top while the next seller asks no more than the next buyer offers.
 * 3. One price for everyone: halfway between the last matched seller's and buyer's
 *    limits (k-double auction, k = 0.5). A limit is not the price paid.
 * 4. Whole price levels fill in order; the marginal level is shared pro rata, so
 *    ties at the same price split the volume in proportion to their quantities.
 */

const EPS = 1e-9;

export interface ClearingBid {
  quantity: number; // kWh
  limitPrice: number; // TEC/kWh
  matched: number; // kWh, filled by clearAuction
}

export interface ClearingResult {
  price: number | null; // null when nothing matched
  volume: number;
  lastMatchedSellPrice: number | null;
  lastMatchedBuyPrice: number | null;
}

interface Level<T extends ClearingBid> {
  price: number;
  bids: T[];
  total: number;
}

function toLevels<T extends ClearingBid>(bids: T[], ascending: boolean): Level<T>[] {
  const sorted = [...bids].sort((a, b) => (ascending ? a.limitPrice - b.limitPrice : b.limitPrice - a.limitPrice));
  const levels: Level<T>[] = [];
  for (const b of sorted) {
    const last = levels[levels.length - 1];
    if (last && Math.abs(last.price - b.limitPrice) < EPS) {
      last.bids.push(b);
      last.total += b.quantity;
    } else {
      levels.push({ price: b.limitPrice, bids: [b], total: b.quantity });
    }
  }
  return levels;
}

function allocate<T extends ClearingBid>(levels: Level<T>[], volume: number): void {
  let left = volume;
  for (const lv of levels) {
    if (left <= EPS) {
      lv.bids.forEach((b) => (b.matched = 0));
    } else if (lv.total <= left + EPS) {
      lv.bids.forEach((b) => (b.matched = b.quantity));
      left -= lv.total;
    } else {
      const f = left / lv.total;
      lv.bids.forEach((b) => (b.matched = b.quantity * f));
      left = 0;
    }
  }
}

export function clearAuction<T extends ClearingBid>(sells: T[], buys: T[]): ClearingResult {
  const sellLv = toLevels(sells.filter((b) => b.quantity > EPS), true);
  const buyLv = toLevels(buys.filter((b) => b.quantity > EPS), false);
  [...sells, ...buys].forEach((b) => (b.matched = 0));

  let i = 0;
  let j = 0;
  let remS = sellLv[0]?.total ?? 0;
  let remB = buyLv[0]?.total ?? 0;
  let volume = 0;
  let lastS: number | null = null;
  let lastB: number | null = null;

  while (i < sellLv.length && j < buyLv.length && sellLv[i].price <= buyLv[j].price + EPS) {
    const m = Math.min(remS, remB);
    volume += m;
    lastS = sellLv[i].price;
    lastB = buyLv[j].price;
    remS -= m;
    remB -= m;
    if (remS <= EPS) remS = sellLv[++i]?.total ?? 0;
    if (remB <= EPS) remB = buyLv[++j]?.total ?? 0;
  }

  if (volume <= EPS || lastS === null || lastB === null) {
    return { price: null, volume: 0, lastMatchedSellPrice: null, lastMatchedBuyPrice: null };
  }
  allocate(sellLv, volume);
  allocate(buyLv, volume);
  return {
    price: Math.round(((lastS + lastB) / 2) * 1000) / 1000,
    volume,
    lastMatchedSellPrice: lastS,
    lastMatchedBuyPrice: lastB,
  };
}
