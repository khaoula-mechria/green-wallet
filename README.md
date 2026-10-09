# Green Wallet — a local energy market for a microgrid

Green Wallet simulates a neighbourhood microgrid where solar and wind farms, homes with
rooftop solar (prosumers) and homes that only consume trade energy with each other.
Every half hour, each household's meter reading is matched in a **uniform-price double
auction**. Batteries, including a shared community battery, store the surplus. Green
certificates track solar and wind energy until it is used. The main utility grid buys
and sells whatever the neighbourhood cannot. Money is a token called **TEC**, and every
payment and certificate movement is written to a **simulated, Hedera-style hash-chained
ledger**.

> **Status:** a working, fully tested simulation. The ledger is simulated locally, and
> **nothing is sent to the real Hedera network** (see [Blockchain and Hedera](#blockchain-and-hedera)).
> Meter readings come from a built-in simulator or manual entry. There is no smart-meter
> integration yet.

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Demo accounts and the operator console](#demo-accounts-and-the-operator-console)
- [How it works](#how-it-works)
- [Technology stack](#technology-stack)
- [Repository structure](#repository-structure)
- [Configuration](#configuration)
- [Blockchain and Hedera](#blockchain-and-hedera)
- [Testing](#testing)
- [Docker](#docker)
- [Documentation](#documentation)
- [Known limitations](#known-limitations)

## What it does

**For households** (producers, prosumers and consumers), the screens use plain language
and show no technical details:

- **My microgrid**: a live, animated map of the neighbourhood centred on your home. Dots
  show the energy moving in the last half hour, each home shows whether it is supplying,
  drawing or self-sufficient, and clicking a home opens its profile. Beside the map:
  - a summary strip (your flow now, price, batteries, utility, green share);
  - what your automatic agent is doing this half hour;
  - **Market now**: energy for sale versus wanted, and how many kWh you can buy right now;
  - your activity, summed per day.
- **Prices**: the market's single half-hourly price, what your agent sells or buys, and
  the price history.
- **Marketplace / My offers / My trades**: fixed-price deals between neighbours, on top
  of the auction.
- **Energy**: your meter readings and where every kWh went.
- **Battery & settings**: your home battery and your rented space in the community
  battery (shown as battery gauges), plus the limits your automatic agent uses.
- **Wallet**: balance, simulated top-up and cash-out, green energy produced and used, the
  utility statement, and your activity per day.
- **Household profiles**: what any participant produces, stores and trades, built from
  public data only.

Every figure shows its unit and whether it is a **rate** (kWh per 30 minutes, TEC/kWh)
or a **level** (kWh stored, TEC held, %).

**For the operator**, a separate console at `/admin` shows:

- **Overview**: the five conservation checks (money, clearing, energy, certificates, no
  negative balances), money supply, ledger status, the price-band formula and
  community-battery internals;
- **Households**: the full register (accounts, balances, agent limits). The operator can
  **add a household** of any role and **credit TEC** to a household from the treasury.
- **Auction book**: the merit-order chart and every bid;
- **Transactions, Certificates, Blocks**: the ledger, green certificates and the hash chain.

**Simulation**: the backend records one simulated meter reading per household every
interval (solar curve, wind with gusts, morning and evening demand). Optional **demo
neighbours** keep the marketplace alive: they list stored energy, buy offers, and top up
empty wallets once a simulated day.

## Quick start

Requirements: Node.js 20+ (22 recommended) and npm.

```bash
# terminal 1: backend (http://localhost:4000)
cd backend
npm install
npm run dev                     # auto-seeds the demo microgrid on an empty database

# terminal 2: frontend (http://localhost:5173)
cd frontend
npm install
VITE_API_MODE=real npm run dev  # proxies /api and /ws to :4000
```

Open http://localhost:5173.

- **No configuration needed:** every setting has a development default (see
  [Configuration](#configuration)).
- **`VITE_API_MODE=real` matters:** without it the frontend runs on its built-in browser
  mock (`frontend/src/mock/`). The mock is handy for UI work without a backend, but it
  ignores the backend and resets on every page reload.
- **Windows PowerShell:** set the variable with `$env:VITE_API_MODE="real"; npm run dev`.
  To make it permanent, copy `frontend/.env.example` to `frontend/.env` and set
  `VITE_API_MODE=real`.

## Demo accounts and the operator console

| Who | Sign in at | ID | Password |
|---|---|---|---|
| Producers (solar farm, wind farm) | `/login` | `producer-1`, `producer-2` | `password123` |
| Prosumers (rooftop solar, batteries) | `/login` | `prosumer-1` … `prosumer-5` | `password123` |
| Consumers | `/login` | `consumer-1` … `consumer-4` | `password123` |
| Operator | `/admin/login` | — | `operator123` (development default) |

The demo data is seeded automatically into an empty database. Never enable it on a real
deployment, because the demo password is public.

## How it works

1. **Readings.** Every interval (30 simulated minutes; one simulated day passes in about
   4 real minutes) each household reports production and consumption in kWh.
2. **Own resources first.** Self-consumption, then the home battery, then the household's
   rented space in the shared battery (if it chose "store").
3. **The auction.** At the end of the interval, an automatic agent per household bids
   the surplus or deficit with that household's price limits. One clearing price is set
   halfway between the last matched seller and buyer.
4. **The utility.** What finds no buyer is exported at the floor price (0.05 TEC/kWh);
   missing energy is imported at the ceiling (0.30 TEC/kWh). Nobody is cut off.
5. **Money and certificates.** Payments move TEC through a clearing account. A SOLAR or
   WIND certificate (1 per kWh) is issued on production, travels with the energy, and is
   retired when it is consumed, so green energy is never counted twice.
6. **The marketplace.** Households can also list energy they already hold at a fixed
   price, and neighbours can buy it into their rented battery space.

The full design is in [`docs/DESIGN.md`](./docs/DESIGN.md). A code-level walkthrough,
including the exact data the app expects, is in [`update.md`](./update.md).

## Technology stack

| Layer | Technology |
|---|---|
| Backend | Node.js, TypeScript, Express, zod, JWT (jsonwebtoken), bcryptjs, ws, express-rate-limit |
| Database | SQLite through better-sqlite3 (one file, `backend/data/green-wallet.db`) |
| Ledger | Simulated hash-chained ledger in SQLite (SHA-256, previous-hash links, light proof-of-work), with Hedera-style account and transaction IDs |
| Frontend | React 18, React Router 6, Recharts, Vite 5; fonts Archivo, Geist, Geist Mono |
| Tests | Vitest + Supertest |
| Deployment | Docker Compose: backend + nginx-served frontend |

## Repository structure

```
backend/
  src/
    server.ts            boot: config check, database, auto-seed, market clock, simulation
    app.ts               Express app, rate limits, /health
    container.ts         builds every service once (dependency injection)
    config/env.ts        all settings and their defaults, the price band, validation
    db/                  schema.sql, database.ts, repositories (one per table)
    services/            ledger, measurements, auction, community battery, marketplace,
                         trades, wallet, households, analytics, clock
    market/clearing.ts   the double-auction clearing algorithm (pure)
    simulation/          synthetic readings + demo neighbours
    api/routes/          REST endpoints (incl. admin.routes.ts for the operator)
    middleware/          JWT auth, operator guard, validation, errors
    blockchain/          ledger abstraction; Hedera code kept for future work (unused)
    scripts/             seed.ts, initToken.ts
  tests/                 unit + integration tests
frontend/
  src/
    pages/               one file per household screen; pages/admin/ for the console
    components/          map (LivingGrid), charts, batteries, activity, layouts, icons
    api/client.ts        fetch client; mock or real mode
    mock/                a complete in-browser copy of the backend (mock mode)
    types.ts             the API contract shared by both modes
docs/                    DESIGN.md, ARCHITECTURE.md, API.md, presentation
update.md                code-level guide for replaying a real energy dataset
docker-compose.yml
```

## Configuration

Every backend variable is listed, with its default, in
[`backend/.env.example`](./backend/.env.example). Nothing is required for local
development. The most useful ones:

| Variable | Default (development) | What it does |
|---|---|---|
| `MARKET_INTERVAL_MS` | `5000` | Real milliseconds per market interval |
| `MARKET_INTERVAL_SIM_MINUTES` | `30` | Simulated minutes per interval (must divide a day) |
| `SEED_DEMO_DATA` | `true` | Seed the 11 demo households into an empty database |
| `SIMULATION_ENABLED` | `true` | Record a simulated reading per household every interval |
| `DEMO_MARKET_ACTIVITY` | `true` | Demo neighbours: listings, purchases, daily top-ups for empty wallets |
| `MANUAL_MEASUREMENTS_ENABLED` | `true` | Allow `POST /api/energy/measurements` |
| `OPERATOR_PASSWORD` | `operator123` | Operator console password (in production: closed unless set, ≥ 12 characters) |
| `WELCOME_GRANT_TEC` | `10` | TEC given to each new prosumer and consumer |
| `WHOLESALE_PRICE_TEC`, `NETWORK_FEE_TEC`, `TAXES_TEC`, `SUPPLIER_MARGIN_TEC`, `UTILITY_BALANCING_COST_TEC` | `0.08 / 0.09 / 0.08 / 0.05 / 0.03` | Build the utility's ceiling (0.30) and floor (0.05) prices |
| `SHARED_BATTERY_CAPACITY_KWH` | `100` | Community battery size (60% rented to households, 40% grid pool) |

The frontend has one variable, `VITE_API_MODE` (`mock` or `real`), in
[`frontend/.env.example`](./frontend/.env.example).

With `NODE_ENV=production` all demo features default to **off**, and the backend
**refuses to start** unless `JWT_SECRET` and `KEY_ENCRYPTION_SECRET` are real secrets
(at least 32 characters each, and different from each other) and `CORS_ORIGIN` is not `*`.

**Database resets:** when the schema version changes, the backend rebuilds the database
on startup. Old data is wiped and the demo data is seeded again.

## Blockchain and Hedera

- **What runs:** a simulated ledger. Every TEC payment and certificate movement is a
  ledger transaction with a Hedera-style ID (`0.0.1000@<seconds>.<sequence>`), sealed in
  its own SHA-256 block that links to the previous one. You can browse it in the operator
  console. Account and token IDs (`0.0.4801…`, `0.0.5001…`) are local labels, and network
  fees are recorded but not charged.
- **What doesn't run:** a real Hedera integration exists in
  `backend/src/blockchain/HederaBlockchainService.ts` and `scripts/initToken.ts`, but it
  is **not wired into the application**. It also follows an older model in which TEC was
  energy rather than money. If `HEDERA_*` variables are set, the server logs a warning
  and ignores them. Connecting real Hedera (HTS tokens for TEC, SOLAR and WIND, plus a
  Consensus Service topic for the auction records) is future work.

## Testing

```bash
cd backend && npm test        # 143 tests in 16 files (unit + integration)
cd frontend && npm run build  # TypeScript check + production build
```

**Backend tests cover:**
- the clearing algorithm;
- auction settlement and the utility fallback;
- readings and energy flows;
- batteries, community storage and decay;
- certificates and the conservation checks;
- the marketplace and trade atomicity (including double-spend);
- the ledger hash chain;
- security: authorization, owner-only data, input validation, rate limits, WebSocket
  authentication, production-config checks, and operator-only console actions.

**Browser checks** were run in both modes (real backend and browser mock):
- every household page;
- submitting a reading, saving settings and topping up;
- listing an offer, buying it as a consumer, and seeing it in My trades;
- the operator console: adding a household, crediting it, and signing in as it.

## Docker

```bash
cp .env.example .env
# set JWT_SECRET and KEY_ENCRYPTION_SECRET (>= 32 characters each, different).
# For a demo, also set SEED_DEMO_DATA, SIMULATION_ENABLED, DEMO_MARKET_ACTIVITY
# and MANUAL_MEASUREMENTS_ENABLED to true, and OPERATOR_PASSWORD to open /admin.
docker compose up --build
```

- **Frontend:** http://localhost:8080 (nginx proxies `/api` and `/ws` to the backend).
  It is built in real mode.
- **Backend:** http://localhost:4000. SQLite is stored on a named volume, so no
  database container is needed.

## Documentation

| Document | What's in it |
|---|---|
| [`docs/DESIGN.md`](./docs/DESIGN.md) | The design: roles, batteries, certificates, prices, auction, marketplace, money |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Layers and how the services fit together |
| [`docs/API.md`](./docs/API.md) | Every endpoint, including the operator console |
| [`update.md`](./update.md) | Code-level guide: data the app expects, how to replay a real dataset, gaps |
| [`docs/Green-Wallet-Design.pptx`](./docs/Green-Wallet-Design.pptx) | Presentation of the design |
| [`BLOCKCHAIN_ENERGY_TRADING_DEEP_DIVE.md`](./BLOCKCHAIN_ENERGY_TRADING_DEEP_DIVE.md) | The reference architecture this project started from |

## Known limitations

- **No real Hedera.** The ledger is simulated locally (see above).
- **No smart-meter integration.** Readings are simulated or entered manually. Manual
  readings are capped, rate-limited and off by default in production, but they are
  self-reported.
- **No dataset import yet.** Replaying a real dataset needs a small script; `update.md`
  §11 explains how.
- **Money only comes from grants and top-ups.** Without the demo neighbours' daily
  top-ups (or the operator's credits), buyers eventually run out of TEC on long runs.
- **One process, one SQLite file.** Scaling out would need a networked database.
- **Two engines to keep in step.** The browser mock re-implements the backend logic and
  must be kept in sync by hand.
- **JWT authentication only.** There is no identity or KYC system.
