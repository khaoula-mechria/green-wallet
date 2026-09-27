# The Pipeline — How Data Moves, and How the Blockchain Works

This document explains the *concept* behind the project: the journey a single unit of
electricity takes from a solar panel to a neighbor's wallet, and the mechanics of the
blockchain that records it. It's diagram-heavy on purpose — read the diagrams first,
the text fills in the "why."

---

## 1. The big picture

The whole system is really just two pipelines glued together at one point: a **physical
pipeline** (energy) and a **digital pipeline** (money/trust). They only touch at the
moment a surplus gets tokenized, and again at the moment a trade settles.

```mermaid
flowchart LR
    subgraph Physical["PHYSICAL LAYER — real-world quantities (kWh)"]
        direction LR
        P1["Solar / wind\nproduction"] --> P2["Meter reading\n(production, consumption)"]
        P2 --> P3["Surplus or deficit\n= production − consumption"]
    end

    subgraph Bridge["THE BRIDGE"]
        direction LR
        B1["Tokenization\n1 kWh surplus → 1 TEC"]
    end

    subgraph Digital["DIGITAL LAYER — trust & value (TEC tokens)"]
        direction LR
        D1["Marketplace offer"] --> D2["Trade / purchase"] --> D3["Blockchain record\n(immutable proof)"]
    end

    P3 --> B1 --> D1
```

**Rule of the whole project:** the blockchain never moves electricity. It only moves
and records *tokens*. A wire, a meter, and this app's own bookkeeping are what "move"
energy conceptually (by updating balances) — the blockchain's job is strictly to make
the token side of that story tamper-evident and auditable.

---

## 2. Physical layer vs. digital layer, side by side

| | Physical layer | Digital layer |
|---|---|---|
| Unit | kWh (kilowatt-hours) | TEC (a token, 1 TEC ≈ 1 kWh of tokenized surplus) |
| What it represents | Real (or simulated) electricity produced/used | Ownership / trading value |
| Where it lives | `energy_measurements`, `households.currentProduction/currentConsumption/energyBalance` | `token_transactions`, `households.tokenBalance`, the blockchain tables |
| Who changes it | `MeasurementService` (readings), `MarketplaceService` (escrow) | `TokenService`, `BlockchainService` |
| Can it be faked by a user? | No — server always recalculates, never trusts client-sent balances | No — same rule, all writes happen server-side inside atomic transactions |
| Analogy | The electricity actually flowing through the wires | The receipt proving who paid whom for it |

---

## 3. The end-to-end journey of one kWh

This is the full pipeline, start to finish, for a single successful trade.

```mermaid
flowchart TD
    A["1. Producer's panel/simulator\ngenerates a reading"] --> B["2. POST /energy/measurements\n(or the automatic simulator tick)"]
    B --> C{"3. surplus =\nproduction − consumption\n> 0 ?"}
    C -- "No (deficit)" --> C1["Recorded, nothing minted.\nHousehold may need to buy."]
    C -- "Yes" --> D["4. TokenService.mint()\ncreates TEC 1:1 with the surplus"]
    D --> E["5. Blockchain records a\nMINT transaction"]
    E --> F["6. Household's energyBalance\nand tokenBalance go up"]
    F --> G["7. Producer lists an offer\n(amountKwh, pricePerKwh)\n— escrows that kWh"]
    G --> H["8. Offer appears on\nthe Marketplace page"]
    H --> I["9. Consumer picks an offer\nand an amount to buy"]
    I --> J["10. TradeService reserves\nthe offer's capacity"]
    J --> K["11. TokenService.transfer()\nmoves TEC buyer → seller"]
    K --> L["12. Blockchain records a\nTRADE transaction"]
    L --> M["13. Buyer's energyBalance\ngoes up, offer updates"]
    M --> N["14. Both sides see it in\nWallet / My Purchases /\nBlockchain Explorer"]
```

Fourteen steps, but only three "owners":

| Steps | Owned by | In plain words |
|---|---|---|
| 1–6 | Physical → tokenization | "I made extra power, so I earned coins for it." |
| 7–10 | Marketplace | "I'm selling some of those coins'-worth of power; you want to buy some." |
| 11–14 | Settlement + ledger | "The coins actually moved, and it's permanently written down." |

---

## 4. Household state — what a household looks like over time

```mermaid
stateDiagram-v2
    [*] --> Registered: register (name, type, location, password)
    Registered --> HasReading: submit/simulate a measurement
    HasReading --> HasSurplus: production > consumption
    HasReading --> HasDeficit: production < consumption
    HasSurplus --> TokensMinted: auto-mint TEC (1:1)
    TokensMinted --> HasReading: next tick/reading
    HasDeficit --> HasReading: next tick/reading
    TokensMinted --> ListedOffer: create an offer (optional)
    ListedOffer --> OfferSold: someone buys it
    ListedOffer --> OfferCancelled: seller cancels
    HasDeficit --> BoughtEnergy: buy from someone's offer
```

A household is never "only a producer" or "only a consumer" in the data model — those
are just labels. What actually matters every tick is the *sign* of
`production − consumption`. A "prosumer" is simply a household that sometimes has
surplus and sometimes has deficit.

---

## 5. The marketplace offer lifecycle

```mermaid
stateDiagram-v2
    [*] --> active: seller creates offer\n(kWh escrowed out of energyBalance)
    active --> active: partial purchase\n(amountRemainingKwh decreases)
    active --> completed: amountRemainingKwh reaches 0
    active --> cancelled: seller cancels\n(remaining kWh refunded)
    completed --> [*]
    cancelled --> [*]
```

The escrow trick matters: the moment an offer is created, that kWh is subtracted from
the seller's sellable balance immediately — not just "reserved on paper." That's what
makes it impossible to list the same surplus in two different offers at once.

---

## 6. Trade execution — the closest thing this project has to a "smart contract"

A trade happens in two internal phases, even though the user only sees one "Buy"
button. This two-phase design is what makes the whole thing safe against cheating and
against timing accidents (two people clicking "Buy" on the same offer at the same
instant).

```mermaid
sequenceDiagram
    actor Buyer
    participant API as API route
    participant Trade as TradeService
    participant Token as TokenService
    participant Chain as BlockchainService
    participant DB as Database

    Buyer->>API: "Buy 3 kWh from offer #42"
    API->>Trade: purchase(buyerId, offerId, 3)

    rect rgb(235, 245, 240)
    note right of Trade: PHASE 1 — createTrade (atomic)
    Trade->>DB: re-check offer is still active\nand has ≥ 3 kWh left
    Trade->>DB: subtract 3 kWh from the offer\ninsert trade, status = "pending"
    end

    rect rgb(235, 240, 250)
    note right of Trade: PHASE 2 — executeTrade
    Trade->>Trade: is this trade still "pending"?\n(if not: STOP — refuse to run twice)
    Trade->>Token: transfer(buyer → seller, price)
    Token->>Chain: recordTransaction(TRADE)
    Chain-->>Token: confirmation + block hash
    Token->>DB: debit buyer, credit seller (atomic)
    Trade->>DB: credit buyer's energyBalance\nmark trade "completed"
    end

    Trade-->>API: completed trade
    API-->>Buyer: "Purchase confirmed"
```

### Why two phases, and why it matters

| Danger | How it's stopped |
|---|---|
| Two buyers grab the last kWh of the same offer at the same time | Phase 1 re-checks the *live* remaining amount right before subtracting, inside one atomic database transaction — the second buyer's check will correctly fail. |
| The same trade gets "executed" twice (e.g. a network retry) | Phase 2 refuses to run unless the trade's status is still `pending`. Once it flips to `completed`, running it again is rejected outright. |
| The buyer's coin balance changes between "add to cart" and "checkout" | The coin balance is checked fresh, at the moment of transfer, not from a stale number shown earlier on the screen. |
| Server crashes mid-trade | Every multi-step database write happens inside one atomic `transaction()` block — either *all* the steps happen, or *none* do. There's no "half-finished" trade left behind. |

This is called the "smart contract" of the project because it behaves the way a
blockchain smart contract would (checks conditions, then executes irreversibly, with no
partial states) — but it's important to be honest that it's ordinary server code
enforcing these rules, not code running immutably on a blockchain. Section 8 explains
exactly where the line is.

---

## 7. Token economics — how TEC is created and destroyed (spoiler: it isn't destroyed)

```mermaid
flowchart LR
    Treasury(("Treasury\n(conceptual — not\na real account locally)"))
    Treasury -- "MINT\n(1 TEC per 1 kWh surplus)" --> Household1["Household A\n(producer)"]
    Household1 -- "TRANSFER\n(trade settlement)" --> Household2["Household B\n(consumer)"]
    Household2 -- "TRANSFER\n(could resell energy\nif they become a prosumer)" --> Household3["Household C"]
```

- **TEC only enters the system through minting** — and minting only happens when a
  positive surplus is recorded. There's no way to create TEC out of thin air through
  the marketplace.
- **TEC never leaves the system** — a trade just moves it from one household to
  another. Total TEC in circulation only ever goes up (visible on the Dashboard as
  "TEC in circulation").
- **kWh and TEC are tracked completely separately**, on purpose (see the table in
  section 2). A household's `energyBalance` (kWh they can still sell) and
  `tokenBalance` (TEC they can still spend) are two different numbers that just happen
  to start out equal, because minting is 1:1.

---

## 8. How the blockchain actually works

### 8.1 What a "block" is, concretely

Every block in this project's local blockchain is a small record with exactly these
fields:

| Field | Example | What it means |
|---|---|---|
| `index` | `42` | Its position in the chain — block 42 comes after block 41. |
| `timestamp` | `1790018447963` | The moment it was mined. |
| `previousHash` | `00c3d06c32ca...` | The fingerprint of the block right before it. |
| `hash` | `00aedb7c4b64...` | This block's own fingerprint. |
| `nonce` | `158` | A number that was searched for to make the hash "valid" (see 8.3). |
| `transactionIds` | `["tx-91a3..."]` | Which transaction(s) this block contains. In this project, it's always exactly one — one block is mined per transaction, so cause and effect are easy to follow in the explorer. |

### 8.2 Chaining — why you can't quietly edit old history

```mermaid
flowchart LR
    G["Genesis Block\n#0\nhash: 0000...0000"] --> B1["Block #1\nprevHash → #0's hash\nhash: 00a1f9..."]
    B1 --> B2["Block #2\nprevHash → #1's hash\nhash: 00c3d0..."]
    B2 --> B3["Block #3\nprevHash → #2's hash\nhash: 00aedb..."]
```

Each block stores the *fingerprint* (hash) of the block before it. The fingerprint is
computed from *everything* in the block — its index, its timestamp, its transactions,
its nonce. Change **one character** of a past transaction, and that block's own hash
changes completely, which no longer matches what the *next* block says its
`previousHash` should be. The mismatch is immediately detectable — that's what "tamper
evident" means, and it's the entire point of a blockchain.

The app has an automated test that proves this directly: it takes a real block,
changes one field, and confirms the hash-check correctly says "invalid."

### 8.3 The "fingerprint" (hashing) and mining, in plain words

A **hash** is a scrambling function: feed it any text, and it spits out a fixed-length
string of letters/numbers that looks completely random. Two important properties:

1. The *same* input always produces the *same* hash.
2. Changing *anything* in the input — even one letter — produces a *completely
   different* hash (not a "slightly different" one).

```
sha256("block #1, time 1790018447963, prevHash 0000...") → "7f3ac9e1b2d0..."
sha256("block #1, time 1790018447964, prevHash 0000...") → "2b91fca0d817..."
                     ^ one digit changed here                ^ totally different result
```

"**Mining**" a block just means: try different `nonce` numbers until the resulting hash
happens to start with a couple of zeros (`00...`). This is called "proof of work" — it
proves *some* amount of computer effort was spent, which is the classic blockchain
trick for making history expensive to rewrite. This project uses a very easy difficulty
(so it mines instantly, useful for a demo) — a real public blockchain uses a much
harder target, which is why real mining takes real electricity and real time.

### 8.4 One transaction, one block

```mermaid
sequenceDiagram
    participant Service as TokenService
    participant Chain as LocalBlockchainService
    participant DB as Database

    Service->>Chain: recordTransaction(MINT, amount=5, to=household-1)
    Chain->>DB: save the transaction (not yet in a block)
    Chain->>Chain: look up the latest block's hash
    Chain->>Chain: mine a new block:\nindex = latest+1\nprevHash = latest's hash\nsearch for a valid nonce
    Chain->>DB: save the new block
    Chain->>DB: mark the transaction as "in block #N"
    Chain-->>Service: confirmation (block index + hash)
```

### 8.5 Two possible "backends" for the same interface

The rest of the app never talks to the blockchain directly — it only talks to one
shared interface (`recordTransaction`, `getChain`, `getStatus`). Which real
implementation answers those calls depends on configuration, decided once when the
server starts:

```mermaid
flowchart TD
    Start(["Server boots"]) --> Check{"Hedera credentials\nall present in\nsettings?"}
    Check -- "No (default)" --> Local["Use the built-in\nlocal blockchain\n(sections 8.1–8.4 above)"]
    Check -- "Yes" --> Hedera["Use real Hedera\nHashgraph testnet\n(actual public blockchain)"]
    Local --> Same["Same app code,\nsame API, same UI —\nno other file changes"]
    Hedera --> Same
```

| | Local (default) | Real Hedera testnet (opt-in) |
|---|---|---|
| Needs an internet connection? | No | Yes |
| Needs a real crypto account? | No | Yes — you create your own free one |
| Is it publicly verifiable by others? | No — only lives in this app's own database | Yes — a real, independent public network |
| Speed | Instant | A few real seconds per transaction |
| What changes in the app to switch? | Nothing — one setting decides which is used | Nothing — one setting decides which is used |

---

## 9. A full worked example, with real numbers

| Step | Event | producer-1's numbers | consumer-1's numbers |
|---|---|---|---|
| 0 | Start | production 0, energyBalance 0, TEC 0 | production 0, TEC 50 (seeded) |
| 1 | Reading: produced 8 kWh, used 3 kWh | surplus = 5 kWh | — |
| 2 | Auto-mint (5 kWh → 5 TEC) | energyBalance 5, TEC 5 | — |
| 3 | Lists offer: 3 kWh @ 0.20 TEC/kWh | energyBalance 2 (3 escrowed) | — |
| 4 | consumer-1 buys 3 kWh (cost = 3 × 0.20 = 0.60 TEC) | — | — |
| 5 | Trade settles | TEC 5 + 0.60 = **5.60** | TEC 50 − 0.60 = **49.40**, energyBalance +3 |
| 6 | Recorded on the blockchain | a MINT block (step 2) + a TRADE block (step 5) now exist, both visible in the Blockchain Explorer | same |

---

## 10. Where everything is stored (data map)

| Table | What it holds | Written by |
|---|---|---|
| `households` | Identity, current readings, kWh balance, TEC balance | `HouseholdRepository`, updated by almost every service |
| `energy_measurements` | Every reading ever submitted (timestamped) | `MeasurementService` |
| `energy_offers` | Marketplace listings and their remaining amount/status | `MarketplaceService`, `TradeService` |
| `energy_trades` | Every purchase attempt, pending or completed | `TradeService` |
| `token_transactions` | Every TEC movement (mint/transfer/settlement) | `TokenService` |
| `blockchain_transactions` | The blockchain's own copy of every recorded transaction | `BlockchainService` |
| `blockchain_blocks` | The actual chain of blocks, in order | `LocalBlockchainService` (or mirrored by `HederaBlockchainService`) |

Notice `token_transactions` and `blockchain_transactions` look similar but serve
different purposes: the first is the *application's* bookkeeping (fast to query for a
wallet page), the second is the *ledger's* own independent record (what the Blockchain
Explorer page reads). They're written together, atomically, so they never disagree.

---

## 11. Putting it all together

```mermaid
flowchart TB
    subgraph Physical["Physical layer"]
        Sun["Sun / wind\n(or the simulator)"] --> Meter["Meter reading"]
        Meter --> Calc["Surplus/deficit calculation"]
    end

    subgraph Digital["Digital layer"]
        Mint["Mint TEC (1:1)"] --> Market["Marketplace offer"]
        Market --> Purchase["Purchase / trade"]
        Purchase --> Ledger["Blockchain record\n(hash-chained blocks)"]
    end

    subgraph Views["What the user sees"]
        Dash["Dashboard"]
        Wallet["Wallet"]
        Explorer["Blockchain Explorer"]
        Grid["Microgrid view"]
    end

    Calc -->|"if surplus > 0"| Mint
    Ledger --> Dash
    Ledger --> Wallet
    Ledger --> Explorer
    Calc --> Grid
```

**In one sentence:** electricity numbers flow down through simple math into a token
balance, the token balance flows through a marketplace and a set of atomic safety
checks into a trade, and every trade leaves a permanent, tamper-evident fingerprint on
a chain of blocks — which is exactly what the Blockchain Explorer page lets you watch
happen, block by block.

