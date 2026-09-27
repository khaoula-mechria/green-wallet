# Green Wallet — Blockchain-Based Energy Trading

A working MVP of a decentralized peer-to-peer energy trading platform: households with
solar/wind surplus tokenize and sell it to households in deficit, settled with an
energy-backed token (TEC) recorded on an immutable, hash-chained ledger.

Built on top of the design described in
[`BLOCKCHAIN_ENERGY_TRADING_DEEP_DIVE.md`](./BLOCKCHAIN_ENERGY_TRADING_DEEP_DIVE.md) —
a real Hedera Hashgraph-based reference architecture — reimplemented here with the same
mechanisms (surplus tokenization, hash-chained/on-chain settlement, atomic trade
execution) but generalized to households (producer/consumer/prosumer) and hardened
against the gaps that document calls out (no auth → JWT added; non-atomic writes →
wrapped in DB transactions; plaintext private keys → encrypted at rest; etc).

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [Repository structure](#repository-structure)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Blockchain mode: local vs. real Hedera testnet](#blockchain-mode-local-vs-real-hedera-testnet)
- [API](#api)
- [Testing](#testing)
- [Docker](#docker)
- [Example workflow](#example-workflow)
- [Known limitations](#known-limitations)

## Features

- **Households** — producer / consumer / prosumer accounts with JWT auth, seeded with
  5 producers + 5 consumers of realistic sample data.
- **Energy measurement** — manual submission API + an automatic simulation that drives
  a solar-like production curve and an independent consumption curve.
- **Surplus tokenization** — a positive `production - consumption` is minted 1:1 into
  TEC tokens automatically.
- **Marketplace** — producers list surplus as offers (amount + price); consumers browse,
  filter and purchase, partially or fully.
- **Token system** — TEC balances, atomic transfers, full transaction history, kept
  conceptually separate from physical kWh accounting.
- **Blockchain layer** — every settlement is recorded as an immutable, hash-chained
  block (sha256, chained previous-hash, lightweight proof-of-work) by default, or as a
  real Hedera testnet transaction when configured — behind one `BlockchainService`
  interface so the ledger is swappable.
- **Automated trade execution** — the "smart contract": surplus/balance/offer
  preconditions are checked and enforced atomically in `TradeService`, with a documented
  swap-in point for a real Hedera Smart Contract later.
- **Dashboard, blockchain explorer, microgrid view** — live, polling UI with charts.
- **Ledger integrity** — every money movement commits atomically with its ledger block;
  balances are exact integers (Wh / µTEC) that the database refuses to let go negative;
  purchases are idempotent; block hashes commit to transaction contents; `npm run
  ledger:check` verifies the chain and reconciles every balance against its history.
- **Tests** — 70 tests across surplus/deficit calc, offers, trades, token transfers,
  blockchain hashing/validation, double-spend/duplicate-execution prevention, API
  security, and ledger integrity (atomic rollback, overdraft, idempotency, tampering,
  migrations).

## Architecture

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for diagrams and the layering
rationale. In short:

```
Frontend (React) → REST/WS → API routes → Services → Repositories → SQLite
                                              ↓
                                     BlockchainService (interface)
                                      ↙                        ↘
                        LocalBlockchainService        HederaBlockchainService
                         (default, hash-chained)        (opt-in, real testnet)
```

## Technology stack

- **Backend**: Node.js 22, TypeScript, Express, better-sqlite3, JWT, bcryptjs,
  `@hashgraph/sdk` (real Hedera integration, opt-in), `ws` (WebSocket notifications),
  Vitest + Supertest for tests.
- **Frontend**: React 18, Vite, TypeScript, React Router, Recharts.
- **Database**: SQLite (file-based — zero external setup; swap `DB_PATH` for a
  persistent volume in Docker).
- **Blockchain**: a self-contained hash-chained simulated ledger by default; real
  Hedera Hashgraph testnet when credentials are supplied.

These choices favor "runs immediately, zero external setup" over "matches the reference
doc's exact stack" — see [Blockchain mode](#blockchain-mode-local-vs-real-hedera-testnet)
for why Hedera is opt-in rather than mandatory.

## Repository structure

```
backend/
  src/
    domain/          shared TypeScript types
    db/               migrations.ts (schema source of truth), database.ts, repositories/*
    blockchain/       BlockchainService interface + Local/Hedera implementations
    services/         application logic (one file per bounded concern)
    simulation/        solar/consumption curves + the ticking SimulationService
    api/routes/        thin HTTP handlers only
    middleware/        auth, error handling
    scripts/           seed.ts, initToken.ts
  tests/              vitest unit + integration tests
frontend/
  src/
    pages/            one file per screen (Dashboard, Marketplace, Wallet, ...)
    components/       Layout, Badge, StatCard
    api/               fetch client
    context/           AuthContext
docs/                 architecture + API reference
docker-compose.yml
```

## Quick start

### Option A — Docker (recommended, matches production topology)

The compose stack runs with `NODE_ENV=production`, so it needs real secrets and has
all demo features off by default:

```bash
cp .env.example .env
# edit .env: set JWT_SECRET and KEY_ENCRYPTION_SECRET (>= 32 chars each, different).
# For a local demo, also set SEED_DEMO_DATA, SIMULATION_ENABLED and
# MANUAL_MEASUREMENTS_ENABLED to true, and SIGNUP_GRANT_TEC=20.
docker compose up --build
```

- Frontend: http://localhost:8080
- Backend: http://localhost:4000
- With `SEED_DEMO_DATA=true`, an empty database is **auto-seeded** with 5 producers + 5
  consumers (see `src/scripts/seedData.ts` — same data `npm run seed` uses). Log in
  with any of `producer-1`..`producer-5` / `consumer-1`..`consumer-5`, password
  `password123`. Never enable this on a real deployment.

### Option B — local dev (two terminals)

```bash
# terminal 1
cd backend
npm install
cp .env.example .env      # optional — defaults work out of the box
npm run dev                # starts on :4000, auto-seeds on first boot

# terminal 2
cd frontend
npm install
npm run dev                # starts on :5173, proxies /api and /ws to :4000
```

Open http://localhost:5173.

## Configuration

See [`backend/.env.example`](./backend/.env.example) for every variable. Nothing is
required to run locally — in development the defaults enable demo data, the
simulation and manual meter readings.

With `NODE_ENV=production` the defaults flip to safe values, and the backend **refuses to
start** unless:

- `JWT_SECRET` and `KEY_ENCRYPTION_SECRET` are set, at least 32 characters, distinct,
  and not the placeholders;
- `CORS_ORIGIN` is not `*` (leave it unset when the frontend is served same-origin).

Demo seeding, the simulation and manual (self-reported) meter readings are off unless
explicitly enabled, and the server logs a warning if they are.

## Blockchain mode: local vs. real Hedera testnet

By default (no Hedera env vars set) the app runs on `LocalBlockchainService`: a
self-contained, hash-chained ledger (sha256, previous-hash chaining, lightweight
proof-of-work) with zero external dependencies — every trade settlement is still
immutably recorded and explorable, just not on a public chain.

To switch to **real** Hedera Hashgraph testnet settlement:

1. Create a free testnet account at https://portal.hedera.com.
2. Set `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY` (ECDSA) in `backend/.env`.
3. Run `npm run init:token` once — creates the TEC fungible token and prints its id.
4. Set `HEDERA_TOKEN_ID` to that id and restart the backend.

From then on, every household registration provisions a real Hedera account (ED25519
key, encrypted at rest), every energy mint is a real `TokenMintTransaction`, and every
trade settlement is a real `TransferTransaction` — while the app's business logic,
routes, and UI are unchanged, because they only ever talk to the `BlockchainService`
interface. **This repository does not and cannot include working Hedera credentials —
you must supply your own.**

## API

Full reference: [`docs/API.md`](./docs/API.md).

## Testing

```bash
cd backend
npm test
```

32 core tests covering: surplus/deficit calculation, offer creation (incl. insufficient
surplus), trade purchase end-to-end, insufficient token balance, insufficient offer
energy, trade completion, block creation/hashing, block hash validation, tampered-block
detection, and duplicate-execution/double-spend prevention (both on offer capacity and
on trade settlement) — plus 18 security tests (`tests/integration/security.test.ts`):
client-chosen balances rejected, meter-reading caps and rate limits, owner-only access
to wallets/trades/meter history, WebSocket authentication, and production config
validation — plus 20 ledger tests (`tests/integration/ledger.test.ts`): no overdraft
under concurrent purchases, full rollback when the ledger write fails mid-purchase,
exact integer arithmetic over many small trades, idempotent replays, detection of
amounts edited in the ledger table, the stale-trade sweeper, and migrating a legacy
float database.

### Ledger check

```bash
cd backend
npm run ledger:check   # verifies the hash chain + reconciles balances; exit 1 on problems
```

The same check runs at every server boot and logs any problem. Schema changes live in
`src/db/migrations.ts` and apply automatically on boot.

## Docker

`docker-compose.yml` builds and runs two services: `backend` (Node, port 4000, SQLite on
a named volume) and `frontend` (static build served by nginx, port 8080, proxying
`/api` and `/ws` to `backend`). No database container is needed.

## Example workflow

1. `producer-1` logs in, the simulation (or a manual `POST /energy/measurements`)
   records `production: 8, consumption: 3` → surplus `5 kWh` → 5 TEC auto-minted.
2. `producer-1` lists an offer: `3 kWh @ 0.2 TEC/kWh` (escrows 3 kWh out of their
   sellable balance).
3. `consumer-1` (seeded with 50 TEC) browses the marketplace, buys `3 kWh` from that
   offer.
4. `TradeService` atomically: reserves the offer capacity, transfers `0.6 TEC` from
   buyer to seller, records the settlement on the blockchain (local or Hedera), credits
   the buyer's energy balance, marks the trade `completed`.
5. Both households see the trade in **My Purchases**/**My Offers**, the TEC transfer in
   **Token Wallet**, and the mined block in **Blockchain Explorer**.

## Known limitations

- **Hedera credentials are never included** — real on-chain mode requires the operator
  to supply their own testnet account (see above).
- **Single-process, single-SQLite-file** — matches the reference architecture's own
  "reduce central coordination" roadmap item (Phase 5); horizontal scaling would need a
  networked database and a real distributed consensus layer.
- **No real IoT/meter integration** — measurements are simulated or manually submitted,
  matching the reference doc's own Phase 3 gap. Manual readings are capped and
  rate-limited, and off by default in production, but they are still self-reported:
  trustworthy minting needs signed readings from real meters.
- **Trade "smart contract" is application code, not an on-chain contract** — preconditions
  are enforced by `TradeService`, not by Hedera Smart Contract Service. The
  `BlockchainService` boundary is exactly where that migration (reference doc's Phase 4)
  would plug in.
- **JWT-based auth**, not a full identity/KYC system — appropriate for an MVP, not a
  production financial platform.
