// Routes the frontend's API calls to the in-browser engine. Every route here
// is part of the contract the backend has to implement (docs/DESIGN.md).

import { ApiError } from "../api/client";
import { getEngine, resetEngine, MockError } from "./engine";
import type { HouseholdSettings, RegisterInput } from "../types";

interface Ctx {
  params: string[];
  query: URLSearchParams;
  body: any;
  userId: string | null;
}

type Handler = (ctx: Ctx) => unknown;

interface Route {
  method: "GET" | "POST";
  pattern: RegExp;
  auth: boolean;
  handler: Handler;
}

const e = () => getEngine();
const num = (v: string | null, fallback: number) => (v === null || v === "" ? fallback : Number(v));

function me(ctx: Ctx): string {
  return ctx.userId!;
}

function ownOnly(ctx: Ctx, id: string): string {
  if (ctx.userId !== id) throw new MockError("you can only view your own wallet", 403, "FORBIDDEN");
  return id;
}

const routes: Route[] = [
  // auth
  { method: "POST", pattern: /^\/auth\/login$/, auth: false, handler: ({ body }) => e().login(String(body?.id ?? ""), String(body?.password ?? "")) },
  { method: "POST", pattern: /^\/auth\/register$/, auth: false, handler: ({ body }) => e().register(body as RegisterInput) },

  // households
  { method: "GET", pattern: /^\/households$/, auth: false, handler: () => e().listHouseholds() },
  { method: "GET", pattern: /^\/households\/me\/settings$/, auth: true, handler: (c) => e().getSettings(me(c)) },
  { method: "POST", pattern: /^\/households\/me\/settings$/, auth: true, handler: (c) => e().updateSettings(me(c), c.body as Partial<HouseholdSettings>) },
  { method: "GET", pattern: /^\/households\/([^/]+)$/, auth: false, handler: ({ params }) => e().getHousehold(params[0]) },
  { method: "GET", pattern: /^\/households\/([^/]+)\/history$/, auth: false, handler: ({ params, query }) => e().history(params[0], num(query.get("limit"), 40)) },

  // energy
  {
    method: "POST",
    pattern: /^\/energy\/measurements$/,
    auth: true,
    handler: (c) => e().submitMeasurement(me(c), Number(c.body?.production), Number(c.body?.consumption)),
  },

  // market (auction)
  { method: "GET", pattern: /^\/market\/status$/, auth: false, handler: () => e().marketStatus() },
  { method: "GET", pattern: /^\/market\/price-history$/, auth: false, handler: ({ query }) => e().getPriceHistory(num(query.get("limit"), 48)) },
  { method: "GET", pattern: /^\/market\/auctions\/latest$/, auth: false, handler: () => e().latestAuction() },
  { method: "GET", pattern: /^\/market\/my-bid$/, auth: true, handler: (c) => e().myBid(me(c)) },

  // marketplace (bilateral offers)
  { method: "GET", pattern: /^\/market\/offers$/, auth: false, handler: () => e().activeOffers() },
  { method: "GET", pattern: /^\/market\/offers\/mine$/, auth: true, handler: (c) => e().offersOf(me(c)) },
  { method: "POST", pattern: /^\/market\/offers$/, auth: true, handler: (c) => e().createOffer(me(c), Number(c.body?.amountKwh), Number(c.body?.pricePerKwh)) },
  { method: "POST", pattern: /^\/market\/offers\/([^/]+)\/cancel$/, auth: true, handler: (c) => e().cancelOffer(me(c), c.params[0]) },
  {
    method: "POST",
    pattern: /^\/market\/offers\/([^/]+)\/purchase$/,
    auth: true,
    handler: (c) => e().purchase(me(c), c.params[0], Number(c.body?.amountKwh)),
  },
  { method: "GET", pattern: /^\/trades$/, auth: false, handler: ({ query }) => e().listTrades(query.get("householdId") ?? undefined) },

  // wallet and ledger
  { method: "GET", pattern: /^\/wallet\/([^/]+)$/, auth: true, handler: (c) => e().wallet(ownOnly(c, c.params[0])) },
  { method: "POST", pattern: /^\/wallet\/topup$/, auth: true, handler: (c) => e().topup(me(c), Number(c.body?.amount)) },
  { method: "POST", pattern: /^\/wallet\/cashout$/, auth: true, handler: (c) => e().cashout(me(c), Number(c.body?.amount)) },
  { method: "GET", pattern: /^\/tokens\/history\/([^/]+)$/, auth: true, handler: (c) => e().ledgerFor(ownOnly(c, c.params[0]), num(c.query.get("limit"), 100)) },
  {
    method: "GET",
    pattern: /^\/transactions$/,
    auth: false,
    handler: ({ query }) => e().allLedger(num(query.get("limit"), 100), query.get("asset") ?? undefined),
  },

  // blockchain explorer
  { method: "GET", pattern: /^\/blockchain\/status$/, auth: false, handler: () => e().ledgerStatus() },
  { method: "GET", pattern: /^\/blockchain\/blocks$/, auth: false, handler: ({ query }) => e().listBlocks(num(query.get("limit"), 100)) },
  { method: "GET", pattern: /^\/blockchain\/blocks\/(\d+)$/, auth: false, handler: ({ params }) => e().getBlock(Number(params[0])) },

  // grid and overview
  { method: "GET", pattern: /^\/grid\/status$/, auth: false, handler: () => e().gridStatus() },
  { method: "GET", pattern: /^\/microgrid$/, auth: false, handler: () => e().microgrid() },
  { method: "GET", pattern: /^\/dashboard$/, auth: false, handler: () => e().dashboard() },

  // demo simulation controls
  { method: "POST", pattern: /^\/sim\/pause$/, auth: true, handler: () => (e().pause(), e().marketStatus()) },
  { method: "POST", pattern: /^\/sim\/resume$/, auth: true, handler: () => (e().resume(), e().marketStatus()) },
  { method: "POST", pattern: /^\/sim\/step$/, auth: true, handler: () => (e().step(), e().marketStatus()) },
  { method: "POST", pattern: /^\/sim\/reset$/, auth: true, handler: () => resetEngine().marketStatus() },
];

export async function handleMockRequest<T>(method: string, path: string, body: unknown, token: string | null): Promise<T> {
  // A small delay keeps loading states honest, as with a real network.
  await new Promise((r) => setTimeout(r, 40));

  const [pathname, qs] = path.split("?");
  const query = new URLSearchParams(qs ?? "");
  const userId = token?.startsWith("mock-token:") ? token.slice("mock-token:".length) : null;

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (!match) continue;

    if (route.auth && (!userId || !e().hasHousehold(userId))) {
      throw new ApiError("authentication required", 401, "UNAUTHORIZED");
    }
    try {
      const result = route.handler({ params: match.slice(1), query, body, userId });
      return structuredClone(result) as T;
    } catch (err) {
      if (err instanceof MockError) throw new ApiError(err.message, err.status, err.code);
      throw err;
    }
  }
  throw new ApiError(`no mock route for ${method} ${pathname}`, 404, "NOT_FOUND");
}
