# Green Wallet — Energy Market Design

**Status:** agreed design, not yet implemented. This document is the target the
codebase will be brought to, phase by phase (see [§11 Implementation plan](#11-implementation-plan)).
Every rule below was agreed situation by situation; where a real-world system
inspired a rule, it is named so the choice can be defended in the report.

> Numbers marked *(config)* are defaults and become environment variables
> (full list in [§10](#10-configuration-defaults)).

---

## Contents

0. [Global assumptions](#0-global-assumptions)
1. [Prosumer with surplus — own battery and overflow modes](#1-prosumer-with-surplus--own-battery-and-overflow-modes)
2. [When a producer gets paid — certificates, not minting](#2-when-a-producer-gets-paid--certificates-not-minting)
3. [Price principle — the band](#3-price-principle--the-band)
4. [Auction mechanics](#4-auction-mechanics)
5. [Household in deficit — end to end](#5-household-in-deficit--end-to-end)
6. [Shared battery and startup](#6-shared-battery-and-startup)
7. [Money and the ledger](#7-money-and-the-ledger)
8. [Manual marketplace next to the auction](#8-manual-marketplace-next-to-the-auction)
9. [Invariants (conservation checks)](#9-invariants-conservation-checks)
10. [Configuration defaults](#10-configuration-defaults)
11. [Implementation plan](#11-implementation-plan)
12. [Future work (out of scope)](#12-future-work-out-of-scope)
13. [Real-world references](#13-real-world-references)
14. [Changes from the original battery plan](#14-changes-from-the-original-battery-plan)

---

## 0. Global assumptions

### 0.1 Roles

| Role | What it is | Consumes | Own battery | How it takes part |
|---|---|---|---|---|
| **Producer** | Large generator (solar farm, wind farm) | ≈ 0 | No | Sells its whole output through the auction; bids low with large volumes |
| **Prosumer** | Household that generates **and** consumes | Yes | Yes (optional, capacity set at registration) | Sells surplus, buys when in deficit |
| **Consumer** | Household that only consumes | Yes | No | Buys only |

### 0.2 The main utility grid

The main utility grid is **outside** the microgrid and is the **last resort** on both sides:

- it **always buys** leftover energy at a fixed **export price = floor** (0.05 TEC/kWh *(config)*),
- it **always sells** missing energy at a fixed **import price = ceiling** (0.30 TEC/kWh *(config)*).

Nobody is ever cut off. Dealings with the utility are real money on a
**utility statement**, not TEC (see [§7.4](#74-utility-statement-outside-tec)).

### 0.3 Regulation

Stated assumption for the report:

> *We assume the microgrid operates as a licensed energy community in a
> regulatory sandbox, where peer-to-peer trading between members is permitted
> (as enabled in the EU by the renewable-energy-community framework).*

### 0.4 Blockchain: simulated Hedera ledger

- The app runs in **local mode only**. If `HEDERA_*` variables are set, the app
  logs a warning and stays local. The Hedera adapter is kept (behind the
  `BlockchainService` interface) but is **not updated** for the new model.
- Every account gets a **Hedera-style ID** (`0.0.xxxxx`), every transaction a
  Hedera-style transaction ID (`0.0.1001@<seconds>.<nanos>`).
- Every transaction carries a **simulated network fee** (0.0001 HBAR *(config)*)
  marked *paid by operator*.
- The existing local **hash-chained blocks** are kept (tamper-evidence, explorer page).
- The app is presented as *"Hedera-ready, running on a simulated ledger"*.

**What Hedera is for in this project:** a **public notary** — verifiable
history of payments and green certificates. It is **not** decentralization:
the platform holds the keys, is the treasury, pays the fees and enforces the
market rules in its own code.

**HBAR vs TEC:** TEC is the microgrid's money (a token living on Hedera); HBAR
is only the network fee ("gas"). Households never hold or need HBAR.

### 0.5 The operator

The operator is the platform itself (the company/cooperative running the
microgrid). It:

1. **pays every network fee** (sponsored fees — users never need crypto),
2. runs the **treasury** (bank), the **clearing** account (auction middleman)
   and the **grid storage** account (shared-battery trader) — see [§7.2](#72-the-operators-three-accounts),
3. funds the sponsored fees from the grid pool's trading margin.

### 0.6 Time: one simulated clock

- A single **market clock** owns simulated time. Each **interval** lasts
  5 s real time *(config)* and represents 30 simulated minutes *(config)*.
- The simulation reads this clock to generate readings; the auction clears at
  the end of every interval; storage decay and offer expiry are computed in
  **simulated** hours.
- The clock starts at **06:00** simulated time.
- The market clock runs even if the simulation is disabled (manual readings
  still settle).

### 0.7 Settlement model

Real electricity is not "sent" to a buyer — the grid carries it by physics.
Trading is a **financial settlement over meter readings**, done per interval.
In this document "delivered" means "settled".

---

## 1. Prosumer with surplus — own battery and overflow modes

### 1.1 Rules

1. **Own battery first** — free, it is the household's own energy. The battery
   holds the kWh the household can later use or sell.
2. **No double counting.** A kWh is either in the battery, stored in the shared
   battery, sold, consumed, exported or lost — never two at once.
3. **Sold kWh leave the battery immediately** at settlement.
4. Once the battery is full, the prosumer's **overflow mode** decides:
   - **`sell`** — overflow is offered in the auction this interval
     (unmatched → export at the floor).
   - **`store`** — overflow goes into the household's **rented space in the
     shared battery**; the household still owns it
     (see [§6](#6-shared-battery-and-startup)).
     If the rented space is full or the household hit its cap, it falls back
     to `sell` automatically.
5. **Opt-out of the auction** (toggle): `sell`-mode overflow goes straight to
   export; deficits go straight to import.

### 1.2 Sell from battery (optional)

Setting: *"sell from my battery when the price is ≥ X, but keep Y% for myself."*

- Default **off** — the battery is for self-consumption.
- When on, the battery bids in the auction at minimum price X for
  `charge − Y% × capacity − kWh reserved in offers`.

### 1.3 Surplus path (summary)

```
Prosumer surplus:  own battery → [store mode] rented storage → auction → export (floor)
Producer surplus:                                              auction → export (floor)
```

### 1.4 Edge cases

- Battery capacity 0 (no battery): every surplus goes straight to overflow mode.
- Consumers always have capacity 0 (enforced by the backend, not only hidden in the UI).
- Producers have no battery and no overflow mode (always `sell`).
- Headroom is clamped at 0 if capacity is ever lower than the charge.

---

## 2. When a producer gets paid — certificates, not minting

### 2.1 The problem with the current code

Today every kWh of surplus is **minted 1:1 into TEC at production**. This:
pays twice (mint + sale), pays 5–10× the market price, pays for energy the
household consumes itself, lets TEC exist without backing energy once storage
decays, and creates money with sunshine rather than demand (inflation).

### 2.2 The rule

- **At production:** a **green certificate** is issued (who, when, how much,
  source) — **proof, not money**.
- **TEC moves only when energy changes hands** (auction, marketplace, grid pool trades).
- Producers and prosumers start at 0 TEC and earn by selling.
- Using your own battery/storage moves no money; the gain is the import avoided.

### 2.3 Certificates follow the kWh

Two certificate types: **SOLAR** and **WIND**, measured in kWh (on real Hedera:
two HTS tokens).

Every energy stock (a household battery, a household's rented storage, the
grid pool) carries its certificates alongside its kWh. Moving kWh out of a
stock moves the **proportional share** of that stock's certificates.

| Energy event | Certificate event |
|---|---|
| Produced | **Issued** to the producer/prosumer (issue record keeps producer, time, amount, source) |
| Self-consumed in the same reading | Issued and **retired** immediately |
| Sold (auction or marketplace) | **Transferred** to the buyer (proportional share) |
| Bought/sold by the grid pool | Held by the grid pool, passed on when it sells |
| **Consumed** | **Retired** — "this green energy was used" (prevents double claims) |
| Lost to storage decay | Retired as a loss |
| Exported to the utility | Handed to the utility |

Imported utility energy has **no certificate** ("grey"). The grid pool's
initial charge is grey (pre-charged from the utility).

**Green share KPI** — per household and for the microgrid:
*"Your green share this period: 78% (12 kWh solar, 4 kWh wind, 4.5 kWh grey)"*.

**Known limit:** once combined in a stock, certificates keep their **source
type** but not the exact producer; the issue record keeps the origin.

---

## 3. Price principle — the band

```
 ceiling ─── import price, utility sells to households (0.30)
    │        ← nobody buys locally above this: they would import
    │   ▲
    │   ▼  local auction price moves here with supply and demand
    │        ← nobody sells locally below this: they would export
 floor ───── export price, utility buys from households (0.05)
```

- The band is **why local trading exists**: both sides beat the utility.
- Inside the band the price comes **only from the auction** ([§4](#4-auction-mechanics)).
- Manual marketplace prices must also lie inside the band ([§8](#8-manual-marketplace-next-to-the-auction)).

### 3.1 Where the floor and ceiling come from

The floor and ceiling are **not computed by the market** — they are the
utility's own prices. Real utilities build them from cost components, and we
do the same so every number can be explained:

```
ceiling (import) = wholesale energy price + network fee + taxes & levies + supplier margin
floor   (export) = wholesale energy price − utility balancing cost
middle of band   = (floor + ceiling) / 2
```

| Component | Meaning | Default *(config)* |
|---|---|---|
| Wholesale energy price | what the utility pays for energy on the national market | 0.08 |
| Network fee | cost of carrying energy over the national grid | 0.09 |
| Taxes & levies | government charges on retail electricity | 0.08 |
| Supplier margin | the utility's retail margin | 0.05 |
| Balancing cost | what the utility keeps for absorbing unpredictable exports | 0.03 |

With the defaults: **ceiling = 0.08 + 0.09 + 0.08 + 0.05 = 0.30**,
**floor = 0.08 − 0.03 = 0.05**, **middle = 0.175** (TEC/kWh).

- Real-world basis: a retail bill is roughly one third energy, one third
  network, one third taxes (varies by country); exports are paid about the
  wholesale value minus the utility's costs (net billing), or a regulated
  feed-in tariff.
- Validation at boot: every component ≥ 0 and **floor < ceiling**, otherwise
  the app refuses to start.
- Fixed for the whole simulation. *Future work:* a daily wholesale curve
  (time-of-use), which would make the band itself move by hour.

---

## 4. Auction mechanics

Real-world model: **uniform-price double auction** per interval, as on
electricity spot exchanges (EPEX Spot, Nord Pool) and local-market pilots.

### 4.1 Bids are automatic

A household never types bids. An automatic agent (like a real home energy
management system) builds them every interval:

- **Quantity** comes from the meter/stocks:
  - seller: surplus left after own battery (`sell` mode), stored energy
    (`store` mode, auto-offered), optional battery sell ([§1.2](#12-sell-from-battery-optional)),
    all excluding kWh reserved in marketplace offers;
  - buyer: deficit left after own battery and own stored energy.
- **Price limits** are one-time settings (like a thermostat):
  - `minSellPrice` — default **floor** ("always beat export"),
  - `maxBuyPrice` — default **ceiling** ("always beat import"),
  - `storeMinPrice` — default **middle of the band** (storing means waiting for a better price),
  - `batterySellPrice` / `batteryKeepPercent` — optional ([§1.2](#12-sell-from-battery-optional)).
- Seed households get **varied** limits — if everyone used defaults the price
  would always sit mid-band and never move.
- Producers bid **low** (sun and wind cost ~nothing) with large volumes.
- **Budget check:** a buyer's quantity is capped at
  `available TEC / maxBuyPrice`; that TEC is **reserved** until clearing
  (real exchanges require collateral).
- A household is never both buyer and seller in the same interval (a deficit
  consumes own stocks first).

### 4.2 Clearing

1. Sort sellers by price ascending (the *merit order*), buyers by price descending.
2. Match from the top until the next seller asks more than the next buyer offers.
3. **One price for everyone:** halfway between the last matched seller's and
   the last matched buyer's limit (*k-double auction, k = 0.5*).
4. A bid is a **limit, not the price paid**: a buyer bidding 0.30 who clears at
   0.08 pays 0.08.
5. The last matched bid may be **partially filled**; **ties** at the same price
   share the volume **pro rata**.
6. The price always lies within the band (limits are bounded by floor/ceiling).

### 4.3 Settlement

- The **clearing account** is the central counterparty: buyers pay clearing,
  clearing pays sellers. One payment per participant; rounding leftovers stay
  in clearing (must stay ≈ 0).
- Certificates are allocated pro rata from sellers to buyers.
- kWh bought in the auction are consumed immediately (certificates retired).
- **Unmatched** energy (*imbalance*) goes to the last resort:
  unmatched supply → export at floor; unmatched demand → import at ceiling.
- One **summary record per auction** is written to the ledger (clearing price,
  volume, participant count) — mirrors Hedera Consensus Service usage.
- The clearing price of every interval is saved as **price history**
  (chart; 24-hour average for the grid pool trader). If nothing matched, the
  interval is recorded as *no clearing*.

### 4.4 Worked examples (floor 0.05, ceiling 0.30)

**Noon**

| Sellers | | Buyers | |
|---|---|---|---|
| Solar farm | 20 kWh ≥ 0.06 | Consumer 1 | 4 kWh ≤ 0.30 |
| Prosumer A | 3 kWh ≥ 0.08 | Consumer 2 | 3 kWh ≤ 0.25 |
| Prosumer B | 2 kWh ≥ 0.12 | Consumer 3 | 2 kWh ≤ 0.10 |

The solar farm covers all 9 kWh. Last matched pair: 0.06 / 0.10 → **price 0.08**.
11 kWh of the farm plus A's and B's offers go unmatched → export.

**Evening** (same buyers; only prosumer B sells 2 kWh ≥ 0.12 from its battery)

Consumer 1 gets 2 kWh. Last matched pair 0.12 / 0.30 → **price 0.21**.
7 kWh of demand unmatched → import at 0.30.

---

## 5. Household in deficit — end to end

Real-world model: use the cheapest sources first; leftovers go to a
*supplier of last resort*, which never cuts you off.

### 5.1 Order

| Step | Source | Cost | Settles |
|---|---|---|---|
| 1 | **Own battery** | free | immediately at the reading |
| 2 | **Own stored energy** in the shared battery (includes marketplace purchases) | free (decay already paid) | immediately at the reading |
| 3 | **Auction** (sellers include neighbours, producers and the grid pool) | clearing price, TEC | end of interval |
| 4 | **Utility import** | ceiling price, utility statement | end of interval |

```
Deficit:  own battery → own stored energy → auction → import (ceiling)
```

### 5.2 Edge cases

1. **Out of TEC:** no budget → no bid → straight to import. Never cut off.
2. **Partly affordable:** bids what it can afford; the rest is imported.
3. **Opted out of the auction:** step 2 → step 4.
4. **Manual reading:** the response reports steps 1–2 done and says the rest
   settles at the end of the current interval.
5. **Evening peak:** few sellers (batteries set to sell, stored energy, grid pool)
   → price near the ceiling, many households import. This is realistic and is
   when storage becomes valuable.

---

## 6. Shared battery and startup

Real-world model: community batteries sell fixed slices of capacity to
households and keep the rest for the operator, who trades it (buy cheap, sell dear).

### 6.1 Split

One physical battery run by the operator, **100 kWh** *(config)*, two fixed compartments:

| Compartment | Share | Owner | Rule |
|---|---|---|---|
| **Rented** | 60% (60 kWh) | Households | first come first served, **max 10 kWh per household** |
| **Grid pool** | 40% (40 kWh) | Operator | trades in the auction |

Compartments are fixed: neither side can use the other's empty space.

### 6.2 Storage fee = decay

- Stored household kWh shrink by **1% per simulated hour** *(config)*
  (≈ 11% over a 12-hour night — comparable to real round-trip losses).
- The decayed kWh are **added to the grid pool** (the operator is paid in energy).
  Their certificates are retired as a loss.
- Amounts below **0.01 kWh** are cleared to zero.
- The grid pool itself does **not** decay.
- Storing pays off only if the later price is ≳ 12% higher — true with the
  auction's noon/evening spread, so storing is worthwhile but not free.

### 6.3 Stored energy — what the owner can do

1. **Use it** for their own deficit (step 2 of [§5](#5-household-in-deficit--end-to-end)).
2. **Auto-sell** in the auction at `storeMinPrice` (default mid-band) —
   only for **prosumers in `store` mode**. Consumers' stored (purchased)
   energy is **never** auto-sold.
3. **List it** manually on the marketplace ([§8](#8-manual-marketplace-next-to-the-auction)).

### 6.4 Grid pool trader

Every interval the grid pool submits both bids (they can never match each other):

- **Buy:** quantity = free grid-pool space, max price = **0.9 × 24h average price**.
- **Sell:** quantity = grid-pool charge, min price = **1.1 × 24h average price**.
- No history yet (startup, or no clearing in the last 24 h): the average is the
  **middle of the band**.
- Paid from / to the **grid storage account**; its margin is the operator's
  profit and funds the sponsored network fees.

### 6.5 Startup

- **Grid pool starts 50% charged** *(config)* (pre-charged from the utility,
  grey energy) so the first evening has something to sell.
- **Rented compartment starts empty.**
- The simulated clock starts at 06:00.
- **First readings** are recorded at boot; the **first auction** clears them
  at the end of the first interval.

### 6.6 Energy profiles per role

| Role | Production | Consumption |
|---|---|---|
| Producer (solar farm) | large solar curve | ≈ 0 |
| Producer (wind farm) | large, steadier, more random curve | ≈ 0 |
| Prosumer | small rooftop solar curve | household curve (morning and evening peaks) |
| Consumer | 0 | household curve |

### 6.7 Seed

Names and locations may be reused from the current seed; roles, batteries and
limits change as follows.

| Household | Role | Battery (start) | Mode | Price limits | Start TEC |
|---|---|---|---|---|---|
| Solar farm | producer | — | sell | sell ≥ 0.06 | 0 |
| Wind farm | producer | — | sell | sell ≥ 0.07 | 0 |
| Prosumer 1 | prosumer | 5 kWh (half full) | sell | sell ≥ 0.08, buy ≤ 0.25 | welcome grant |
| Prosumer 2 | prosumer | 15 kWh (half full) | store | sell ≥ 0.10, store ≥ 0.18, buy ≤ 0.22, battery sell ≥ 0.24 keep 40% | welcome grant |
| Prosumer 3 | prosumer | none | sell | sell ≥ 0.05, buy ≤ 0.30 | welcome grant |
| Prosumer 4 | prosumer | 8 kWh (half full) | store | sell ≥ 0.09, store ≥ 0.20, buy ≤ 0.28 | welcome grant |
| Prosumer 5 | prosumer | none | sell | sell ≥ 0.06, buy ≤ 0.30 | welcome grant |
| Consumer 1 | consumer | — | — | buy ≤ 0.30 | grant + seed top-up |
| Consumer 2 | consumer | — | — | buy ≤ 0.25 | grant + seed top-up |
| Consumer 3 | consumer | — | — | buy ≤ 0.20 | grant + seed top-up |
| Consumer 4 | consumer | — | — | buy ≤ 0.15 | grant + seed top-up |

- Prosumers 3 and 5 have **no battery** — the battery-less path is visible immediately.
- Consumer 4 only buys ≤ 0.15 — the "prices too high, import instead" path is visible in the evening.
- Seed top-ups are ledger transactions, visible in history.
- Initial battery charge in the seed is grey (no certificates) unless issued by a seed reading.

### 6.8 Edge cases

1. Grid pool full → its buy quantity is 0; extra surplus is exported.
2. Grid pool empty → it does not sell.
3. Capacity lowered below the current charge → nothing is lost; no new energy
   enters until the level drops below the new capacity.
4. A household leaves with stored kWh → sold to the grid pool at the floor,
   then its TEC is cashed out ([§7.7](#77-edge-cases)).
5. Public status (Microgrid page): total, rented used, grid-pool charge,
   current price, 24h average.

---

## 7. Money and the ledger

Real-world model: a **stable token** backed 1:1 by the operator's reserve
(stablecoin / e-money); certificates in a separate registry.

### 7.1 Value

- **1 TEC = 1 unit of real money** (e.g. 1 €), always.
- Money has **2 decimals** (cents); kWh are rounded to 0.01 kWh for display.
- Floor 0.05 and ceiling 0.30 TEC/kWh match typical real feed-in and retail prices.

### 7.2 The operator's three accounts

| Account | Role | Rule |
|---|---|---|
| **Treasury** | bank: holds the reserve, creates/destroys TEC, pays welcome grants | starts with **10,000 TEC** *(config)* (matches `initToken`) |
| **Clearing** | auction central counterparty | back to ≈ 0 after every auction |
| **Grid storage** | the grid pool's trading account | profit funds sponsored fees |

The ledger therefore moves TEC between **accounts** (households *and* operator
accounts), not only between households.

### 7.3 How TEC enters and leaves

| Event | Movement | Real-world equivalent |
|---|---|---|
| **Top-up** | household pays money → treasury **creates** TEC for it | loading a payment app |
| **Cash-out** | household returns TEC → treasury **destroys** it, sends money | withdrawal to a bank |
| **Welcome grant** | treasury → new prosumer/consumer (**transfer**, 10 TEC *(config)*) | sign-up bonus |
| Auction | buyers → clearing → sellers | exchange settlement |
| Grid pool trades | grid storage ↔ clearing | storage operator |
| Marketplace | buyer → seller directly | bilateral contract |

- Top-up/cash-out are **simulated** (fake payment), capped at **100 TEC per
  top-up** *(config)* and rate-limited, behind a **demo flag** that is off in
  production (like manual readings).
- Producers (companies) receive no welcome grant.
- The welcome grant is a **real ledger transaction** — registration never
  writes a balance directly.
- Seed consumers additionally receive a **seed top-up** (ledger transaction).

### 7.4 Utility statement (outside TEC)

- The utility is outside the microgrid: **real money**, net billing, **off the ledger**.
- **Import** = debit at the ceiling; **export** = credit at the floor.
- Shown in the wallet as its own block, e.g.
  *"Utility statement this period: imported 12 kWh (−3.60), exported 20 kWh (+1.00), total −2.60"*.

### 7.5 Certificates on the ledger

SOLAR and WIND certificates are ledger assets: issue, transfer and retire are
ledger transactions (rules in [§2.3](#23-certificates-follow-the-kwh)).

### 7.6 What goes on the simulated ledger

| On the ledger | Not on the ledger |
|---|---|
| every TEC movement | meter readings (only the certificates they create) |
| certificate issue / transfer / retire | the utility statement |
| one summary record per auction | |

Each transaction has a Hedera-style ID and a simulated fee paid by the operator.
Several transactions per household per interval is fine locally; a real Hedera
deployment would **batch** them.

### 7.7 Edge cases

1. **Reserved TEC** (during an auction) cannot be spent elsewhere; the wallet
   shows **available** and **reserved** separately.
2. **No negative balance** anywhere — every movement is checked; whatever TEC
   cannot cover goes to the utility statement.
3. **Cash-out** only of the available part.
4. **Household leaves:** stored kWh sold to the grid pool at the floor, then all
   TEC cashed out.
5. **Top-up abuse (demo):** per-top-up cap + rate limit.
6. **Treasury reserve low:** startup warning below a threshold *(config)*.

---

## 8. Manual marketplace next to the auction

Real-world model: **bilateral contracts** alongside the **spot market**;
a contract names a delivery point.

### 8.1 Role

- **Auction** = automatic everyday layer. **Marketplace** = manual layer:
  the seller picks the price, the buyer picks the seller.
- The create-offer form shows the **current auction price and the 24h average**
  as a suggestion.

### 8.2 What can be listed — "you can only sell what you own now"

- **Prosumers:** battery energy above their keep-reserve + rented stored energy.
- **Producers:** no storage → auction only (forward contracts are future work).
- **Consumers:** may resell stored energy they bought (same rule).
- Price must be **inside the band** (0.05–0.30).

### 8.3 While listed

- Listed kWh are **reserved**: they stay physically in the battery/storage,
  still occupy space, and are **excluded from the auction**.
- An offer **shrinks** if the seller's own deficit uses the kWh, or if the
  stored kWh decay. Buyers always see the true remaining amount.
- Offers **expire after 24 simulated hours** *(config)*; reserved kWh are released.

### 8.4 Purchase and delivery

- **Delivery point = the buyer's rented space in the shared battery**
  (physically: seller's stock discharges into the community battery in the
  buyer's name). This prevents free, loss-less "virtual storage".
- Seller side: kWh taken from **rented storage first** (it decays), then battery.
- Buyer side: the energy follows storage rules — used at the next deficit,
  decays 1%/h, counts toward the 10 kWh cap.
- **Money:** buyer → seller directly (no clearing house).
- **Certificates:** transferred with the kWh.
- Not enough free space → purchase capped at the buyer's free space with a
  clear message (e.g. *"You can receive at most 3.2 kWh"*).
- No platform fee.

### 8.5 Kept from the current code

- Two-step **reserve → execute** trade flow (`TradeService`) — double-spend guard.
- No buying your own offer; balance checks before paying.

### 8.6 Edge cases

1. Offer shrinks during a purchase → remaining amount re-checked inside one DB
   transaction; the purchase fails cleanly if not enough is left.
2. Buyer has no rented space → purchase capped or refused with explanation.
3. Rented compartment completely full → marketplace deliveries pause for
   everyone; the UI says *"Community storage full, marketplace deliveries paused"*.
4. Wash trading with a second account cannot be detected in the demo
   (real platforms use KYC) — noted in the report.

---

## 9. Invariants (conservation checks)

Tests assert these after every scenario:

1. **Money:** Σ all account balances (households + treasury + clearing + grid
   storage) = total TEC in existence.
2. **Clearing:** clearing account ≈ 0 (within rounding) after every auction.
3. **Energy:** produced + imported = consumed + exported + stored (batteries,
   rented, grid pool) + decay losses.
4. **Certificates:** issued = held + retired + handed to the utility.
5. **No negative balance:** TEC, kWh stocks, storage compartments.

---

## 10. Configuration defaults

Indicative names; final names are fixed during implementation.

| Variable | Default | Section |
|---|---|---|
| `MARKET_INTERVAL_MS` | 5000 | [§0.6](#06-time-one-simulated-clock) |
| `MARKET_INTERVAL_SIM_MINUTES` | 30 | [§0.6](#06-time-one-simulated-clock) |
| `WHOLESALE_PRICE_TEC` | 0.08 | [§3.1](#31-where-the-floor-and-ceiling-come-from) |
| `NETWORK_FEE_TEC` | 0.09 | [§3.1](#31-where-the-floor-and-ceiling-come-from) |
| `TAXES_TEC` | 0.08 | [§3.1](#31-where-the-floor-and-ceiling-come-from) |
| `SUPPLIER_MARGIN_TEC` | 0.05 | [§3.1](#31-where-the-floor-and-ceiling-come-from) |
| `UTILITY_BALANCING_COST_TEC` | 0.03 | [§3.1](#31-where-the-floor-and-ceiling-come-from) |
| → floor (export), derived | 0.05 | [§3.1](#31-where-the-floor-and-ceiling-come-from) |
| → ceiling (import), derived | 0.30 | [§3.1](#31-where-the-floor-and-ceiling-come-from) |
| `HOUSEHOLD_DEFAULT_BATTERY_CAPACITY_KWH` (prosumer registration) | 10 | [§1](#1-prosumer-with-surplus--own-battery-and-overflow-modes) |
| `SHARED_BATTERY_CAPACITY_KWH` | 100 | [§6.1](#61-split) |
| `SHARED_BATTERY_RENTED_SHARE` | 0.6 | [§6.1](#61-split) |
| `RENTED_CAP_PER_HOUSEHOLD_KWH` | 10 | [§6.1](#61-split) |
| `STORAGE_DECAY_PER_SIM_HOUR` | 0.01 | [§6.2](#62-storage-fee--decay) |
| `GRID_POOL_INITIAL_SHARE` | 0.5 | [§6.5](#65-startup) |
| `GRID_POOL_BUY_BELOW_AVG` | 0.9 | [§6.4](#64-grid-pool-trader) |
| `GRID_POOL_SELL_ABOVE_AVG` | 1.1 | [§6.4](#64-grid-pool-trader) |
| `OFFER_EXPIRY_SIM_HOURS` | 24 | [§8.3](#83-while-listed) |
| `TREASURY_INITIAL_TEC` | 10000 | [§7.2](#72-the-operators-three-accounts) |
| `TREASURY_LOW_WARNING_TEC` | 1000 | [§7.7](#77-edge-cases) |
| `WELCOME_GRANT_TEC` (replaces `SIGNUP_GRANT_TEC`) | 10 | [§7.3](#73-how-tec-enters-and-leaves) |
| `TOPUPS_ENABLED` | on in dev, off in prod | [§7.3](#73-how-tec-enters-and-leaves) |
| `TOPUP_MAX_TEC` | 100 | [§7.3](#73-how-tec-enters-and-leaves) |
| `SIMULATED_FEE_HBAR` | 0.0001 | [§0.4](#04-blockchain-simulated-hedera-ledger) |

Default per-household price settings: `minSellPrice` = floor,
`maxBuyPrice` = ceiling, `storeMinPrice` = mid-band, battery sell off.

---

## 11. Implementation plan

Each phase ends with a **working, demonstrable** app; all tests (existing,
rewritten and new) pass before the next phase starts. Frontend work is done
inside each phase. The local dev DB (`backend/data/green-wallet.db*`) is
wiped whenever the schema changes (free in local mode; auto-seed rebuilds it).

### Phase 0 — Foundations: money and ledger

- New schema; DB wipe; auto-seed.
- Local mode only; warning if `HEDERA_*` is set.
- Hedera-style account and transaction IDs; simulated fees paid by the operator.
- Operator accounts (treasury, clearing, grid storage); ledger moves TEC
  between any accounts.
- Welcome grant as a treasury ledger transaction (removes the direct balance
  write at registration); simulated top-up and cash-out behind a demo flag.
- Money invariant test.
- **Frontend:** wallet top-up / cash-out, history with Hedera-style IDs;
  explorer shows fees.
- **Demo:** grant and top-ups visible with IDs and fees.

### Phase 1 — Roles and certificates

- New seed roles (2 producers, 5 prosumers, 4 consumers) and per-role energy profiles.
- Remove minting at production; SOLAR/WIND certificates issued at production,
  transferred on sale, retired on consumption.
- Green-share KPI per household and microgrid.
- *Transitional:* until batteries exist, sellable kWh keep today's
  `energyBalance` behaviour so the marketplace still works.
- Certificate invariant test; rewrite tests that expect minting.
- **Frontend:** certificates in wallet, green share on dashboard.
- **Demo:** "78% green"; producers and prosumers visibly different.

### Phase 2 — Batteries, shared battery, utility

- Household battery, overflow mode, keep-reserve and price-limit settings
  (limits stored now, used in phase 3); battery capacity at registration
  (prosumers only).
- Shared battery with two compartments, 10 kWh cap, 1%/h decay into the grid
  pool, grid pool starting 50% full.
- Utility statement (import debit, export credit).
- Surplus/deficit paths **without the auction yet**:
  battery → storage → export / battery → storage → import.
- Marketplace rewired: offers reserve from battery/storage, delivery into the
  buyer's rented space, expiry, band check, shrinking. Transitional
  `energyBalance` removed.
- Energy invariant test.
- **Frontend:** settings page, Microgrid shared-battery panel, battery column
  on Households, battery field at registration, utility statement in wallet.
- **Demo:** batteries fill at noon and empty at night; stored energy decays;
  the utility statement grows in the evening.

### Phase 3 — Auction

- Market clock separate from the simulation; readings collected per interval,
  settled at interval end.
- Automatic bids, uniform-price clearing (k = 0.5), partial fills, pro-rata
  ties, TEC reservation, clearing account, pro-rata certificates.
- Grid pool trader (24h average); stored-energy auto-offer; battery-sell option;
  auction opt-out.
- Price history and its API; one ledger summary record per auction.
- Clearing invariant test.
- **Frontend:** price chart, bid limits in settings, available/reserved balance.
- **Demo:** price drops at noon, rises in the evening.

### After phase 3

Update [ARCHITECTURE.md](ARCHITECTURE.md) and [API.md](API.md) to match.

### Existing tests that will be rewritten on purpose

- `measurement.test.ts` — expects minting at production.
- `marketplace.test.ts`, `trade.test.ts` — rely on the old `energyBalance`.
- `token.test.ts`, `api.test.ts`, `security.test.ts` — adjusted to new balances
  and endpoints.

---

## 11b. Frontend first — mock mode and API contract

The frontend was built first, against an **in-browser implementation of this
design** (`frontend/src/mock/`), so every screen works before the backend
phases start.

- `VITE_API_MODE=mock` (default): all calls are answered by the mock engine —
  market clock, batteries, shared battery, auction, certificates, ledger.
  Nothing is stored; a page reload restarts the demo.
- `VITE_API_MODE=real`: calls go to the backend through the Vite proxy. Switch
  only once the backend implements the contract below.
- `frontend/src/types.ts` is the **API contract**: the backend must return
  exactly these shapes. `frontend/src/mock/engine.ts` is a readable reference
  implementation of the rules in this document (auction clearing, stocks with
  certificates, decay, settlement order, invariants).

| Method | Path | Returns | Auth |
|---|---|---|---|
| POST | `/auth/login`, `/auth/register` | `{ household, token }` | — |
| GET | `/households`, `/households/:id` | `Household[]`, `Household` | — |
| GET | `/households/:id/history?limit` | `EnergyMeasurement[]` (with `flow`) | — |
| GET / POST | `/households/me/settings` | `HouseholdSettings` | yes |
| POST | `/energy/measurements` | `MeasurementResult` | yes |
| GET | `/market/status` | `MarketStatus` (clock, band + components, last price, 24h avg) | — |
| GET | `/market/price-history?limit` | `PricePoint[]` | — |
| GET | `/market/auctions/latest` | `AuctionResult` (all bids with matched kWh) | — |
| GET | `/market/my-bid` | `MyBidPreview` | yes |
| GET | `/market/offers`, `/market/offers/mine` | `EnergyOffer[]` | mine: yes |
| POST | `/market/offers`, `/market/offers/:id/cancel`, `/market/offers/:id/purchase` | `EnergyOffer` / `EnergyTrade` | yes |
| GET | `/trades?householdId` | `EnergyTrade[]` | — |
| GET | `/wallet/:id` | `Wallet` (own only) | yes |
| POST | `/wallet/topup`, `/wallet/cashout` | `Wallet` | yes |
| GET | `/tokens/history/:id?limit` | `LedgerTx[]` (own only) | yes |
| GET | `/transactions?limit&asset=ALL\|TEC\|CERT\|RECORD` | `LedgerTx[]` | — |
| GET | `/blockchain/status`, `/blockchain/blocks`, `/blockchain/blocks/:i` | `LedgerStatus`, `BlockchainBlock[]`, `BlockDetail` | — |
| GET | `/grid/status` | `SharedBatteryStatus` | — |
| GET | `/microgrid`, `/dashboard` | `MicrogridNode[]`, `DashboardSummary` (includes the §9 checks) | — |
| POST | `/sim/pause`, `/sim/resume`, `/sim/step`, `/sim/reset` | `MarketStatus` — demo controls, dev only | yes |

---

## 12. Future work (out of scope)

- **Real Hedera:** custodial accounts vs user wallets, forwarding TEC to
  household accounts, transaction batching, the 0.01 TEC on-chain minimum,
  certificates via Hedera Guardian.
  Recommended real-world path: start with one omnibus account + Hedera
  Consensus Service log (cheap, auditable), move to per-user accounts or
  wallets once there are real users and a legal framework.
- **Forward contracts / PPAs** — producers selling future production.
- **Renting out private batteries** between neighbours.
- **Smarter bidding** — bid curves, forecasts instead of single limits.
- **KYC** against wash trading; **real payments** for top-up / cash-out.
- **Signed smart-meter readings** instead of simulated/self-reported ones.

---

## 13. Real-world references

Verify details before citing in the report.

| Our design | Real-world counterpart |
|---|---|
| P2P trading between neighbours | Brooklyn Microgrid (New York, 2016); Power Ledger trials (Australia, Asia) |
| Settlement per interval over meter data | EU renewable energy communities; French *autoconsommation collective* |
| Uniform-price double auction | EPEX Spot, Nord Pool |
| Shared battery with rented slices | Community batteries (e.g. PowerBank, Western Australia); German "solar cloud" / sonnenCommunity offers |
| Floor/ceiling band | Feed-in tariffs / net billing (export paid far below import) |
| Stable internal token | Power Ledger's fiat-pegged internal credit; stablecoins / e-money |
| Green certificates | EU Guarantees of Origin; Hedera Guardian; Energy Web |
| Operator pays fees, custodial accounts | Standard consumer-app practice (sponsored fees) |

**Honest context for the report:** most blockchain P2P energy trading projects
stayed pilots because of regulation, not technology; where blockchain succeeded
in energy is mainly **certificates of origin**, not payments.

---

## 14. Changes from the original battery plan

The first battery/grid-storage plan was revised during design review:

| Original plan | Now |
|---|---|
| Surplus minted 1:1 into TEC, also in the battery | Certificates at production; TEC only on sale ([§2](#2-when-a-producer-gets-paid--certificates-not-minting)) |
| Battery charge independent of sellable kWh (double counting) | Battery holds the sellable kWh ([§1](#1-prosumer-with-surplus--own-battery-and-overflow-modes)) |
| Tier 1 "local balancing" as a price signal only | Real delivery through the auction ([§4](#4-auction-mechanics)) |
| Tier 2 fixed 0.8× price, tier 3 0.4× | Grid pool trades inside the auction; export at the floor ([§6.4](#64-grid-pool-trader)) |
| Fixed/average offer price | Uniform-price double auction within the floor–ceiling band |
| Unmet deficit left unmet | Utility import, never cut off ([§5](#5-household-in-deficit--end-to-end)) |
| Real Hedera parity fixes (`transferToTreasuryOnChain`) | Simulated Hedera ledger; real Hedera is future work |
| Wipe vs migration question | Wipe (free in local mode) |
| "Producers" were households with rooftop solar | Producers = large sellers; households with generation = prosumers |
