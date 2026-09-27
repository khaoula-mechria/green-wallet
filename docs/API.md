# API Reference

Base URL: `http://localhost:4000/api`. All responses are JSON envelopes:
`{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message" } }`.

Authenticated routes require `Authorization: Bearer <token>` (JWT from login/register).
Mutating routes always act on the authenticated household — there is no way to trade,
mint, or read another household's wallet on their behalf.

## Auth

| Method | Path | Body | Auth |
|---|---|---|---|
| POST | `/auth/register` | `{ id?, name, type, location, password, energyType?, initialTokenBalance? }` | — |
| POST | `/auth/login` | `{ id, password }` | — |

`type` is `producer` \| `consumer` \| `prosumer`. Response: `{ household, token }`.

## Households

| Method | Path | Auth |
|---|---|---|
| GET | `/households` | — |
| GET | `/households/:id` | — |
| GET | `/households/:id/history?limit=50` | — |

## Energy measurements

| Method | Path | Body | Auth |
|---|---|---|---|
| GET | `/energy/measurements?limit=100` | — | — |
| POST | `/energy/measurements` | `{ production, consumption }` | required |

A positive `production - consumption` is automatically tokenized into TEC (1:1) for the
authenticated household.

## Marketplace

| Method | Path | Body | Auth |
|---|---|---|---|
| GET | `/market/offers` | — | — |
| POST | `/market/offers` | `{ amountKwh, pricePerKwh }` | required (seller) |
| GET | `/market/offers/:id` | — | — |
| POST | `/market/offers/:id/cancel` | — | required (seller only) |
| POST | `/market/offers/:id/purchase` | `{ amountKwh }` | required (buyer) |

Creating an offer escrows `amountKwh` out of the seller's sellable energy balance.
Cancelling refunds whatever wasn't sold.

## Trades

| Method | Path | Auth |
|---|---|---|
| GET | `/trades?householdId=` | — |
| GET | `/trades/:id` | — |

## Tokens

| Method | Path | Auth |
|---|---|---|
| GET | `/tokens/balance/:householdId` | — |
| GET | `/tokens/history/:householdId` | — |

## Transactions (global feed)

| Method | Path | Auth |
|---|---|---|
| GET | `/transactions?limit=200` | — |

## Blockchain explorer

| Method | Path | Auth |
|---|---|---|
| GET | `/blockchain/status` | — |
| GET | `/blockchain/blocks?limit=100` | — |
| GET | `/blockchain/blocks/:index` | — |
| GET | `/blockchain/transactions?limit=200` | — |

## Dashboard / microgrid

| Method | Path | Auth |
|---|---|---|
| GET | `/dashboard` | — |
| GET | `/microgrid` | — |

## WebSocket

`ws://localhost:4000/ws?householdId=<id>` — pushes a `TRADE_COMPLETED` message to a
seller whenever one of their offers is purchased.

## Error codes

`VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`CONFLICT` (409), `INTERNAL_ERROR` (500).
