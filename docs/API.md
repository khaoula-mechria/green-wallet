# API Reference

Base URL: `http://localhost:4000/api`. All responses are JSON envelopes:
`{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message" } }`.

Authenticated routes require `Authorization: Bearer <token>` (JWT from login/register).
Mutating routes always act on the authenticated household — there is no way to trade,
mint, or read another household's wallet on their behalf.

Auth column: **—** public · **required** any logged-in household · **self** only the
household the data belongs to (others get `403`).

Request bodies are validated strictly: unknown fields are rejected with `400`.

## Auth

| Method | Path | Body | Auth |
|---|---|---|---|
| POST | `/auth/register` | `{ id?, name, type, location?, password, energyType? }` | — |
| POST | `/auth/login` | `{ id, password }` | — |

`type` is `producer` \| `consumer` \| `prosumer`. `id` is 1–64 letters, digits, `-` or
`_` (a UUID is generated if omitted). Response: `{ household, token }`. The starting TEC
balance is server policy (`SIGNUP_GRANT_TEC`, consumers only) and cannot be set by the
client.

## Households

| Method | Path | Auth |
|---|---|---|
| GET | `/households` | required |
| GET | `/households/:id` | required |
| GET | `/households/:id/history?limit=50` | self |

## Energy measurements

| Method | Path | Body | Auth |
|---|---|---|---|
| GET | `/energy/measurements?limit=100` | — | required (returns the caller's own readings) |
| POST | `/energy/measurements` | `{ production, consumption }` | required |

A positive `production - consumption` is automatically tokenized into TEC (1:1) for the
authenticated household. Because these readings are self-reported:

- each value must be between `0` and `MEASUREMENT_MAX_KWH` (default 50) — else `400`;
- one reading per household per `MEASUREMENT_MIN_INTERVAL_MS` (default 60 s) — else `429`;
- the endpoint returns `403` unless `MANUAL_MEASUREMENTS_ENABLED` is on (default: on in
  development, off in production).

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
| GET | `/trades` (optional `?householdId=` must be your own) | self |
| GET | `/trades/:id` | buyer or seller only (others get `404`) |

## Tokens

| Method | Path | Auth |
|---|---|---|
| GET | `/tokens/balance/:householdId` | self |
| GET | `/tokens/history/:householdId` | self |

## Transactions (global feed)

| Method | Path | Auth |
|---|---|---|
| GET | `/transactions?limit=200` | required |

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
| GET | `/dashboard` | — (system-wide aggregates only) |
| GET | `/microgrid` | required |

## WebSocket

`ws://localhost:4000/ws?token=<jwt>` — pushes a `TRADE_COMPLETED` message to a seller
whenever one of their offers is purchased. The JWT is verified during the upgrade (a
missing or invalid token gets `401` and no connection); the socket always receives
notifications for the token's own household only.

## Error codes

`VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `TOO_MANY_REQUESTS` (429),
`INTERNAL_ERROR` (500).
