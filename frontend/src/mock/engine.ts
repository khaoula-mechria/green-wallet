// In-browser implementation of docs/DESIGN.md, used while the backend is
// being brought to the new design. It runs the full market loop live:
// readings -> own battery -> rented storage -> uniform-price auction ->
// export/import, with certificates, TEC accounts and a simulated Hedera ledger.

import * as C from "./config";
import { simulateReading } from "./profiles";
import type {
  AuctionBid,
  AuctionResult,
  BidSide,
  BidSource,
  BlockDetail,
  BlockchainBlock,
  ConservationChecks,
  DashboardSummary,
  EnergyFlow,
  EnergyMeasurement,
  EnergyOffer,
  EnergySource,
  EnergyTrade,
  GreenShare,
  Household,
  HouseholdSettings,
  HouseholdType,
  LedgerAsset,
  LedgerStatus,
  LedgerTx,
  LedgerTxType,
  MarketStatus,
  MeasurementResult,
  MicrogridNode,
  MyBidPreview,
  PriceBand,
  PricePoint,
  RegisterInput,
  SharedBatteryStatus,
  Wallet,
} from "../types";

export class MockError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

const invalid = (msg: string) => new MockError(msg, 400, "VALIDATION_ERROR");
const notFound = (what: string) => new MockError(`${what} not found`, 404, "NOT_FOUND");
const forbidden = (msg: string) => new MockError(msg, 403, "FORBIDDEN");
const conflict = (msg: string) => new MockError(msg, 409, "CONFLICT");
const unauthorized = () => new MockError("invalid credentials", 401, "UNAUTHORIZED");

const EPS = 1e-6;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-6) / 100;
const floor2 = (n: number) => Math.floor(n * 100 + 1e-6) / 100;
const clampBand = (p: number) => Math.min(C.CEILING, Math.max(C.FLOOR, r3(p)));

// ---------------------------------------------------------------------------
// Energy stocks: kWh plus the certificates attached to them (DESIGN §2.3).

interface Stock {
  kwh: number;
  solar: number;
  wind: number;
}

const emptyStock = (): Stock => ({ kwh: 0, solar: 0, wind: 0 });
const greenOf = (s: Stock) => s.solar + s.wind;

function stockOf(source: "solar" | "wind", kwh: number): Stock {
  return { kwh, solar: source === "solar" ? kwh : 0, wind: source === "wind" ? kwh : 0 };
}

function normalize(s: Stock): void {
  if (s.kwh < EPS) {
    s.kwh = 0;
    s.solar = 0;
    s.wind = 0;
    return;
  }
  s.solar = Math.max(0, s.solar);
  s.wind = Math.max(0, s.wind);
}

/** Removes up to `amount` kWh, carrying the proportional share of certificates. */
function take(s: Stock, amount: number): Stock {
  const a = Math.min(Math.max(0, amount), s.kwh);
  if (a <= EPS) return emptyStock();
  const f = a / s.kwh;
  const part = { kwh: a, solar: s.solar * f, wind: s.wind * f };
  s.kwh -= a;
  s.solar -= part.solar;
  s.wind -= part.wind;
  normalize(s);
  return part;
}

function add(s: Stock, p: Stock): void {
  s.kwh += p.kwh;
  s.solar += p.solar;
  s.wind += p.wind;
}

// ---------------------------------------------------------------------------

interface Hh {
  id: string;
  name: string;
  type: HouseholdType;
  location: string;
  energyType: EnergySource;
  password: string;
  accountId: string;
  scale: number;
  loadFactor: number;
  createdAt: number;
  batteryCapacityKwh: number;
  battery: Stock;
  stored: Stock;
  settings: HouseholdSettings;
  tec: number;
  reservedTec: number;
  currentProduction: number;
  currentConsumption: number;
  pendingSell: Stock;
  pendingBuy: number;
  utility: { importedKwh: number; importCost: number; exportedKwh: number; exportCredit: number };
  consumed: { solar: number; wind: number; grey: number };
  readings: EnergyMeasurement[];
  lastTopupAt: number;
}

interface InternalOffer extends EnergyOffer {
  expiresAtInterval: number;
}

interface InternalBid extends AuctionBid {
  hh: Hh | null;
}

interface CreateHouseholdInput {
  id?: string;
  name: string;
  type: HouseholdType;
  location: string;
  password: string;
  energyType?: EnergySource;
  batteryCapacityKwh?: number;
  scale?: number;
  loadFactor?: number;
  settings?: Partial<Omit<HouseholdSettings, "batterySell">> & { batterySell?: Partial<HouseholdSettings["batterySell"]> };
  seedTopupTec?: number;
  batteryHalfFull?: boolean;
}

const SEED: CreateHouseholdInput[] = [
  { id: "producer-1", name: "Trabelsi Solar Farm", type: "producer", location: "Sousse", password: C.SEED_PASSWORD, energyType: "solar", scale: 25, settings: { minSellPrice: 0.06 } },
  { id: "producer-2", name: "Gharbi Wind Farm", type: "producer", location: "Bizerte", password: C.SEED_PASSWORD, energyType: "wind", scale: 5, settings: { minSellPrice: 0.07 } },
  { id: "prosumer-1", name: "Ben Ali Rooftop Solar", type: "prosumer", location: "Tunis", password: C.SEED_PASSWORD, batteryCapacityKwh: 5, scale: 3, loadFactor: 1, batteryHalfFull: true, settings: { overflowMode: "sell", minSellPrice: 0.08, maxBuyPrice: 0.25 } },
  { id: "prosumer-2", name: "Sassi Rooftop Solar", type: "prosumer", location: "Sfax", password: C.SEED_PASSWORD, batteryCapacityKwh: 15, scale: 3.5, loadFactor: 1.1, batteryHalfFull: true, settings: { overflowMode: "store", minSellPrice: 0.1, storeMinPrice: 0.18, maxBuyPrice: 0.22, batterySell: { enabled: true, minPrice: 0.24, keepPercent: 40 } } },
  { id: "prosumer-3", name: "Jomaa Home Solar", type: "prosumer", location: "Nabeul", password: C.SEED_PASSWORD, batteryCapacityKwh: 0, scale: 2.5, loadFactor: 0.9, settings: { overflowMode: "sell", minSellPrice: 0.05, maxBuyPrice: 0.3 } },
  { id: "prosumer-4", name: "Mansour Home Solar", type: "prosumer", location: "Ariana", password: C.SEED_PASSWORD, batteryCapacityKwh: 8, scale: 3, loadFactor: 1, batteryHalfFull: true, settings: { overflowMode: "store", minSellPrice: 0.09, storeMinPrice: 0.2, maxBuyPrice: 0.28 } },
  { id: "prosumer-5", name: "Nasri Home Solar", type: "prosumer", location: "Kairouan", password: C.SEED_PASSWORD, batteryCapacityKwh: 0, scale: 2.5, loadFactor: 1, settings: { overflowMode: "sell", minSellPrice: 0.06, maxBuyPrice: 0.3 } },
  { id: "consumer-1", name: "Khelifi Household", type: "consumer", location: "Tunis", password: C.SEED_PASSWORD, loadFactor: 1.2, seedTopupTec: 40, settings: { maxBuyPrice: 0.3 } },
  { id: "consumer-2", name: "Hamdi Household", type: "consumer", location: "La Marsa", password: C.SEED_PASSWORD, loadFactor: 1, seedTopupTec: 40, settings: { maxBuyPrice: 0.25 } },
  { id: "consumer-3", name: "Cherif Household", type: "consumer", location: "Monastir", password: C.SEED_PASSWORD, loadFactor: 1.4, seedTopupTec: 50, settings: { maxBuyPrice: 0.2 } },
  { id: "consumer-4", name: "Bouazizi Household", type: "consumer", location: "Gabes", password: C.SEED_PASSWORD, loadFactor: 0.9, seedTopupTec: 30, settings: { maxBuyPrice: 0.15 } },
];

function defaultSettings(): HouseholdSettings {
  return {
    overflowMode: "sell",
    minSellPrice: C.FLOOR,
    maxBuyPrice: C.CEILING,
    storeMinPrice: C.MID,
    batterySell: { enabled: false, minPrice: r3(C.CEILING - 0.05), keepPercent: 20 },
    auctionOptOut: false,
  };
}

function emptyFlow(): EnergyFlow {
  return {
    selfUse: 0,
    toBattery: 0,
    toStorage: 0,
    toAuction: 0,
    fromBattery: 0,
    fromStorage: 0,
    toBuy: 0,
    sold: 0,
    exported: 0,
    bought: 0,
    imported: 0,
    price: null,
    settled: false,
  };
}

function fakeHash(input: string): string {
  let out = "";
  for (let k = 0; k < 8; k++) {
    let h = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

interface PriceLevel {
  price: number;
  bids: InternalBid[];
  total: number;
}

function toLevels(bids: InternalBid[], ascending: boolean): PriceLevel[] {
  const sorted = [...bids].sort((a, b) => (ascending ? a.limitPrice - b.limitPrice : b.limitPrice - a.limitPrice));
  const levels: PriceLevel[] = [];
  for (const b of sorted) {
    const last = levels[levels.length - 1];
    if (last && Math.abs(last.price - b.limitPrice) < 1e-9) {
      last.bids.push(b);
      last.total += b.quantity;
    } else {
      levels.push({ price: b.limitPrice, bids: [b], total: b.quantity });
    }
  }
  return levels;
}

/** Fills whole price levels in order; the marginal level is shared pro rata (DESIGN §4.2). */
function allocate(levels: PriceLevel[], volume: number): void {
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

/** Uniform-price double auction, k = 0.5 (DESIGN §4.2). */
function clearAuction(sells: InternalBid[], buys: InternalBid[]) {
  const sellLv = toLevels(sells, true);
  const buyLv = toLevels(buys, false);
  let i = 0;
  let j = 0;
  let remS = sellLv[0]?.total ?? 0;
  let remB = buyLv[0]?.total ?? 0;
  let volume = 0;
  let lastS: number | null = null;
  let lastB: number | null = null;

  while (i < sellLv.length && j < buyLv.length && sellLv[i].price <= buyLv[j].price + 1e-9) {
    const m = Math.min(remS, remB);
    volume += m;
    lastS = sellLv[i].price;
    lastB = buyLv[j].price;
    remS -= m;
    remB -= m;
    if (remS <= EPS) {
      i++;
      remS = sellLv[i]?.total ?? 0;
    }
    if (remB <= EPS) {
      j++;
      remB = buyLv[j]?.total ?? 0;
    }
  }

  if (volume <= EPS || lastS === null || lastB === null) {
    [...sells, ...buys].forEach((b) => (b.matched = 0));
    return { price: null as number | null, volume: 0, lastS: null as number | null, lastB: null as number | null };
  }
  allocate(sellLv, volume);
  allocate(buyLv, volume);
  return { price: r3((lastS + lastB) / 2), volume, lastS, lastB };
}

interface IntervalResult {
  sold: number;
  exported: number;
  bought: number;
  imported: number;
}

// ---------------------------------------------------------------------------

export class Engine {
  private households = new Map<string, Hh>();
  private accountOwner = new Map<string, string>();
  private ops = { treasury: 0, clearing: 0, gridStorage: 0 };
  private gridPool: Stock = emptyStock();
  private totalSupply = 0;
  private offers: InternalOffer[] = [];
  private trades: EnergyTrade[] = [];
  private ledger: LedgerTx[] = [];
  private ledgerIndex = new Map<string, LedgerTx>();
  private pendingTxIds: string[] = [];
  private blocks: BlockchainBlock[] = [];
  private priceHistory: PricePoint[] = [];
  private lastAuction: AuctionResult | null = null;
  private simMinutes = C.START_SIM_MINUTES;
  private interval = 0;
  private intervalStartedAt = Date.now();
  private pausedElapsed = 0;
  private paused = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private nextAccountNum = 4801;
  private feesHbar = 0;
  private totals = {
    initialStock: 0,
    produced: 0,
    imported: 0,
    consumed: 0,
    exported: 0,
    certIssued: 0,
    certRetired: 0,
    certToUtility: 0,
  };
  private retired = new Map<string, { solar: number; wind: number; lossSolar: number; lossWind: number }>();

  constructor() {
    this.seed();
    this.start();
  }

  // ---- lifecycle ----------------------------------------------------------

  private start(): void {
    this.intervalStartedAt = Date.now();
    this.timer = setInterval(() => {
      if (this.paused || Date.now() - this.intervalStartedAt < C.INTERVAL_MS) return;
      try {
        this.advance();
      } catch (err) {
        console.error("[mock] interval settlement failed:", err);
        this.intervalStartedAt = Date.now();
      }
    }, 200);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  pause(): void {
    if (this.paused) return;
    this.pausedElapsed = Date.now() - this.intervalStartedAt;
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.intervalStartedAt = Date.now() - this.pausedElapsed;
    this.paused = false;
  }

  step(): void {
    this.advance();
    this.pausedElapsed = 0;
  }

  private advance(): void {
    this.settle();
    this.interval += 1;
    this.simMinutes += C.SIM_MINUTES_PER_INTERVAL;
    this.intervalStartedAt = Date.now();
    this.expireOffers();
    this.generateReadings();
    this.demoMarket();
  }

  /**
   * Demo-only neighbours (mirrors backend SimulationService.demoMarket): every two
   * simulated hours a prosumer with stored energy lists some of it, every ninety
   * minutes a neighbour buys from an open offer, and once a simulated day wallets
   * that ran dry get a simulated top-up, as a real household would do. They use
   * the same createOffer / purchase / top-up paths a person would.
   */
  private demoMarket(listOnly = false): void {
    const homes = [...this.households.values()].filter((h) => h.type !== "producer");
    if (!listOnly && this.simMinutes % 1440 === 0) {
      for (const h of homes) {
        if (h.tec - h.reservedTec < 5) this.transferTec("TOPUP", null, h.accountId, 20, "Monthly top-up (simulated)");
      }
    }
    if (listOnly || this.interval % 4 === 0) {
      for (const h of homes) {
        if (h.type !== "prosumer" || this.offers.some((o) => o.sellerId === h.id && o.status === "active")) continue;
        const kwh = Math.floor(Math.min(3, this.listable(h) * 0.5) * 10) / 10;
        if (kwh < C.MIN_OFFER_KWH) continue;
        const price = Math.min(C.CEILING, Math.max(C.FLOOR, Math.round(this.avg24h() * (1.05 + Math.random() * 0.15) * 1000) / 1000));
        try {
          this.createOffer(h.id, kwh, price);
        } catch {
          // not enough listable energy after all: skip this one
        }
      }
    }
    if (!listOnly && this.interval % 3 === 1) {
      const open = this.offers.filter((o) => o.status === "active");
      const buyers = homes.filter((h) => h.tec - h.reservedTec > 1).sort(() => Math.random() - 0.5);
      for (const o of open.slice(0, 2)) {
        const buyer = buyers.find((b) => b.id !== o.sellerId);
        if (!buyer) break;
        const kwh = Math.floor(Math.min(o.amountRemainingKwh, this.storageSpace(buyer), 1.5, (buyer.tec - buyer.reservedTec) / o.pricePerKwh) * 10) / 10;
        if (kwh < 0.1) continue;
        try {
          this.purchase(buyer.id, o.id, kwh);
        } catch {
          // the buyer can't take it right now: try again later
        }
      }
    }
  }

  private seed(): void {
    this.transferTec("OPERATOR_FUNDING", null, C.ACCOUNTS.treasury, C.TREASURY_INITIAL_TEC, "Initial TEC supply (token creation)");
    this.transferTec("OPERATOR_FUNDING", C.ACCOUNTS.treasury, C.ACCOUNTS.gridStorage, C.GRID_STORAGE_FUNDING_TEC, "Grid storage trading account funding");

    // Pre-charged from the utility: grey energy (DESIGN §6.5).
    this.gridPool = { kwh: C.GRID_POOL_CAPACITY_KWH * C.GRID_POOL_INITIAL_SHARE, solar: 0, wind: 0 };
    this.totals.initialStock += this.gridPool.kwh;

    for (const def of SEED) this.createHousehold(def);
    this.generateReadings();
    this.demoMarket(true); // a few open offers from the start
    this.mineBlock();
  }

  // ---- accounts and ledger ------------------------------------------------

  private labelOf(accountId: string | null): string {
    if (accountId === null) return "—";
    switch (accountId) {
      case C.ACCOUNTS.treasury:
        return "Treasury";
      case C.ACCOUNTS.clearing:
        return "Clearing";
      case C.ACCOUNTS.gridStorage:
        return "Grid storage";
      case C.ACCOUNTS.utility:
        return "Main utility grid";
      case C.ACCOUNTS.operator:
        return "Operator";
    }
    const owner = this.accountOwner.get(accountId);
    return owner ? this.households.get(owner)?.name ?? accountId : accountId;
  }

  private balanceOf(accountId: string): number {
    if (accountId === C.ACCOUNTS.treasury) return this.ops.treasury;
    if (accountId === C.ACCOUNTS.clearing) return this.ops.clearing;
    if (accountId === C.ACCOUNTS.gridStorage) return this.ops.gridStorage;
    const h = this.households.get(this.accountOwner.get(accountId) ?? "");
    if (!h) throw notFound("Account");
    return h.tec - h.reservedTec;
  }

  private adjust(accountId: string, delta: number): void {
    if (accountId === C.ACCOUNTS.treasury) this.ops.treasury = r2(this.ops.treasury + delta);
    else if (accountId === C.ACCOUNTS.clearing) this.ops.clearing = r2(this.ops.clearing + delta);
    else if (accountId === C.ACCOUNTS.gridStorage) this.ops.gridStorage = r2(this.ops.gridStorage + delta);
    else {
      const h = this.households.get(this.accountOwner.get(accountId) ?? "");
      if (!h) throw notFound("Account");
      h.tec = r2(h.tec + delta);
    }
  }

  private recordTx(
    type: LedgerTxType,
    asset: LedgerAsset,
    from: string | null,
    to: string | null,
    amount: number,
    memo: string
  ): LedgerTx {
    const now = Date.now();
    this.seq += 1;
    const id = `${C.ACCOUNTS.operator}@${Math.floor(now / 1000)}.${String(this.seq).padStart(9, "0")}`;
    const householdIds = [from, to]
      .map((a) => (a ? this.accountOwner.get(a) : undefined))
      .filter((x): x is string => Boolean(x));
    const tx: LedgerTx = {
      id,
      type,
      asset,
      fromAccountId: from,
      toAccountId: to,
      fromLabel: from === null ? (asset === "TEC" ? "Created" : "Issued") : this.labelOf(from),
      toLabel: to === null ? (asset === "TEC" ? "Destroyed" : asset === "RECORD" ? "Ledger record" : "Retired") : this.labelOf(to),
      amount: asset === "TEC" ? r2(amount) : r3(amount),
      timestamp: now,
      simTime: this.simMinutes,
      feeHbar: C.SIMULATED_FEE_HBAR,
      memo,
      blockIndex: null,
      householdIds,
    };
    this.ledger.push(tx);
    this.ledgerIndex.set(id, tx);
    this.pendingTxIds.push(id);
    this.feesHbar += C.SIMULATED_FEE_HBAR;
    if (this.ledger.length > C.MAX_LEDGER_TXS) {
      const removed = this.ledger.splice(0, this.ledger.length - C.MAX_LEDGER_TXS);
      removed.forEach((t) => this.ledgerIndex.delete(t.id));
    }
    return tx;
  }

  /** Every TEC movement goes through here. `null` = created (from) / destroyed (to). */
  private transferTec(type: LedgerTxType, from: string | null, to: string | null, amount: number, memo: string): LedgerTx | null {
    const a = r2(amount);
    if (a <= 0) return null;
    if (from !== null) {
      const available = this.balanceOf(from);
      if (available < a - EPS) {
        throw invalid(`insufficient TEC: ${this.labelOf(from)} has ${available.toFixed(2)} available, needs ${a.toFixed(2)}`);
      }
      this.adjust(from, -a);
    } else {
      this.totalSupply = r2(this.totalSupply + a);
    }
    if (to !== null) this.adjust(to, a);
    else this.totalSupply = r2(this.totalSupply - a);
    return this.recordTx(type, "TEC", from, to, a, memo);
  }

  private recordCert(type: LedgerTxType, asset: "SOLAR" | "WIND", from: string | null, to: string | null, amount: number, memo: string): void {
    if (amount < 0.0005) return;
    this.recordTx(type, asset, from, to, amount, memo);
  }

  private mineBlock(): void {
    if (this.pendingTxIds.length === 0) return;
    const prev = this.blocks[this.blocks.length - 1];
    const previousHash = prev?.hash ?? "0".repeat(64);
    const index = (prev?.index ?? -1) + 1;
    const timestamp = Date.now();
    const nonce = Math.floor(Math.random() * 1_000_000);
    const hash = fakeHash(`${index}|${previousHash}|${timestamp}|${nonce}|${this.pendingTxIds.join(",")}`);
    const block: BlockchainBlock = { index, timestamp, simTime: this.simMinutes, previousHash, hash, nonce, transactionIds: this.pendingTxIds };
    for (const id of this.pendingTxIds) {
      const tx = this.ledgerIndex.get(id);
      if (tx) tx.blockIndex = index;
    }
    this.blocks.push(block);
    this.pendingTxIds = [];
    if (this.blocks.length > C.MAX_BLOCKS) this.blocks.splice(0, this.blocks.length - C.MAX_BLOCKS);
  }

  private newId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.seq.toString(36)}`;
  }

  // ---- households ---------------------------------------------------------

  private createHousehold(input: CreateHouseholdInput): Hh {
    const id = input.id ?? `${input.type}-${Math.random().toString(36).slice(2, 7)}`;
    if (this.households.has(id)) throw conflict(`household '${id}' already exists`);

    const energyType: EnergySource =
      input.type === "consumer" ? "grid" : input.type === "producer" ? (input.energyType === "wind" ? "wind" : "solar") : "solar";
    const capacity = input.type === "prosumer" ? Math.min(C.MAX_BATTERY_KWH, Math.max(0, input.batteryCapacityKwh ?? C.DEFAULT_BATTERY_KWH)) : 0;

    const base = defaultSettings();
    const settings: HouseholdSettings = {
      ...base,
      ...input.settings,
      batterySell: { ...base.batterySell, ...input.settings?.batterySell },
    };
    if (input.type !== "prosumer") {
      settings.overflowMode = "sell";
      settings.batterySell.enabled = false;
    }

    const accountId = `0.0.${this.nextAccountNum++}`;
    const h: Hh = {
      id,
      name: input.name,
      type: input.type,
      location: input.location,
      energyType,
      password: input.password,
      accountId,
      scale: input.scale ?? (input.type === "producer" ? (energyType === "wind" ? 6 : 10) : input.type === "prosumer" ? 3 : 0),
      loadFactor: input.loadFactor ?? 1,
      createdAt: Date.now(),
      batteryCapacityKwh: capacity,
      battery: emptyStock(),
      stored: emptyStock(),
      settings,
      tec: 0,
      reservedTec: 0,
      currentProduction: 0,
      currentConsumption: 0,
      pendingSell: emptyStock(),
      pendingBuy: 0,
      utility: { importedKwh: 0, importCost: 0, exportedKwh: 0, exportCredit: 0 },
      consumed: { solar: 0, wind: 0, grey: 0 },
      readings: [],
      lastTopupAt: 0,
    };
    this.households.set(id, h);
    this.accountOwner.set(accountId, id);

    if (input.batteryHalfFull && capacity > 0) {
      h.battery.kwh = capacity / 2;
      this.totals.initialStock += h.battery.kwh;
    }
    if (input.type !== "producer") {
      this.transferTec("WELCOME_GRANT", C.ACCOUNTS.treasury, accountId, C.WELCOME_GRANT_TEC, "Welcome grant");
    }
    if (input.seedTopupTec) {
      this.transferTec("SEED_TOPUP", null, accountId, input.seedTopupTec, "Seed top-up (demo data)");
    }
    return h;
  }

  private get(id: string): Hh {
    const h = this.households.get(id);
    if (!h) throw notFound("Household");
    return h;
  }

  private all(): Hh[] {
    return [...this.households.values()];
  }

  private rentedUsed(): number {
    return this.all().reduce((s, h) => s + h.stored.kwh, 0);
  }

  private storageSpace(h: Hh): number {
    return Math.max(0, Math.min(C.RENTED_CAP_PER_HOUSEHOLD_KWH - h.stored.kwh, C.RENTED_CAPACITY_KWH - this.rentedUsed()));
  }

  private activeOffersOf(h: Hh): InternalOffer[] {
    return this.offers.filter((o) => o.sellerId === h.id && o.status === "active");
  }

  private reservedInOffers(h: Hh): number {
    return this.activeOffersOf(h).reduce((s, o) => s + o.amountRemainingKwh, 0);
  }

  /** Listed kWh are taken from rented storage first, then the battery (DESIGN §8.4). */
  private reservedSplit(h: Hh): { fromStored: number; fromBattery: number } {
    const r = this.reservedInOffers(h);
    const fromStored = Math.min(r, h.stored.kwh);
    return { fromStored, fromBattery: Math.max(0, r - fromStored) };
  }

  private keepReserve(h: Hh): number {
    return (h.settings.batterySell.keepPercent / 100) * h.batteryCapacityKwh;
  }

  private listable(h: Hh): number {
    if (h.type === "producer") return 0;
    const fromBattery = Math.max(0, h.battery.kwh - this.keepReserve(h));
    return Math.max(0, h.stored.kwh + fromBattery - this.reservedInOffers(h));
  }

  /** Offers can never advertise energy that no longer exists (DESIGN §1, §8.3). */
  private shrinkOffers(h: Hh): void {
    let excess = this.reservedInOffers(h) - (h.battery.kwh + h.stored.kwh);
    if (excess <= EPS) return;
    const active = this.activeOffersOf(h).sort((a, b) => b.createdAt - a.createdAt);
    for (const o of active) {
      if (excess <= EPS) break;
      const cut = Math.min(o.amountRemainingKwh, excess);
      o.amountRemainingKwh = r3(o.amountRemainingKwh - cut);
      excess -= cut;
      if (o.amountRemainingKwh < 0.01) {
        o.amountRemainingKwh = 0;
        o.status = "cancelled";
      }
    }
  }

  private updateReservation(h: Hh): void {
    if (h.settings.auctionOptOut || h.pendingBuy <= EPS) {
      h.reservedTec = 0;
      return;
    }
    h.reservedTec = Math.min(ceil2(h.pendingBuy * h.settings.maxBuyPrice), h.tec);
  }

  private consume(h: Hh, part: Stock): void {
    if (part.kwh <= 0) return;
    this.totals.consumed += part.kwh;
    h.consumed.solar += part.solar;
    h.consumed.wind += part.wind;
    h.consumed.grey += part.kwh - greenOf(part);
    this.totals.certRetired += greenOf(part);
    const r = this.retiredFor(h);
    r.solar += part.solar;
    r.wind += part.wind;
  }

  private retiredFor(h: Hh) {
    let r = this.retired.get(h.id);
    if (!r) {
      r = { solar: 0, wind: 0, lossSolar: 0, lossWind: 0 };
      this.retired.set(h.id, r);
    }
    return r;
  }

  // ---- readings -----------------------------------------------------------

  private generateReadings(): void {
    const hour = ((this.simMinutes % 1440) + C.SIM_MINUTES_PER_INTERVAL / 2) / 60;
    for (const h of this.all()) {
      const { production, consumption } = simulateReading(
        { type: h.type, energyType: h.energyType, scale: h.scale, loadFactor: h.loadFactor },
        hour
      );
      this.recordReading(h, production, consumption, "simulation");
    }
  }

  /** Steps 1–2 of DESIGN §5 happen immediately; the rest waits for the auction. */
  private recordReading(h: Hh, production: number, consumption: number, source: "simulation" | "manual"): EnergyMeasurement {
    const prod = r3(production);
    const cons = r3(consumption);
    h.currentProduction = prod;
    h.currentConsumption = cons;
    this.totals.produced += prod;

    const src: "solar" | "wind" = h.energyType === "wind" ? "wind" : "solar";
    const flow = emptyFlow();

    if (prod > 0) {
      this.totals.certIssued += prod;
      this.recordCert("CERT_ISSUE", src === "wind" ? "WIND" : "SOLAR", null, h.accountId, prod, `Green certificate for ${prod.toFixed(3)} kWh produced`);
    }

    const selfUse = Math.min(prod, cons);
    if (selfUse > 0) {
      this.consume(h, stockOf(src, selfUse));
      flow.selfUse = r3(selfUse);
    }

    const surplus = r3(prod - cons);
    if (surplus > 0) {
      const fresh = stockOf(src, surplus);
      if (h.type === "prosumer") {
        const toBattery = take(fresh, Math.max(0, h.batteryCapacityKwh - h.battery.kwh));
        add(h.battery, toBattery);
        flow.toBattery = r3(toBattery.kwh);
        if (h.settings.overflowMode === "store") {
          const toStorage = take(fresh, this.storageSpace(h));
          add(h.stored, toStorage);
          flow.toStorage = r3(toStorage.kwh);
        }
      }
      if (fresh.kwh > EPS) {
        add(h.pendingSell, fresh);
        flow.toAuction = r3(fresh.kwh);
      }
    } else if (surplus < 0) {
      let need = -surplus;
      const b = take(h.battery, need);
      this.consume(h, b);
      need -= b.kwh;
      flow.fromBattery = r3(b.kwh);
      const s = take(h.stored, need);
      this.consume(h, s);
      need -= s.kwh;
      flow.fromStorage = r3(s.kwh);
      this.shrinkOffers(h);
      if (need > EPS) {
        h.pendingBuy += need;
        flow.toBuy = r3(need);
        this.updateReservation(h);
      }
    }

    const m: EnergyMeasurement = {
      id: this.newId("m"),
      householdId: h.id,
      timestamp: Date.now(),
      simTime: this.simMinutes,
      interval: this.interval,
      production: prod,
      consumption: cons,
      surplus,
      source,
      flow,
    };
    h.readings.unshift(m);
    if (h.readings.length > C.MAX_READINGS_PER_HOUSEHOLD) h.readings.length = C.MAX_READINGS_PER_HOUSEHOLD;
    return m;
  }

  // ---- auction ------------------------------------------------------------

  private avg24h(): number {
    const prices = this.priceHistory
      .slice(-C.AVG_WINDOW_INTERVALS)
      .map((p) => p.price)
      .filter((p): p is number => p !== null);
    if (prices.length === 0) return C.MID;
    return r3(prices.reduce((s, p) => s + p, 0) / prices.length);
  }

  private gridLimits() {
    const avg = this.avg24h();
    return { avg, buyBelow: clampBand(avg * C.GRID_POOL_BUY_BELOW_AVG), sellAbove: clampBand(avg * C.GRID_POOL_SELL_ABOVE_AVG) };
  }

  /** The automatic agent's bids for one household (DESIGN §4.1). */
  private householdBids(h: Hh): Array<{ side: BidSide; source: BidSource; quantity: number; limitPrice: number }> {
    if (h.settings.auctionOptOut) return [];
    if (h.pendingBuy > EPS) {
      const qty = h.settings.maxBuyPrice > 0 ? Math.min(h.pendingBuy, h.reservedTec / h.settings.maxBuyPrice) : 0;
      return qty > 0.001 ? [{ side: "buy", source: "deficit", quantity: qty, limitPrice: h.settings.maxBuyPrice }] : [];
    }
    const out: Array<{ side: BidSide; source: BidSource; quantity: number; limitPrice: number }> = [];
    if (h.pendingSell.kwh > 0.001) {
      out.push({ side: "sell", source: "surplus", quantity: h.pendingSell.kwh, limitPrice: h.settings.minSellPrice });
    }
    if (h.type === "prosumer") {
      const { fromStored, fromBattery } = this.reservedSplit(h);
      if (h.settings.overflowMode === "store") {
        const q = h.stored.kwh - fromStored;
        if (q > 0.001) out.push({ side: "sell", source: "storage", quantity: q, limitPrice: h.settings.storeMinPrice });
      }
      if (h.settings.batterySell.enabled && h.batteryCapacityKwh > 0) {
        const q = h.battery.kwh - fromBattery - this.keepReserve(h);
        if (q > 0.001) out.push({ side: "sell", source: "battery", quantity: q, limitPrice: h.settings.batterySell.minPrice });
      }
    }
    return out;
  }

  private takeFromSource(b: InternalBid, amount: number): Stock {
    if (!b.hh) return take(this.gridPool, amount);
    switch (b.source) {
      case "surplus":
        return take(b.hh.pendingSell, amount);
      case "storage":
        return take(b.hh.stored, amount);
      case "battery":
        return take(b.hh.battery, amount);
      default:
        return emptyStock();
    }
  }

  private settle(): void {
    const results = new Map<string, IntervalResult>();
    const resultFor = (h: Hh) => {
      let r = results.get(h.id);
      if (!r) {
        r = { sold: 0, exported: 0, bought: 0, imported: 0 };
        results.set(h.id, r);
      }
      return r;
    };

    // 1. Storage fee: stored kWh decay into the grid pool (DESIGN §6.2).
    for (const h of this.all()) {
      if (h.stored.kwh <= 0) continue;
      let lost = h.stored.kwh * (1 - C.DECAY_FACTOR_PER_INTERVAL);
      if (h.stored.kwh - lost < C.MIN_STORED_KWH) lost = h.stored.kwh;
      const part = take(h.stored, lost);
      this.totals.certRetired += greenOf(part);
      const r = this.retiredFor(h);
      r.lossSolar += part.solar;
      r.lossWind += part.wind;
      const toPool = Math.min(part.kwh, C.GRID_POOL_CAPACITY_KWH - this.gridPool.kwh);
      this.gridPool.kwh += toPool;
      this.totals.exported += part.kwh - toPool; // pool full: operator exports the rest
      this.shrinkOffers(h);
    }

    // 2. A household that both produced and lacked energy this interval nets itself first.
    for (const h of this.all()) {
      if (h.pendingBuy > EPS && h.pendingSell.kwh > EPS) {
        const part = take(h.pendingSell, h.pendingBuy);
        this.consume(h, part);
        h.pendingBuy -= part.kwh;
        this.updateReservation(h);
      }
    }

    // 3. Bids.
    const bids: InternalBid[] = [];
    for (const h of this.all()) {
      for (const b of this.householdBids(h)) {
        bids.push({
          id: this.newId("bid"),
          participantId: h.id,
          participantName: h.name,
          participantType: h.type,
          ...b,
          matched: 0,
          hh: h,
        });
      }
    }
    const grid = this.gridLimits();
    if (this.gridPool.kwh > 0.001) {
      bids.push({ id: this.newId("bid"), participantId: "grid-pool", participantName: "Grid pool (operator)", participantType: "operator", side: "sell", source: "grid-pool", quantity: this.gridPool.kwh, limitPrice: grid.sellAbove, matched: 0, hh: null });
    }
    const room = Math.min(C.GRID_POOL_CAPACITY_KWH - this.gridPool.kwh, this.ops.gridStorage / grid.buyBelow);
    if (room > 0.001) {
      bids.push({ id: this.newId("bid"), participantId: "grid-pool", participantName: "Grid pool (operator)", participantType: "operator", side: "buy", source: "grid-pool", quantity: room, limitPrice: grid.buyBelow, matched: 0, hh: null });
    }

    // 4. Clearing.
    const sells = bids.filter((b) => b.side === "sell");
    const buys = bids.filter((b) => b.side === "buy");
    const cleared = clearAuction(sells, buys);
    const price = cleared.price;

    // 5. Settlement through the clearing account.
    if (price !== null) {
      for (const b of buys) {
        if (b.matched <= EPS) continue;
        const pay = ceil2(b.matched * price);
        const memo = `Auction: bought ${b.matched.toFixed(3)} kWh at ${price.toFixed(3)}`;
        if (b.hh) {
          b.hh.reservedTec = 0;
          this.transferTec("AUCTION_PAYMENT", b.hh.accountId, C.ACCOUNTS.clearing, Math.min(pay, b.hh.tec), memo);
        } else {
          this.transferTec("AUCTION_PAYMENT", C.ACCOUNTS.gridStorage, C.ACCOUNTS.clearing, Math.min(pay, this.ops.gridStorage), memo);
        }
      }

      const pool = emptyStock();
      for (const s of sells) {
        if (s.matched <= EPS) continue;
        add(pool, this.takeFromSource(s, s.matched));
        const memo = `Auction: sold ${s.matched.toFixed(3)} kWh at ${price.toFixed(3)}`;
        this.transferTec("AUCTION_PAYOUT", C.ACCOUNTS.clearing, s.hh ? s.hh.accountId : C.ACCOUNTS.gridStorage, floor2(s.matched * price), memo);
        if (s.hh) resultFor(s.hh).sold += s.matched;
      }

      const matchedBuys = buys.filter((b) => b.matched > EPS);
      matchedBuys.forEach((b, idx) => {
        const part = idx === matchedBuys.length - 1 ? take(pool, pool.kwh) : take(pool, b.matched);
        const to = b.hh ? b.hh.accountId : C.ACCOUNTS.gridStorage;
        this.recordCert("CERT_TRANSFER", "SOLAR", C.ACCOUNTS.clearing, to, part.solar, "Certificates delivered with auction energy");
        this.recordCert("CERT_TRANSFER", "WIND", C.ACCOUNTS.clearing, to, part.wind, "Certificates delivered with auction energy");
        if (b.hh) {
          this.consume(b.hh, part);
          b.hh.pendingBuy = Math.max(0, b.hh.pendingBuy - b.matched);
          resultFor(b.hh).bought += b.matched;
        } else {
          add(this.gridPool, part);
        }
      });

      if (this.ops.clearing >= 0.01) {
        this.transferTec("CLEARING_SWEEP", C.ACCOUNTS.clearing, C.ACCOUNTS.treasury, this.ops.clearing, "Rounding residue swept to treasury");
      }
    }

    // 6. Imbalance goes to the main utility grid (floor / ceiling).
    let exportedKwh = 0;
    let importedKwh = 0;
    for (const h of this.all()) {
      if (h.pendingSell.kwh > EPS) {
        const e = h.pendingSell;
        exportedKwh += e.kwh;
        this.totals.exported += e.kwh;
        this.totals.certToUtility += greenOf(e);
        h.utility.exportedKwh += e.kwh;
        h.utility.exportCredit += e.kwh * C.FLOOR;
        resultFor(h).exported += e.kwh;
        this.recordCert("CERT_TRANSFER", "SOLAR", h.accountId, C.ACCOUNTS.utility, e.solar, "Certificates handed over with exported energy");
        this.recordCert("CERT_TRANSFER", "WIND", h.accountId, C.ACCOUNTS.utility, e.wind, "Certificates handed over with exported energy");
        h.pendingSell = emptyStock();
      }
      if (h.pendingBuy > EPS) {
        const q = h.pendingBuy;
        importedKwh += q;
        this.totals.imported += q;
        this.totals.consumed += q;
        h.consumed.grey += q;
        h.utility.importedKwh += q;
        h.utility.importCost += q * C.CEILING;
        resultFor(h).imported += q;
        h.pendingBuy = 0;
      }
      h.reservedTec = 0;
    }

    // 7. Certificates retired this interval (one record per household and kind).
    for (const [id, r] of this.retired) {
      const h = this.households.get(id);
      if (!h) continue;
      this.recordCert("CERT_RETIRE", "SOLAR", h.accountId, null, r.solar, "Green energy consumed");
      this.recordCert("CERT_RETIRE", "WIND", h.accountId, null, r.wind, "Green energy consumed");
      this.recordCert("CERT_RETIRE", "SOLAR", h.accountId, null, r.lossSolar, "Storage losses (decay)");
      this.recordCert("CERT_RETIRE", "WIND", h.accountId, null, r.lossWind, "Storage losses (decay)");
    }
    this.retired.clear();

    // 8. Attach the outcome to this interval's readings.
    for (const h of this.all()) {
      const readings = h.readings.filter((m) => m.interval === this.interval);
      if (readings.length === 0) continue;
      const res = results.get(h.id);
      readings.forEach((m) => {
        m.flow.settled = true;
        m.flow.price = price;
      });
      if (res) {
        const latest = readings[0].flow;
        latest.sold = r3(res.sold);
        latest.exported = r3(res.exported);
        latest.bought = r3(res.bought);
        latest.imported = r3(res.imported);
      }
    }

    // 9. Result, price history, ledger summary, block.
    this.lastAuction = {
      interval: this.interval,
      simTime: this.simMinutes,
      clearingPrice: price,
      volume: r3(cleared.volume),
      lastMatchedSellPrice: cleared.lastS,
      lastMatchedBuyPrice: cleared.lastB,
      bids: bids.map(({ hh: _hh, ...b }) => ({ ...b, quantity: r3(b.quantity), matched: r3(b.matched) })),
      exportedKwh: r3(exportedKwh),
      importedKwh: r3(importedKwh),
    };
    this.priceHistory.push({
      interval: this.interval,
      simTime: this.simMinutes,
      price,
      volume: r3(cleared.volume),
      exportedKwh: r3(exportedKwh),
      importedKwh: r3(importedKwh),
      avg24h: 0,
    });
    this.priceHistory[this.priceHistory.length - 1].avg24h = this.avg24h();
    if (this.priceHistory.length > C.MAX_PRICE_HISTORY) this.priceHistory.splice(0, this.priceHistory.length - C.MAX_PRICE_HISTORY);

    const participants = new Set(bids.filter((b) => b.matched > EPS).map((b) => b.participantId)).size;
    this.recordTx(
      "AUCTION_SUMMARY",
      "RECORD",
      C.ACCOUNTS.clearing,
      null,
      cleared.volume,
      price === null
        ? `Interval ${this.interval}: no match (${bids.length} bids)`
        : `Interval ${this.interval}: cleared at ${price.toFixed(3)} TEC/kWh, ${cleared.volume.toFixed(2)} kWh, ${participants} participants`
    );
    this.mineBlock();
  }

  private expireOffers(): void {
    for (const o of this.offers) {
      if (o.status === "active" && this.interval >= o.expiresAtInterval) o.status = "expired";
    }
  }

  // ---- projections --------------------------------------------------------

  private toPublic(h: Hh): Household {
    return {
      id: h.id,
      name: h.name,
      type: h.type,
      location: h.location,
      energyType: h.energyType,
      accountId: h.accountId,
      currentProduction: h.currentProduction,
      currentConsumption: h.currentConsumption,
      batteryCapacityKwh: h.batteryCapacityKwh,
      batteryChargeKwh: r3(h.battery.kwh),
      storedKwh: r3(h.stored.kwh),
      reservedInOffersKwh: r3(this.reservedInOffers(h)),
      listableKwh: r3(this.listable(h)),
      storageSpaceKwh: r3(this.storageSpace(h)),
      tokenBalance: r2(h.tec),
      reservedTec: r2(h.reservedTec),
      settings: { ...h.settings, batterySell: { ...h.settings.batterySell } },
      createdAt: h.createdAt,
    };
  }

  private toPublicOffer(o: InternalOffer): EnergyOffer {
    const { expiresAtInterval: _e, ...rest } = o;
    return { ...rest };
  }

  private greenShareOf(parts: Array<{ solar: number; wind: number; grey: number }>): GreenShare {
    const solar = parts.reduce((s, p) => s + p.solar, 0);
    const wind = parts.reduce((s, p) => s + p.wind, 0);
    const grey = parts.reduce((s, p) => s + p.grey, 0);
    const total = solar + wind + grey;
    return { solarKwh: r2(solar), windKwh: r2(wind), greyKwh: r2(grey), percentGreen: total > 0 ? Math.round(((solar + wind) / total) * 100) : 0 };
  }

  private band(): PriceBand {
    return { floor: C.FLOOR, ceiling: C.CEILING, mid: C.MID, components: { ...C.PRICE_COMPONENTS } };
  }

  // ---- public API (called by mock handlers) -------------------------------

  /** Operator console: credit TEC to a household from the treasury (a transfer, not new money). */
  operatorCredit(id: string, amount: number) {
    const h = this.get(id);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) throw invalid("amount must be between 0.01 and 1000 TEC");
    this.transferTec("OPERATOR_FUNDING", C.ACCOUNTS.treasury, h.accountId, amount, "Credit from the operator");
    return this.toPublic(h);
  }

  login(id: string, password: string) {
    const h = this.households.get(id);
    if (!h || h.password !== password) throw unauthorized();
    return { household: this.toPublic(h), token: `mock-token:${h.id}` };
  }

  register(input: RegisterInput) {
    if (!input.name?.trim()) throw invalid("name is required");
    if (!["producer", "consumer", "prosumer"].includes(input.type)) throw invalid("type must be producer, consumer or prosumer");
    if (!input.password || input.password.length < 6) throw invalid("password must be at least 6 characters");
    if (input.batteryCapacityKwh !== undefined) {
      if (!Number.isFinite(input.batteryCapacityKwh) || input.batteryCapacityKwh < 0 || input.batteryCapacityKwh > C.MAX_BATTERY_KWH) {
        throw invalid(`battery capacity must be between 0 and ${C.MAX_BATTERY_KWH} kWh`);
      }
    }
    // Same rule as the backend (auth.routes.ts HOUSEHOLD_ID_PATTERN): an optional, chosen login id.
    const id = input.id?.trim() || undefined;
    if (id !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
      throw invalid("id must be 1-64 chars: letters, digits, '-' or '_', starting with a letter or digit");
    }
    const h = this.createHousehold({
      id,
      name: input.name.trim(),
      type: input.type,
      location: input.location?.trim() || "Unknown",
      password: input.password,
      energyType: input.energyType,
      batteryCapacityKwh: input.batteryCapacityKwh,
    });
    return { household: this.toPublic(h), token: `mock-token:${h.id}` };
  }

  hasHousehold(id: string): boolean {
    return this.households.has(id);
  }

  listHouseholds(): Household[] {
    return this.all().map((h) => this.toPublic(h));
  }

  getHousehold(id: string): Household {
    return this.toPublic(this.get(id));
  }

  history(id: string, limit: number): EnergyMeasurement[] {
    return this.get(id).readings.slice(0, limit);
  }

  submitMeasurement(id: string, production: number, consumption: number): MeasurementResult {
    const h = this.get(id);
    if (!Number.isFinite(production) || !Number.isFinite(consumption)) throw invalid("production/consumption must be numbers");
    if (production < 0 || consumption < 0) throw invalid("production/consumption must be >= 0");
    if (production > 50 || consumption > 50) throw invalid("production/consumption must be <= 50 kWh per reading");
    if (h.type === "consumer" && production > 0) throw invalid("consumers do not produce energy");
    const measurement = this.recordReading(h, production, consumption, "manual");
    return { measurement, settlesInMs: this.nextSettlementInMs() };
  }

  getSettings(id: string): HouseholdSettings {
    return this.toPublic(this.get(id)).settings;
  }

  updateSettings(id: string, patch: Partial<HouseholdSettings>): HouseholdSettings {
    const h = this.get(id);
    const next: HouseholdSettings = {
      ...h.settings,
      ...patch,
      batterySell: { ...h.settings.batterySell, ...patch.batterySell },
    };
    const inBand = (name: string, p: number) => {
      if (!Number.isFinite(p) || p < C.FLOOR || p > C.CEILING) {
        throw invalid(`${name} must be between the floor ${C.FLOOR.toFixed(2)} and the ceiling ${C.CEILING.toFixed(2)} TEC/kWh`);
      }
    };
    inBand("minimum sell price", next.minSellPrice);
    inBand("maximum buy price", next.maxBuyPrice);
    inBand("stored-energy minimum price", next.storeMinPrice);
    inBand("battery sell price", next.batterySell.minPrice);
    if (!(next.batterySell.keepPercent >= 0 && next.batterySell.keepPercent <= 100)) throw invalid("battery reserve must be between 0 and 100%");
    if (!["sell", "store"].includes(next.overflowMode)) throw invalid("overflow mode must be sell or store");
    if (h.type !== "prosumer") {
      next.overflowMode = "sell";
      next.batterySell.enabled = false;
    }
    if (h.batteryCapacityKwh === 0) next.batterySell.enabled = false;
    h.settings = next;
    this.updateReservation(h);
    return this.getSettings(id);
  }

  marketStatus(): MarketStatus {
    return {
      simTime: this.simMinutes,
      interval: this.interval,
      intervalMs: C.INTERVAL_MS,
      nextSettlementInMs: this.nextSettlementInMs(),
      paused: this.paused,
      band: this.band(),
      lastPrice: [...this.priceHistory].reverse().find((p) => p.price !== null)?.price ?? null,
      avg24h: this.avg24h(),
      mockMode: true,
    };
  }

  private nextSettlementInMs(): number {
    if (this.paused) return Math.max(0, C.INTERVAL_MS - this.pausedElapsed);
    return Math.max(0, C.INTERVAL_MS - (Date.now() - this.intervalStartedAt));
  }

  getPriceHistory(limit: number): PricePoint[] {
    return this.priceHistory.slice(-limit);
  }

  latestAuction(): AuctionResult | null {
    return this.lastAuction;
  }

  myBid(id: string): MyBidPreview {
    const h = this.get(id);
    const bids = this.householdBids(h).map((b) => ({ source: b.source, quantity: r3(b.quantity), limitPrice: b.limitPrice }));
    return {
      side: bids.length === 0 ? null : this.householdBids(h)[0].side,
      bids,
      pendingSellKwh: r3(h.pendingSell.kwh),
      pendingBuyKwh: r3(h.pendingBuy),
      reservedTec: r2(h.reservedTec),
      optedOut: h.settings.auctionOptOut,
    };
  }

  activeOffers(): EnergyOffer[] {
    return this.offers.filter((o) => o.status === "active").map((o) => this.toPublicOffer(o));
  }

  /** One offer, whatever its status (GET /market/offers/:id). */
  getOffer(id: string): EnergyOffer {
    const o = this.offers.find((x) => x.id === id);
    if (!o) throw notFound("Offer");
    return this.toPublicOffer(o);
  }

  offersOf(id: string): EnergyOffer[] {
    return this.offers.filter((o) => o.sellerId === id).sort((a, b) => b.createdAt - a.createdAt).map((o) => this.toPublicOffer(o));
  }

  createOffer(sellerId: string, amountKwh: number, pricePerKwh: number): EnergyOffer {
    const h = this.get(sellerId);
    if (h.type === "producer") throw forbidden("producers sell through the auction only");
    if (!Number.isFinite(amountKwh) || amountKwh < C.MIN_OFFER_KWH) throw invalid(`amount must be at least ${C.MIN_OFFER_KWH} kWh`);
    if (!Number.isFinite(pricePerKwh) || pricePerKwh < C.FLOOR || pricePerKwh > C.CEILING) {
      throw invalid(`price must be between the floor ${C.FLOOR.toFixed(2)} and the ceiling ${C.CEILING.toFixed(2)} TEC/kWh`);
    }
    const listable = this.listable(h);
    if (amountKwh > listable + EPS) {
      throw invalid(
        `you can list at most ${listable.toFixed(2)} kWh (stored energy + battery above your ${h.settings.batterySell.keepPercent}% reserve, minus kWh already listed)`
      );
    }
    const offer: InternalOffer = {
      id: this.newId("offer"),
      sellerId: h.id,
      sellerName: h.name,
      amountKwh: r3(amountKwh),
      amountRemainingKwh: r3(amountKwh),
      pricePerKwh: r3(pricePerKwh),
      status: "active",
      createdAt: Date.now(),
      expiresAtSimTime: this.simMinutes + C.OFFER_EXPIRY_INTERVALS * C.SIM_MINUTES_PER_INTERVAL,
      expiresAtInterval: this.interval + C.OFFER_EXPIRY_INTERVALS,
    };
    this.offers.push(offer);
    return this.toPublicOffer(offer);
  }

  cancelOffer(sellerId: string, offerId: string): EnergyOffer {
    const o = this.offers.find((x) => x.id === offerId);
    if (!o) throw notFound("Offer");
    if (o.sellerId !== sellerId) throw forbidden("only the seller can cancel this offer");
    if (o.status !== "active") throw conflict(`offer is already ${o.status}`);
    o.status = "cancelled";
    o.amountRemainingKwh = 0;
    return this.toPublicOffer(o);
  }

  /** Bilateral contract: delivered into the buyer's rented space (DESIGN §8.4). */
  purchase(buyerId: string, offerId: string, amountKwh: number): EnergyTrade {
    const buyer = this.get(buyerId);
    const o = this.offers.find((x) => x.id === offerId);
    if (!o) throw notFound("Offer");
    if (o.sellerId === buyerId) throw invalid("a household cannot buy its own offer");
    if (o.status !== "active") throw conflict(`offer is not active (status: ${o.status})`);
    if (!Number.isFinite(amountKwh) || amountKwh <= 0) throw invalid("amount must be positive");
    if (amountKwh > o.amountRemainingKwh + EPS) throw invalid(`offer only has ${o.amountRemainingKwh.toFixed(2)} kWh remaining`);

    if (C.RENTED_CAPACITY_KWH - this.rentedUsed() < 0.01) throw conflict("Community storage full, marketplace deliveries paused");
    const space = this.storageSpace(buyer);
    if (amountKwh > space + EPS) {
      throw invalid(`you can receive at most ${space.toFixed(2)} kWh (deliveries go into your space in the shared battery)`);
    }

    const seller = this.get(o.sellerId);
    if (seller.stored.kwh + seller.battery.kwh < amountKwh - EPS) {
      this.shrinkOffers(seller);
      throw conflict("the seller no longer has this energy; the offer was reduced");
    }

    const total = r2(amountKwh * o.pricePerKwh);
    const tx = this.transferTec("TRADE_SETTLEMENT", buyer.accountId, seller.accountId, total, `Marketplace: ${amountKwh.toFixed(2)} kWh at ${o.pricePerKwh.toFixed(3)}`);

    const part = take(seller.stored, amountKwh);
    add(part, take(seller.battery, amountKwh - part.kwh));
    add(buyer.stored, part);
    this.recordCert("CERT_TRANSFER", "SOLAR", seller.accountId, buyer.accountId, part.solar, "Certificates transferred with marketplace energy");
    this.recordCert("CERT_TRANSFER", "WIND", seller.accountId, buyer.accountId, part.wind, "Certificates transferred with marketplace energy");

    o.amountRemainingKwh = r3(o.amountRemainingKwh - amountKwh);
    if (o.amountRemainingKwh < 0.01) {
      o.amountRemainingKwh = 0;
      o.status = "completed";
    }

    const trade: EnergyTrade = {
      id: this.newId("trade"),
      offerId: o.id,
      sellerId: seller.id,
      sellerName: seller.name,
      buyerId: buyer.id,
      buyerName: buyer.name,
      amountKwh: r3(amountKwh),
      pricePerKwh: o.pricePerKwh,
      totalPrice: total,
      status: "completed",
      ledgerTxId: tx?.id ?? null,
      certificates: { solar: r3(part.solar), wind: r3(part.wind) },
      createdAt: Date.now(),
      simTime: this.simMinutes,
    };
    this.trades.push(trade);
    return trade;
  }

  listTrades(householdId?: string): EnergyTrade[] {
    const list = householdId ? this.trades.filter((t) => t.buyerId === householdId || t.sellerId === householdId) : this.trades;
    return [...list].reverse();
  }

  wallet(id: string): Wallet {
    const h = this.get(id);
    return {
      householdId: h.id,
      accountId: h.accountId,
      tokenBalance: r2(h.tec),
      reservedTec: r2(h.reservedTec),
      availableTec: r2(h.tec - h.reservedTec),
      certificates: {
        solar: r3(h.battery.solar + h.stored.solar + h.pendingSell.solar),
        wind: r3(h.battery.wind + h.stored.wind + h.pendingSell.wind),
      },
      greenShare: this.greenShareOf([h.consumed]),
      utility: {
        importedKwh: r2(h.utility.importedKwh),
        importCost: r2(h.utility.importCost),
        exportedKwh: r2(h.utility.exportedKwh),
        exportCredit: r2(h.utility.exportCredit),
        net: r2(h.utility.exportCredit - h.utility.importCost),
      },
      topupsEnabled: C.TOPUPS_ENABLED,
      topupMaxTec: C.TOPUP_MAX_TEC,
    };
  }

  topup(id: string, amount: number): Wallet {
    const h = this.get(id);
    if (!C.TOPUPS_ENABLED) throw forbidden("top-ups are disabled");
    if (!Number.isFinite(amount) || amount <= 0 || amount > C.TOPUP_MAX_TEC) throw invalid(`top-up must be between 0.01 and ${C.TOPUP_MAX_TEC} TEC`);
    const wait = C.TOPUP_COOLDOWN_MS - (Date.now() - h.lastTopupAt);
    if (wait > 0) throw new MockError(`please wait ${Math.ceil(wait / 1000)} s before the next top-up`, 429, "RATE_LIMITED");
    this.transferTec("TOPUP", null, h.accountId, amount, "Top-up (simulated payment)");
    h.lastTopupAt = Date.now();
    this.updateReservation(h);
    return this.wallet(id);
  }

  cashout(id: string, amount: number): Wallet {
    const h = this.get(id);
    if (!C.TOPUPS_ENABLED) throw forbidden("cash-outs are disabled");
    if (!Number.isFinite(amount) || amount <= 0) throw invalid("amount must be positive");
    this.transferTec("CASHOUT", h.accountId, null, amount, "Cash-out (simulated bank transfer)");
    return this.wallet(id);
  }

  ledgerFor(id: string, limit: number): LedgerTx[] {
    this.get(id);
    const out: LedgerTx[] = [];
    for (let i = this.ledger.length - 1; i >= 0 && out.length < limit; i--) {
      if (this.ledger[i].householdIds.includes(id)) out.push(this.ledger[i]);
    }
    return out;
  }

  allLedger(limit: number, asset?: string): LedgerTx[] {
    const out: LedgerTx[] = [];
    for (let i = this.ledger.length - 1; i >= 0 && out.length < limit; i--) {
      const tx = this.ledger[i];
      if (!asset || asset === "ALL" || (asset === "CERT" ? tx.asset === "SOLAR" || tx.asset === "WIND" : tx.asset === asset)) out.push(tx);
    }
    return out;
  }

  ledgerStatus(): LedgerStatus {
    return {
      mode: "simulated-hedera",
      network: "testnet (simulated)",
      operatorAccountId: C.ACCOUNTS.operator,
      tokenIds: { ...C.TOKEN_IDS },
      blocksCount: this.blocks.length,
      transactionsCount: this.ledger.length,
      totalFeesHbar: Math.round(this.feesHbar * 10_000) / 10_000,
      latestHash: this.blocks[this.blocks.length - 1]?.hash ?? "",
    };
  }

  listBlocks(limit: number): BlockchainBlock[] {
    return this.blocks.slice(-limit);
  }

  getBlock(index: number): BlockDetail {
    const b = this.blocks.find((x) => x.index === index);
    if (!b) throw notFound("Block");
    return { ...b, transactions: b.transactionIds.map((id) => this.ledgerIndex.get(id)).filter((t): t is LedgerTx => Boolean(t)) };
  }

  gridStatus(): SharedBatteryStatus {
    const grid = this.gridLimits();
    return {
      capacityKwh: C.SHARED_BATTERY_KWH,
      rented: {
        capacityKwh: C.RENTED_CAPACITY_KWH,
        usedKwh: r2(this.rentedUsed()),
        households: this.all().filter((h) => h.stored.kwh > 0.001).length,
        capPerHouseholdKwh: C.RENTED_CAP_PER_HOUSEHOLD_KWH,
      },
      gridPool: { capacityKwh: C.GRID_POOL_CAPACITY_KWH, chargeKwh: r2(this.gridPool.kwh), greenKwh: r2(greenOf(this.gridPool)) },
      decayPerHour: C.STORAGE_DECAY_PER_HOUR,
      avg24h: grid.avg,
      gridBuysBelow: grid.buyBelow,
      gridSellsAbove: grid.sellAbove,
    };
  }

  microgrid(): MicrogridNode[] {
    return this.all().map((h) => ({
      id: h.id,
      name: h.name,
      type: h.type,
      location: h.location,
      energyType: h.energyType,
      production: h.currentProduction,
      consumption: h.currentConsumption,
      netFlow: r3(h.currentProduction - h.currentConsumption),
      batteryCapacityKwh: h.batteryCapacityKwh,
      batteryChargeKwh: r3(h.battery.kwh),
      storedKwh: r3(h.stored.kwh),
      overflowMode: h.type === "prosumer" ? h.settings.overflowMode : null,
    }));
  }

  checks(): ConservationChecks {
    const hs = this.all();
    const sumOfBalances = r2(hs.reduce((s, h) => s + h.tec, 0) + this.ops.treasury + this.ops.clearing + this.ops.gridStorage);
    const stocks = [...hs.flatMap((h) => [h.battery, h.stored, h.pendingSell]), this.gridPool];
    const stockKwh = stocks.reduce((s, x) => s + x.kwh, 0);
    const heldCerts = stocks.reduce((s, x) => s + greenOf(x), 0);
    const inputs = this.totals.initialStock + this.totals.produced + this.totals.imported;
    const outputs = this.totals.consumed + this.totals.exported + stockKwh;
    const accounted = heldCerts + this.totals.certRetired + this.totals.certToUtility;
    const tol = (n: number) => Math.max(0.01, n * 1e-6);
    return {
      money: { ok: Math.abs(this.totalSupply - sumOfBalances) < 0.011, totalSupply: r2(this.totalSupply), sumOfBalances },
      clearing: { ok: Math.abs(this.ops.clearing) < 0.011, balance: r2(this.ops.clearing) },
      energy: { ok: Math.abs(inputs - outputs) < tol(inputs), inputs: r2(inputs), outputs: r2(outputs) },
      certificates: { ok: Math.abs(this.totals.certIssued - accounted) < tol(this.totals.certIssued), issued: r2(this.totals.certIssued), accounted: r2(accounted) },
      noNegative: {
        ok:
          hs.every((h) => h.tec >= -EPS && h.battery.kwh >= -EPS && h.stored.kwh >= -EPS) &&
          this.ops.treasury >= -EPS &&
          this.ops.clearing >= -EPS &&
          this.ops.gridStorage >= -EPS &&
          this.gridPool.kwh >= -EPS,
      },
    };
  }

  dashboard(): DashboardSummary {
    const hs = this.all();
    const status = this.marketStatus();
    return {
      counts: {
        producers: hs.filter((h) => h.type === "producer").length,
        prosumers: hs.filter((h) => h.type === "prosumer").length,
        consumers: hs.filter((h) => h.type === "consumer").length,
      },
      simTime: this.simMinutes,
      interval: this.interval,
      production: r2(hs.reduce((s, h) => s + h.currentProduction, 0)),
      consumption: r2(hs.reduce((s, h) => s + h.currentConsumption, 0)),
      lastPrice: status.lastPrice,
      avg24h: status.avg24h,
      band: this.band(),
      greenShare: this.greenShareOf(hs.map((h) => h.consumed)),
      tokenCirculation: r2(hs.reduce((s, h) => s + h.tec, 0)),
      treasuryBalance: r2(this.ops.treasury),
      activeOffers: this.offers.filter((o) => o.status === "active").length,
      completedTrades: this.trades.length,
      sharedBattery: this.gridStatus(),
      checks: this.checks(),
      recentTrades: this.listTrades().slice(0, 8),
    };
  }
}

let engine: Engine | null = null;

export function getEngine(): Engine {
  if (!engine) engine = new Engine();
  return engine;
}

export function resetEngine(): Engine {
  engine?.stop();
  engine = new Engine();
  return engine;
}
