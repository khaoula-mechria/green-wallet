import { useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { PriceChart } from "../components/PriceChart";
import { MarketNow } from "../components/MarketNow";
import { ActivityByDay } from "../components/Activity";
import { GridScene, SceneLegend, useLiveScene } from "../components/LivingGrid";
import { NeighbourGroup } from "../components/Neighbours";
import { PageHead, Section } from "../components/ui";
import { UnitsKey } from "../components/units";
import {
  BatteryIcon,
  CertificateIcon,
  CommunityBatteryIcon,
  GridIcon,
  HomeIcon,
  MarketIcon,
} from "../components/concepts";
import { fmtPrice } from "../format";
import type { AuctionResult, DashboardSummary, LedgerTx, MyBidPreview, PricePoint } from "../types";

const SOURCE_LABEL: Record<string, string> = { surplus: "spare production", storage: "stored energy", battery: "home battery", "grid-pool": "grid pool", deficit: "deficit" };

/** The command centre: where you are, what is happening around you, and what the market is doing. */
export function DashboardPage() {
  const { household } = useAuth();
  const navigate = useNavigate();
  const scene = useLiveScene();
  const [params] = useSearchParams();
  // "Show on the map" from a household profile lands here with that household in focus.
  const [focus, setFocus] = useState<string | null>(params.get("focus"));
  const { data, loading } = usePolling(() => api.get<DashboardSummary>("/dashboard"), 2500);
  const { data: history } = usePolling(() => api.get<PricePoint[]>("/market/price-history?limit=96"), 2500);
  const { data: auction } = usePolling(() => api.get<AuctionResult | null>("/market/auctions/latest"), 2500);
  const { data: myBid } = usePolling(() => api.get<MyBidPreview>("/market/my-bid"), 2500, [household?.id]);
  const { data: activity } = usePolling(() => api.get<LedgerTx[]>(`/tokens/history/${household!.id}?limit=400`), 2500, [household?.id]);

  if (loading && !data) return <div className="page-loading">Reading the grid…</div>;
  if (!data || !household) return null;

  const me = scene?.nodes.find((n) => n.id === household.id);
  const neighbours = (scene?.nodes ?? []).filter((n) => n.id !== household.id);
  const sb = data.sharedBattery;
  const communityKwh = sb.rented.usedKwh + sb.gridPool.chargeKwh;
  const communityPct = sb.capacityKwh > 0 ? Math.round((communityKwh / sb.capacityKwh) * 100) : 0;
  const vsAvg = data.lastPrice !== null && data.avg24h > 0 ? ((data.lastPrice - data.avg24h) / data.avg24h) * 100 : null;
  const importing = auction?.importedKwh ?? 0;
  const exporting = auction?.exportedKwh ?? 0;
  const batteryFlow = scene?.batteryFlow ?? 0;

  return (
    <div>
      <PageHead
        kicker="Grid"
        title="My microgrid"
        lede={`Your home at the centre of ${neighbours.length} neighbours. The strip below is this half hour at a glance; the map shows where the energy goes.`}
      />

      <div className="ticker" role="list">
        <Tick
          icon={<HomeIcon size={16} />}
          label="You · now"
          kind="rate"
          value={me ? `${me.flow > 0.01 ? "▲" : me.flow < -0.01 ? "▼" : "="} ${Math.abs(me.flow).toFixed(2)}` : "—"}
          unit="kWh/30 min"
          sub={me ? (me.flow > 0.01 ? "supplying (meter)" : me.flow < -0.01 ? "drawing (meter)" : "self-sufficient") : ""}
          tone={me ? (me.flow > 0.01 ? "up" : me.flow < -0.01 ? "down" : undefined) : undefined}
        />
        <Tick
          icon={<MarketIcon size={16} />}
          label="Clearing price"
          kind="rate"
          value={fmtPrice(data.lastPrice)}
          unit="TEC/kWh"
          sub={vsAvg === null ? "no trade yet" : `${vsAvg >= 0 ? "▲" : "▼"} ${Math.abs(vsAvg).toFixed(0)}% vs 24 h avg`}
        />
        {household.batteryCapacityKwh > 0 ? (
          <Tick
            icon={<BatteryIcon size={16} level={household.batteryChargeKwh / household.batteryCapacityKwh} />}
            label="My battery"
            kind="level"
            value={`${Math.round((household.batteryChargeKwh / household.batteryCapacityKwh) * 100)}`}
            unit="%"
            sub={`${household.batteryChargeKwh.toFixed(1)} of ${household.batteryCapacityKwh} kWh stored`}
          />
        ) : (
          <Tick icon={<BatteryIcon size={16} level={0} />} label="My storage" kind="level" value={household.storedKwh.toFixed(2)} unit="kWh" sub="stored in rented space" />
        )}
        <Tick
          icon={<CommunityBatteryIcon size={16} />}
          label="Community battery"
          kind="level"
          value={`${communityPct}`}
          unit="%"
          sub={`${communityKwh.toFixed(0)} of ${sb.capacityKwh} kWh · ${batteryFlow > 0.02 ? "▲ charging" : batteryFlow < -0.02 ? "▼ releasing" : "holding"}`}
          tone={batteryFlow > 0.02 ? "up" : batteryFlow < -0.02 ? "down" : undefined}
        />
        <Tick
          icon={<GridIcon size={16} />}
          label="Utility grid"
          kind="rate"
          value={(importing > 0.005 ? importing : exporting).toFixed(2)}
          unit="kWh/30 min"
          sub={importing > 0.005 ? "▶ importing" : exporting > 0.005 ? "◀ exporting" : "not needed"}
          tone={importing > 0.005 || exporting > 0.005 ? "grid" : undefined}
        />
        <Tick icon={<CertificateIcon size={16} />} label="Green share" kind="share" value={`${data.greenShare.percentGreen}`} unit="%" sub="of all kWh consumed" />
      </div>

      <UnitsKey />

      <div className="command">
        <section className="panel map-panel">
          <header className="panel-head">
            <span>
              <h2>Energy neighbourhood</h2>
              <p>You are at the centre. Dots are the kWh that moved in the last half hour. Select a home to open its profile.</p>
            </span>
          </header>
          {scene ? <GridScene state={scene} youId={household.id} highlightId={focus} onHover={setFocus} labels="names" /> : <div className="lg lg-loading" />}
          <footer className="panel-foot">
            <SceneLegend />
          </footer>
        </section>

        <aside className="panel around">
          <div className="you-block">
            <div className="you-block-head">
              <span>📍 Your agent now</span>
              <Link className="card-link" to={`/households/${household.id}`}>
                Profile →
              </Link>
            </div>
            <MyBid bid={myBid} />
          </div>

          <div className="around-list">
            <NeighbourGroup title="Supplying" tone="up" nodes={neighbours.filter((n) => n.flow > 0.01)} focus={focus} onFocus={setFocus} onOpen={(id) => navigate(`/households/${id}`)} />
            <NeighbourGroup title="Drawing" tone="down" nodes={neighbours.filter((n) => n.flow < -0.01)} focus={focus} onFocus={setFocus} onOpen={(id) => navigate(`/households/${id}`)} />
            <NeighbourGroup
              title="Self-sufficient"
              tone="eq"
              nodes={neighbours.filter((n) => Math.abs(n.flow) <= 0.01)}
              focus={focus}
              onFocus={setFocus}
              onOpen={(id) => navigate(`/households/${id}`)}
            />
          </div>
        </aside>
      </div>

      <div className="card-grid card-grid-2">
        <Section title="Market now" note="How much energy is on sale, how much is wanted, and what you can buy right now.">
          <MarketNow />
        </Section>

        <Section title="Price today" note="One price per half hour, always between what the utility pays and what it charges.">
          <PriceChart points={history ?? []} band={data.band} />
        </Section>
      </div>

      <Section title="Your activity" note="Summed per day. Open a day to see what happened in it.">
        <ActivityByDay txs={activity ?? []} accountId={household.accountId ?? ""} maxDays={3} />
        <Link className="card-link" to="/wallet" style={{ marginTop: 10 }}>
          All activity in your wallet →
        </Link>
      </Section>
    </div>
  );
}

function Tick({ icon, label, value, unit, sub, tone, kind }: { icon: ReactNode; label: string; value: string; unit: string; sub: string; tone?: "up" | "down" | "grid"; kind: "rate" | "level" | "share" }) {
  return (
    <div className={"tick" + (tone ? ` ${tone}` : "")} role="listitem">
      <div className="tick-label">
        <span className="tick-icon">{icon}</span>
        {label}
        <span className={`tick-kind kind-${kind}`}>{kind}</span>
      </div>
      <div className="tick-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className="tick-sub">{sub}</div>
    </div>
  );
}

/** Am I buying or selling? The automatic bid for the half hour in progress, in plain words. */
function MyBid({ bid }: { bid: MyBidPreview | null }) {
  if (!bid) return <p className="you-line muted">Reading your bid…</p>;
  if (bid.optedOut) return <p className="you-line">You stay out of the auction: spare energy goes to the utility, missing energy comes from it.</p>;
  if (!bid.side || bid.bids.length === 0) {
    return (
      <p className="you-line">
        {bid.pendingBuyKwh > 0 ? "You need energy but have no TEC left: it comes from the utility. Top up to buy from neighbours." : "Nothing to trade this half hour."}
      </p>
    );
  }
  const total = bid.bids.reduce((s, b) => s + b.quantity, 0);
  const selling = bid.side === "sell";
  return (
    <div>
      <p className={"you-state " + (selling ? "supply" : "demand")}>
        {selling ? "▲ Selling" : "▼ Buying"} {total.toFixed(2)} <small>kWh/30 min</small>
      </p>
      {bid.bids.map((b, i) => (
        <p key={i} className="you-line">
          {selling ? `${b.quantity.toFixed(2)} from your ${SOURCE_LABEL[b.source] ?? b.source}, for at least ` : `${b.quantity.toFixed(2)} for your missing energy, paying at most `}
          <b className="mono">{b.limitPrice.toFixed(3)} TEC/kWh</b>
        </p>
      ))}
    </div>
  );
}
