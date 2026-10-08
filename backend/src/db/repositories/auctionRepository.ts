import type { Database } from "better-sqlite3";
import type { AuctionBid, AuctionResult, PricePoint } from "../../domain/types.js";

interface AuctionRow {
  interval: number;
  simTime: number;
  clearingPrice: number | null;
  volume: number;
  lastMatchedSellPrice: number | null;
  lastMatchedBuyPrice: number | null;
  exportedKwh: number;
  importedKwh: number;
  avg24h: number;
  timestamp: number;
}

/** Settled auctions (the price history) and their bids. */
export class AuctionRepository {
  constructor(private readonly db: Database) {}

  insert(a: Omit<AuctionResult, "bids"> & { avg24h: number; timestamp: number }, bids: AuctionBid[]): void {
    this.db
      .prepare(
        `INSERT INTO auctions
          (interval, simTime, clearingPrice, volume, lastMatchedSellPrice, lastMatchedBuyPrice, exportedKwh, importedKwh, avg24h, timestamp)
         VALUES (@interval, @simTime, @clearingPrice, @volume, @lastMatchedSellPrice, @lastMatchedBuyPrice, @exportedKwh, @importedKwh, @avg24h, @timestamp)`
      )
      .run(a);
    const insertBid = this.db.prepare(
      `INSERT INTO auction_bids (id, interval, participantId, participantName, participantType, side, source, quantity, limitPrice, matched)
       VALUES (@id, @interval, @participantId, @participantName, @participantType, @side, @source, @quantity, @limitPrice, @matched)`
    );
    for (const b of bids) insertBid.run({ ...b, interval: a.interval });
  }

  latest(): AuctionResult | null {
    const row = this.db.prepare(`SELECT * FROM auctions ORDER BY interval DESC LIMIT 1`).get() as AuctionRow | undefined;
    if (!row) return null;
    const bids = this.db
      .prepare(
        `SELECT id, participantId, participantName, participantType, side, source, quantity, limitPrice, matched
         FROM auction_bids WHERE interval = ? ORDER BY rowid`
      )
      .all(row.interval) as AuctionBid[];
    return {
      interval: row.interval,
      simTime: row.simTime,
      clearingPrice: row.clearingPrice,
      volume: row.volume,
      lastMatchedSellPrice: row.lastMatchedSellPrice,
      lastMatchedBuyPrice: row.lastMatchedBuyPrice,
      bids,
      exportedKwh: row.exportedKwh,
      importedKwh: row.importedKwh,
    };
  }

  /** Oldest first, as the price chart draws them. */
  history(limit: number): PricePoint[] {
    const rows = this.db.prepare(`SELECT * FROM auctions ORDER BY interval DESC LIMIT ?`).all(limit) as AuctionRow[];
    return rows.reverse().map((r) => ({
      interval: r.interval,
      simTime: r.simTime,
      price: r.clearingPrice,
      volume: r.volume,
      exportedKwh: r.exportedKwh,
      importedKwh: r.importedKwh,
      avg24h: r.avg24h,
    }));
  }

  /** Clearing prices of the last `intervals` auctions that matched anything. */
  recentPrices(intervals: number): number[] {
    return (
      this.db
        .prepare(`SELECT clearingPrice FROM (SELECT clearingPrice FROM auctions ORDER BY interval DESC LIMIT ?) WHERE clearingPrice IS NOT NULL`)
        .all(intervals) as Array<{ clearingPrice: number }>
    ).map((r) => r.clearingPrice);
  }

  lastPrice(): number | null {
    const row = this.db
      .prepare(`SELECT clearingPrice FROM auctions WHERE clearingPrice IS NOT NULL ORDER BY interval DESC LIMIT 1`)
      .get() as { clearingPrice: number } | undefined;
    return row?.clearingPrice ?? null;
  }
}
