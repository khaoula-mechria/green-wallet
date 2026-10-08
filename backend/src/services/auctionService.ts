import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { AccountRepository } from "../db/repositories/accountRepository.js";
import { MeasurementRepository, type IntervalOutcome } from "../db/repositories/measurementRepository.js";
import { AuctionRepository } from "../db/repositories/auctionRepository.js";
import { OfferRepository } from "../db/repositories/offerRepository.js";
import type {
  AuctionBid,
  AuctionResult,
  BidSide,
  BidSource,
  CertificateAmounts,
  Household,
  MyBidPreview,
  PricePoint,
} from "../domain/types.js";
import { priceBand } from "../config/env.js";
import { NotFoundError } from "../utils/errors.js";
import { clearAuction } from "../market/clearing.js";
import { CLEARING_ACCOUNT, GRID_STORAGE_ACCOUNT, TREASURY_ACCOUNT, UTILITY_ACCOUNT, type LedgerService } from "./ledgerService.js";
import type { CertificateService } from "./certificateService.js";
import type { GridService } from "./gridService.js";
import type { ClockService } from "./clockService.js";

const EPS = 1e-9;
const MIN_BID_KWH = 0.001;

type AgentBid = { side: BidSide; source: BidSource; quantity: number; limitPrice: number };
type LiveBid = AuctionBid & { household: Household | null };

/**
 * The uniform-price double auction (docs/DESIGN.md §4), settled at the end of
 * every market interval:
 *  - automatic agents bid for every household from its meter and its one-time
 *    price limits; the grid pool trades against the 24-hour average;
 *  - one clearing price for everyone (market/clearing.ts);
 *  - settlement through the clearing account (buyers pay in, sellers are paid
 *    out), certificates shared out in proportion, kWh bought consumed at once;
 *  - unmatched energy (imbalance) goes to the utility: export at the floor,
 *    import at the ceiling. Nobody is ever cut off.
 */
export class AuctionService {
  private readonly households: HouseholdRepository;
  private readonly accounts: AccountRepository;
  private readonly measurements: MeasurementRepository;
  private readonly auctions: AuctionRepository;
  private readonly offers: OfferRepository;

  constructor(
    db: Database,
    private readonly ledger: LedgerService,
    private readonly certificates: CertificateService,
    private readonly grid: GridService,
    private readonly clock: ClockService
  ) {
    this.households = new HouseholdRepository(db);
    this.accounts = new AccountRepository(db);
    this.measurements = new MeasurementRepository(db);
    this.auctions = new AuctionRepository(db);
    this.offers = new OfferRepository(db);
  }

  /** Budget check (§4.1): TEC for this interval's deficit is reserved until the auction settles. */
  updateReservation(householdId: string): void {
    const h = this.mustGet(householdId);
    const account = this.ledger.getHouseholdAccount(householdId);
    let reserved = 0;
    if (!h.settings.auctionOptOut && h.pendingBuyKwh > EPS) {
      reserved = Math.min(ceil2(h.pendingBuyKwh * h.settings.maxBuyPrice), floor2(account.balance));
    }
    this.accounts.setReserved(account.id, Math.max(0, reserved));
  }

  /** What a household's automatic agent bids this interval (§4.1). */
  householdBids(h: Household): AgentBid[] {
    if (h.settings.auctionOptOut) return [];
    if (h.pendingBuyKwh > EPS) {
      // A household never buys and sells in the same interval: a deficit used its own stock first.
      const reserved = this.ledger.getHouseholdAccount(h.id).reservedBalance;
      const max = h.settings.maxBuyPrice;
      const quantity = max > 0 ? Math.min(h.pendingBuyKwh, reserved / max) : 0;
      return quantity > MIN_BID_KWH ? [{ side: "buy", source: "deficit", quantity, limitPrice: max }] : [];
    }

    const bids: AgentBid[] = [];
    if (h.pendingSellKwh > MIN_BID_KWH) {
      bids.push({ side: "sell", source: "surplus", quantity: h.pendingSellKwh, limitPrice: h.settings.minSellPrice });
    }
    if (h.type === "prosumer") {
      // kWh listed on the marketplace are taken from rented storage first, then the battery,
      // and never offered in the auction too (§8.3).
      const listed = this.offers.sumActiveRemainingBySeller(h.id);
      const listedFromStored = Math.min(listed, h.storedKwh);
      const listedFromBattery = Math.max(0, listed - listedFromStored);
      if (h.settings.overflowMode === "store") {
        const q = h.storedKwh - listedFromStored;
        if (q > MIN_BID_KWH) bids.push({ side: "sell", source: "storage", quantity: q, limitPrice: h.settings.storeMinPrice });
      }
      if (h.settings.batterySell.enabled && h.batteryCapacityKwh > 0) {
        const keep = (h.settings.batterySell.keepPercent / 100) * h.batteryCapacityKwh;
        const q = h.batteryKwh - listedFromBattery - keep;
        if (q > MIN_BID_KWH) bids.push({ side: "sell", source: "battery", quantity: q, limitPrice: h.settings.batterySell.minPrice });
      }
    }
    return bids;
  }

  myBid(householdId: string): MyBidPreview {
    const h = this.mustGet(householdId);
    const bids = this.householdBids(h);
    return {
      side: bids[0]?.side ?? null,
      bids: bids.map((b) => ({ source: b.source, quantity: round3(b.quantity), limitPrice: b.limitPrice })),
      pendingSellKwh: round3(h.pendingSellKwh),
      pendingBuyKwh: round3(h.pendingBuyKwh),
      reservedTec: round2(this.ledger.getHouseholdAccount(householdId).reservedBalance),
      optedOut: h.settings.auctionOptOut,
    };
  }

  latest(): AuctionResult | null {
    return this.auctions.latest();
  }

  history(limit: number): PricePoint[] {
    return this.auctions.history(limit);
  }

  lastPrice(): number | null {
    return this.auctions.lastPrice();
  }

  /** Clears and settles the current interval. Call inside a DB transaction (MarketService does). */
  settle(): AuctionResult {
    const interval = this.clock.interval();
    const simTime = this.clock.simTime();
    const band = priceBand();
    const outcomes = new Map<string, IntervalOutcome>();
    const outcome = (id: string) => {
      let o = outcomes.get(id);
      if (!o) outcomes.set(id, (o = { sold: 0, exported: 0, bought: 0, imported: 0 }));
      return o;
    };

    // 1. A household that both produced and lacked energy this interval covers itself first.
    for (const h of this.households.findAll()) {
      if (h.pendingSellKwh <= EPS || h.pendingBuyKwh <= EPS) continue;
      const m = Math.min(h.pendingSellKwh, h.pendingBuyKwh);
      const share = this.certificates.shareOf(h.id, m);
      this.households.adjustPending(h.id, -m, -m);
      this.consume(h.id, m, share);
      this.updateReservation(h.id);
    }

    // 2. Bids: every household's agent, then the grid pool.
    const bids: LiveBid[] = [];
    for (const h of this.households.findAll()) {
      for (const b of this.householdBids(h)) {
        bids.push({ id: uuid(), participantId: h.id, participantName: h.name, participantType: h.type, ...b, matched: 0, household: h });
      }
    }
    const pool = this.grid.poolLimits();
    const poolCharge = this.grid.poolKwh();
    if (poolCharge > MIN_BID_KWH) {
      bids.push(this.poolBid("sell", poolCharge, pool.sellAbove));
    }
    const poolCanAfford = this.ledger.getBalance(GRID_STORAGE_ACCOUNT).available / pool.buyBelow;
    const poolBuy = Math.min(this.grid.poolRoomKwh(), poolCanAfford);
    if (poolBuy > MIN_BID_KWH) bids.push(this.poolBid("buy", poolBuy, pool.buyBelow));

    // 3. Clearing.
    const sells = bids.filter((b) => b.side === "sell");
    const buys = bids.filter((b) => b.side === "buy");
    const cleared = clearAuction(sells, buys);
    const price = cleared.price;

    if (price !== null) {
      // 4. Buyers pay the clearing account (their reservation is released first).
      for (const b of buys) {
        if (b.matched <= EPS) continue;
        const memo = `Auction interval ${interval}: bought ${b.matched.toFixed(3)} kWh at ${price.toFixed(3)}`;
        if (b.household) {
          const account = this.ledger.getHouseholdAccount(b.household.id);
          this.accounts.setReserved(account.id, 0);
          this.payTec("AUCTION_PAYMENT", account.id, CLEARING_ACCOUNT, Math.min(ceil2(b.matched * price), floor2(account.balance)), memo);
        } else {
          const available = this.ledger.getBalance(GRID_STORAGE_ACCOUNT).available;
          this.payTec("AUCTION_PAYMENT", GRID_STORAGE_ACCOUNT, CLEARING_ACCOUNT, Math.min(ceil2(b.matched * price), available), memo);
        }
      }

      // 5. Sellers deliver (energy and its certificates into the clearing pool) and are paid.
      const pooled: CertificateAmounts = { solar: 0, wind: 0 };
      for (const s of sells) {
        if (s.matched <= EPS) continue;
        const from = s.household ? this.ledger.getHouseholdAccount(s.household.id).id : GRID_STORAGE_ACCOUNT;
        const share = s.household ? this.certificates.shareOf(s.household.id, s.matched) : this.grid.poolCertificateShare(s.matched);
        this.takeEnergy(s, s.matched);
        pooled.solar += this.ledger.transferCertificate(from, CLEARING_ACCOUNT, "SOLAR", share.solar, "Delivered to the auction")?.amount ?? 0;
        pooled.wind += this.ledger.transferCertificate(from, CLEARING_ACCOUNT, "WIND", share.wind, "Delivered to the auction")?.amount ?? 0;

        const payout = Math.min(floor2(s.matched * price), this.ledger.getBalance(CLEARING_ACCOUNT).available);
        this.payTec("AUCTION_PAYOUT", CLEARING_ACCOUNT, from, payout, `Auction interval ${interval}: sold ${s.matched.toFixed(3)} kWh at ${price.toFixed(3)}`);
        if (s.household) {
          outcome(s.household.id).sold += s.matched;
          this.grid.shrinkOffers(s.household.id);
        }
      }

      // 6. Buyers receive the energy with their pro-rata share of its certificates.
      const matchedBuys = buys.filter((b) => b.matched > EPS);
      let left = { ...pooled };
      matchedBuys.forEach((b, i) => {
        const last = i === matchedBuys.length - 1;
        const f = b.matched / cleared.volume;
        const share = {
          solar: last ? left.solar : Math.min(left.solar, round2(pooled.solar * f)),
          wind: last ? left.wind : Math.min(left.wind, round2(pooled.wind * f)),
        };
        const to = b.household ? this.ledger.getHouseholdAccount(b.household.id).id : GRID_STORAGE_ACCOUNT;
        const solar = this.ledger.transferCertificate(CLEARING_ACCOUNT, to, "SOLAR", share.solar, "Certificates delivered with auction energy")?.amount ?? 0;
        const wind = this.ledger.transferCertificate(CLEARING_ACCOUNT, to, "WIND", share.wind, "Certificates delivered with auction energy")?.amount ?? 0;
        left = { solar: left.solar - solar, wind: left.wind - wind };

        if (b.household) {
          this.households.adjustPending(b.household.id, 0, -b.matched);
          this.consume(b.household.id, b.matched, { solar, wind });
          outcome(b.household.id).bought += b.matched;
        } else {
          this.grid.adjustPool(b.matched);
        }
      });

      // 7. Rounding residue: TEC to the treasury, certificate dust to the utility.
      const residue = this.ledger.getBalance(CLEARING_ACCOUNT).balance;
      this.payTec("CLEARING_SWEEP", CLEARING_ACCOUNT, TREASURY_ACCOUNT, residue, "Rounding residue swept to treasury");
      const dust = this.ledger.getCertificates(CLEARING_ACCOUNT);
      this.ledger.transferCertificate(CLEARING_ACCOUNT, UTILITY_ACCOUNT, "SOLAR", dust.solar, "Rounding residue");
      this.ledger.transferCertificate(CLEARING_ACCOUNT, UTILITY_ACCOUNT, "WIND", dust.wind, "Rounding residue");
    }

    // 8. Imbalance goes to the utility: unmatched supply exported, unmatched demand imported.
    let exportedKwh = 0;
    let importedKwh = 0;
    for (const h of this.households.findAll()) {
      const account = this.ledger.getHouseholdAccount(h.id).id;
      if (h.pendingSellKwh > EPS) {
        const e = h.pendingSellKwh;
        const share = this.certificates.shareOf(h.id, e);
        this.households.adjustPending(h.id, -e, 0);
        this.households.addUtility(h.id, 0, 0, e, e * band.floor);
        this.ledger.transferCertificate(account, UTILITY_ACCOUNT, "SOLAR", share.solar, "Certificates handed over with exported energy");
        this.ledger.transferCertificate(account, UTILITY_ACCOUNT, "WIND", share.wind, "Certificates handed over with exported energy");
        outcome(h.id).exported += e;
        exportedKwh += e;
      }
      if (h.pendingBuyKwh > EPS) {
        const i = h.pendingBuyKwh;
        this.households.adjustPending(h.id, 0, -i);
        this.households.addUtility(h.id, i, i * band.ceiling, 0, 0);
        this.households.addConsumption(h.id, i, 0, 0);
        outcome(h.id).imported += i;
        importedKwh += i;
      }
      this.accounts.setReserved(account, 0);
    }

    // 9. The interval's readings learn their outcome.
    for (const h of this.households.findAll()) {
      this.measurements.settleInterval(h.id, interval, price, outcomes.get(h.id) ?? { sold: 0, exported: 0, bought: 0, imported: 0 });
    }

    // 10. Price history, bids, and one summary record on the ledger (§4.3).
    const prices = this.auctions.recentPrices(this.clock.intervalsPerDay() - 1);
    if (price !== null) prices.push(price);
    const avg24h = prices.length ? round3(prices.reduce((s, p) => s + p, 0) / prices.length) : band.mid;
    const result: AuctionResult = {
      interval,
      simTime,
      clearingPrice: price,
      volume: round3(cleared.volume),
      lastMatchedSellPrice: cleared.lastMatchedSellPrice,
      lastMatchedBuyPrice: cleared.lastMatchedBuyPrice,
      bids: bids.map(({ household: _h, ...b }) => ({ ...b, quantity: round3(b.quantity), matched: round3(b.matched) })),
      exportedKwh: round3(exportedKwh),
      importedKwh: round3(importedKwh),
    };
    const { bids: publicBids, ...summary } = result;
    this.auctions.insert({ ...summary, avg24h, timestamp: Date.now() }, publicBids);

    const participants = new Set(bids.filter((b) => b.matched > EPS).map((b) => b.participantId)).size;
    this.ledger.recordAuctionSummary(
      cleared.volume,
      price === null
        ? `Interval ${interval}: no match (${bids.length} bids)`
        : `Interval ${interval}: cleared at ${price.toFixed(3)} TEC/kWh, ${cleared.volume.toFixed(2)} kWh, ${participants} participants`
    );
    return result;
  }

  /** A TEC movement that may round to nothing (tiny matches): skipped instead of rejected. */
  private payTec(type: "AUCTION_PAYMENT" | "AUCTION_PAYOUT" | "CLEARING_SWEEP", from: string, to: string, amount: number, memo: string): void {
    if (round2(amount) <= 0) return;
    this.ledger.transfer(type, from, to, amount, memo);
  }

  private poolBid(side: BidSide, quantity: number, limitPrice: number): LiveBid {
    return {
      id: uuid(),
      participantId: "grid-pool",
      participantName: "Grid pool (operator)",
      participantType: "operator",
      side,
      source: "grid-pool",
      quantity,
      limitPrice,
      matched: 0,
      household: null,
    };
  }

  private takeEnergy(s: LiveBid, kwh: number): void {
    if (!s.household) return this.grid.adjustPool(-kwh);
    const now = Date.now();
    switch (s.source) {
      case "surplus":
        return this.households.adjustPending(s.household.id, -kwh, 0);
      case "storage":
        return this.households.adjustStocks(s.household.id, 0, -kwh, now);
      case "battery":
        return this.households.adjustStocks(s.household.id, -kwh, 0, now);
    }
  }

  /** Energy consumed now: its certificates are retired and it counts in the green share. */
  private consume(householdId: string, kwh: number, certificates: CertificateAmounts): void {
    const account = this.ledger.getHouseholdAccount(householdId).id;
    const solar = this.ledger.retireCertificate(account, "SOLAR", certificates.solar, "Green energy consumed")?.amount ?? 0;
    const wind = this.ledger.retireCertificate(account, "WIND", certificates.wind, "Green energy consumed")?.amount ?? 0;
    this.households.addConsumption(householdId, kwh, solar, wind);
  }

  private mustGet(id: string): Household {
    const h = this.households.findById(id);
    if (!h) throw new NotFoundError("Household");
    return h;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function ceil2(n: number): number {
  return Math.ceil(n * 100 - 1e-6) / 100;
}
function floor2(n: number): number {
  return Math.floor(n * 100 + 1e-6) / 100;
}
