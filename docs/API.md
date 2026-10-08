# API Reference

Base URL: `http://localhost:4000/api`. All responses are JSON envelopes:
`{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message" } }`.
Response shapes are the types in `frontend/src/types.ts` (the contract).

Authenticated routes require `Authorization: Bearer <token>` (JWT from login/register).
Mutating routes always act on the authenticated household.

Auth column: **—** public · **required** any logged-in household · **self** only the
household the data belongs to (others get `403`).

Request bodies are validated strictly: unknown fields are rejected with `400`.

## Auth

| Method | Path | Body | Auth |
|---|---|---|---|
| POST | `/auth/register` | `{ id?, name, type, location?, password, energyType?, batteryCapacityKwh? }` | — |
| POST | `/auth/login` | `{ id, password }` | — |

`type` is `producer` \| `prosumer` \| `consumer`. Energy source by role: producers
`solar` or `wind`, prosumers `solar`, consumers `grid`. Only prosumers may have a battery
(`batteryCapacityKwh`, default 10, max 50). Prosumers and consumers receive the welcome
grant from the treasury; balances can never be set by the client. Response:
`{ household, token }`.

## Households

| Method | Path | Body | Auth |
|---|---|---|---|
| GET | `/households` | — | required |
| GET | `/households/:id` | — | required |
| GET | `/households/:id/history?limit=50` | — | self — readings with their energy `flow` |
| GET | `/households/me/settings` | — | required |
| POST | `/households/me/settings` | partial `HouseholdSettings` | required |

Settings (DESIGN.md §4.1): `overflowMode` (`sell` \| `store`, prosumers only),
`minSellPrice`, `maxBuyPrice`, `storeMinPrice`, `batterySell { enabled, minPrice,
keepPercent }`, `auctionOptOut`. Prices must lie within the band (0.05–0.30 TEC/kWh by
default).

## Energy measurements

| Method | Path | Body | Auth |
|---|---|---|---|
| GET | `/energy/measurements?limit=100` | — | required (the caller's own readings) |
| POST | `/energy/measurements` | `{ production, consumption }` | required |

Response: `{ measurement, settlesInMs, certificateTx, retired }`. Production issues green
certificates (never TEC). Own battery and stored energy are used at once; what's left waits
for the auction and `settlesInMs` says when it settles. Consumers cannot report production.
Because readings are self-reported:

- each value must be between `0` and `MEASUREMENT_MAX_KWH` (default 50) — else `400`;
- one reading per household per `MEASUREMENT_MIN_INTERVAL_MS` (default 60 s) — else `429`;
- the endpoint returns `403` unless `MANUAL_MEASUREMENTS_ENABLED` is on (default: on in
  development, off in production).

## Market — auction

| Method | Path | Auth |
|---|---|---|
| GET | `/market/status` | — clock, price band (with its cost components), last price, 24h average |
| GET | `/market/price-history?limit=48` | — clearing price per interval, oldest first |
| GET | `/market/auctions/latest` | — last settled auction with every bid and what it matched (`null` before the first) |
| GET | `/market/my-bid` | required — what the caller's agent bids in the current interval |

## Market — marketplace (fixed-price offers)

| Method | Path | Body | Auth |
|---|---|---|---|
| GET | `/market/offers` | — | — (active offers) |
| GET | `/market/offers/mine` | — | required (every status) |
| POST | `/market/offers` | `{ amountKwh, pricePerKwh }` | required (prosumers and consumers) |
| GET | `/market/offers/:id` | — | — |
| POST | `/market/offers/:id/cancel` | — | required (seller only) |
| POST | `/market/offers/:id/purchase` | `{ amountKwh }` | required (buyer) |

An offer reserves kWh the seller owns (stored energy + battery above its keep-reserve); they
stay in place and out of the auction until sold, cancelled or expired (24 simulated hours).
Producers sell through the auction only. A purchase is delivered into the buyer's rented
space in the shared battery and settles TEC, energy and certificates in one transaction.

## Trades

| Method | Path | Auth |
|---|---|---|
| GET | `/trades` (optional `?householdId=` must be your own) | self |
| GET | `/trades/:id` | buyer or seller only (others get `404`) |

## Wallet and tokens

| Method | Path | Body | Auth |
|---|---|---|---|
| GET | `/wallet/:householdId` | — | self — TEC (available / reserved), certificates, green share, utility statement |
| POST | `/wallet/topup` | `{ amount }` | required — simulated payment, max `TOPUP_MAX_TEC`, cooldown |
| POST | `/wallet/cashout` | `{ amount }` | required — simulated bank transfer, available balance only |
| GET | `/tokens/balance/:householdId` | — | self |
| GET | `/tokens/history/:householdId?limit=100` | — | self |

Top-up and cash-out return `400` when `TOPUPS_ENABLED` is off (default off in production).

## Ledger

| Method | Path | Auth |
|---|---|---|
| GET | `/transactions?limit=200&asset=ALL\|TEC\|CERT\|RECORD` | — (the platform's public notary) |
| GET | `/blockchain/status` | — |
| GET | `/blockchain/blocks?limit=100` | — |
| GET | `/blockchain/blocks/:index` | — (with its transactions) |

## Grid, dashboard, microgrid

| Method | Path | Auth |
|---|---|---|
| GET | `/grid/status` | — shared battery: rented space, grid pool, decay, the pool's price limits |
| GET | `/dashboard` | — system-wide aggregates and the five conservation checks |
| GET | `/microgrid` | required — per-household production, consumption, battery, storage |

## WebSocket

`ws://localhost:4000/ws?token=<jwt>` — pushes a `TRADE_COMPLETED` message to a seller
whenever one of their marketplace offers is purchased. The JWT is verified during the
upgrade (a missing or invalid token gets `401` and no connection); the socket only receives
notifications for the token's own household.

## Error codes

`VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `TOO_MANY_REQUESTS` (429),
`INTERNAL_ERROR` (500).
