import { Link, useParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { StatusBadge, TypeBadge } from "../components/Badge";
import { ActivityByDay } from "../components/Activity";
import { BatteryIcon, CertificateIcon, LedgerIcon, MarketIcon, RoleIcon, SolarIcon } from "../components/concepts";
import { AXIS_TICK, BigBattery, CHART_MARGIN, COLORS, ChartFrame, ChartTooltip, Key, Legend, SECTION_EMOJI, niceTicks } from "../components/ui";
import { StatusCluster } from "../components/StatusCluster";
import { fmtClock, fmtPrice, fmtSimTime } from "../format";
import type {
  AuctionResult,
  DashboardSummary,
  EnergyMeasurement,
  EnergyOffer,
  Household,
  LedgerTx,
  MicrogridNode,
  SharedBatteryStatus,
  Wallet,
} from "../types";

const SOURCE_LABEL: Record<string, string> = { surplus: "surplus now", storage: "stored energy", battery: "home battery", "grid-pool": "grid pool", deficit: "deficit" };

/**
 * One participant of the microgrid: who they are, what they produce and use,
 * what they store, what they do in the market, and what the ledger says.
 * Only public data is shown for other households; their meter history,
 * wallet and trade history stay private.
 */
export function HouseholdDetailPage() {
  const { id = "" } = useParams();
  const { household: me } = useAuth();
  const isMe = me?.id === id;

  const { data: h, error } = usePolling(() => api.get<Household>(`/households/${id}`), 5000, [id]);
  const { data: nodes } = usePolling(() => api.get<MicrogridNode[]>("/microgrid"), 2500);
  const { data: auction } = usePolling(() => api.get<AuctionResult | null>("/market/auctions/latest"), 2500);
  const { data: offers } = usePolling(() => api.get<EnergyOffer[]>("/market/offers"), 5000);
  const { data: summary } = usePolling(() => api.get<DashboardSummary>("/dashboard"), 5000);
  const { data: grid } = usePolling(() => api.get<SharedBatteryStatus>("/grid/status"), 5000);
  const { data: certTxs } = usePolling(() => api.get<LedgerTx[]>("/transactions?limit=800&asset=CERT"), 5000);
  const { data: myTxs } = usePolling(
    () => (isMe ? api.get<LedgerTx[]>(`/tokens/history/${id}?limit=400`) : Promise.resolve(null)),
    5000,
    [id, isMe]
  );
  // Private to the household itself.
  const { data: meter } = usePolling(
    () => (isMe ? api.get<EnergyMeasurement[]>(`/households/${id}/history?limit=48`) : Promise.resolve(null)),
    5000,
    [id, isMe]
  );
  const { data: wallet } = usePolling(() => (isMe ? api.get<Wallet>(`/wallet/${id}`) : Promise.resolve(null)), 5000, [id, isMe]);

  if (error && !h) {
    return (
      <div className="profile-missing">
        <p>{error instanceof ApiError && error.status === 404 ? "This household is not on the grid." : "Could not load this household."}</p>
        <Link className="card-link" to="/">
          ← Back to the map
        </Link>
      </div>
    );
  }
  // Polling keeps the previous household while the next one loads.
  if (!h || h.id !== id) return <div className="page-loading">Opening the household…</div>;

  const node = nodes?.find((n) => n.id === id);
  const production = node?.production ?? h.currentProduction;
  const consumption = node?.consumption ?? h.currentConsumption;
  const net = production - consumption;
  const state = net > 0.01 ? "supplying" : net < -0.01 ? "drawing" : "balanced";

  const bids = (auction?.bids ?? []).filter((b) => b.participantId === id);
  const myOffers = (offers ?? []).filter((o) => o.sellerId === id);
  const trades = (summary?.recentTrades ?? []).filter((t) => t.sellerId === id || t.buyerId === id);
  const mine = (t: LedgerTx) => t.householdIds.includes(id);
  const certs = (certTxs ?? []).filter(mine);

  return (
    <div className="profile">
      <div className="profile-top">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/">My microgrid</Link>
          <span>/</span>
          <Link to="/households">Households</Link>
          <span>/</span>
          <b>{h.name}</b>
        </nav>
        <StatusCluster />
      </div>

      {/* 01 — who they are */}
      <header className="profile-head">
        <div className="profile-icon">
          <RoleIcon type={h.type} energyType={h.energyType} size={40} />
        </div>
        <div className="profile-id">
          <div className="page-kicker">{isMe ? "Your household" : "Participant"}</div>
          <h1>{h.name}</h1>
          <div className="profile-meta">
            <TypeBadge type={h.type} />
            <span>{h.location}</span>
            {h.type !== "consumer" && <span>{h.energyType} generation</span>}
            {h.settings.auctionOptOut && <span className="tag">outside the auction</span>}
          </div>
        </div>
        <div className={"profile-state " + state}>
          <span className="profile-state-label">{state === "supplying" ? "Supplying the market" : state === "drawing" ? "Drawing from the market" : "Self-sufficient"}</span>
          <span className="profile-state-value">
            {state === "supplying" ? "▲" : state === "drawing" ? "▼" : "="} {Math.abs(net).toFixed(2)}
            <small>kWh/30 min · rate</small>
          </span>
          <Link className="card-link" to={`/?focus=${id}`}>
            Show on the map →
          </Link>
        </div>
      </header>

      <div className="profile-grid">
        <div className="profile-col">
          {/* 02 — producing and consuming */}
          <section className="panel">
            <PanelHead n="02" icon={<SolarIcon size={18} />} title="Energy now" note="Latest meter reading. Rates, in kWh/30 min." />
            <div className="panel-body">
              <BalanceBars production={production} consumption={consumption} />
            </div>
          </section>

          {/* 03 — storing */}
          <section className="panel">
            <PanelHead n="03" icon={<BatteryIcon size={18} />} title="Storage" note="Levels: how much energy is stored right now, in kWh." />
            <div className="panel-body">
              {h.batteryCapacityKwh > 0 ? (
                <BigBattery warnLow label="🏠 Home battery" value={h.batteryChargeKwh} max={h.batteryCapacityKwh} />
              ) : (
                <p className="honest">{h.type === "prosumer" ? "No home battery." : h.type === "producer" ? "Producers have no battery: output is sold in the auction." : "Consumers have no home battery."}</p>
              )}
              {h.type !== "producer" && (
                <BigBattery label="🔋 Rented battery space (community battery)" value={h.storedKwh} max={grid?.rented.capPerHouseholdKwh ?? 10} />
              )}
              <dl className="spec">
                <div>
                  <dt>When the battery is full</dt>
                  <dd>{h.type === "prosumer" ? (h.settings.overflowMode === "store" ? "store in rented space" : "sell in the auction") : "—"}</dd>
                </div>
                <div>
                  <dt>Reserved in open offers</dt>
                  <dd>{h.reservedInOffersKwh.toFixed(2)} kWh</dd>
                </div>
              </dl>
            </div>
          </section>

          {/* Private-to-self numbers */}
          {isMe && wallet ? (
            <section className="panel">
              <PanelHead n="—" icon={<CertificateIcon size={18} />} title="Your wallet" note="Only you see this." />
              <div className="panel-body">
                <dl className="spec">
                  <div>
                    <dt>Available</dt>
                    <dd>{wallet.availableTec.toFixed(2)} TEC</dd>
                  </div>
                  <div>
                    <dt>Held for the auction</dt>
                    <dd>{wallet.reservedTec.toFixed(2)} TEC</dd>
                  </div>
                  <div>
                    <dt>Green share consumed</dt>
                    <dd>{wallet.greenShare.percentGreen}%</dd>
                  </div>
                </dl>
              </div>
            </section>
          ) : (
            <p className="honest private-note">
              Their meter readings, wallet and trade history are private: you see what everyone on the grid can see.
            </p>
          )}
        </div>

        <div className="profile-col">
          {/* 04 — the market */}
          <section className="panel">
            <PanelHead
              n="04"
              icon={<MarketIcon size={18} />}
              title="In the market"
              note={auction ? `Auction for ${fmtSimTime(auction.simTime)} · cleared at ${fmtPrice(auction.clearingPrice)} TEC/kWh` : "No auction yet"}
            />
            <div className="panel-body">
              {bids.length === 0 ? (
                <p className="honest">{h.settings.auctionOptOut ? "Stays out of the auction: exports at the floor, imports at the ceiling." : "No bid in the last auction."}</p>
              ) : (
                <table className="dense">
                  <thead>
                    <tr>
                      <th>Side</th>
                      <th>From</th>
                      <th className="num">kWh</th>
                      <th className="num">Limit</th>
                      <th className="num">Matched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bids.map((b) => (
                      <tr key={b.id}>
                        <td className={b.side === "sell" ? "supply" : "demand"}>{b.side === "sell" ? "▲ sell" : "▼ buy"}</td>
                        <td>{SOURCE_LABEL[b.source] ?? b.source}</td>
                        <td className="num">{b.quantity.toFixed(2)}</td>
                        <td className="num">{b.limitPrice.toFixed(3)}</td>
                        <td className={"num " + (b.matched > 0 ? (b.side === "sell" ? "supply" : "demand") : "muted")}>{b.matched.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h3 className="sub-head" style={{ marginTop: 18 }}>
                Marketplace
              </h3>
              {myOffers.length === 0 && trades.length === 0 ? (
                <p className="honest">No open offers, and no recent marketplace trade.</p>
              ) : (
                <table className="dense">
                  <tbody>
                    {myOffers.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <StatusBadge status={o.status} />
                        </td>
                        <td>offer, until {fmtClock(o.expiresAtSimTime)}</td>
                        <td className="num">{o.amountRemainingKwh.toFixed(2)} kWh</td>
                        <td className="num">{o.pricePerKwh.toFixed(3)}</td>
                      </tr>
                    ))}
                    {trades.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <span className={t.sellerId === id ? "supply" : "demand"}>{t.sellerId === id ? "▲ sold" : "▼ bought"}</span>
                        </td>
                        <td>{t.sellerId === id ? `to ${t.buyerName}` : `from ${t.sellerName}`}</td>
                        <td className="num">{t.amountKwh.toFixed(2)} kWh</td>
                        <td className="num">{t.pricePerKwh.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* 05 — history */}
          <section className="panel">
            <PanelHead
              n="05"
              icon={<SolarIcon size={18} />}
              title="Energy history"
              note={isMe ? "Your meter readings, kWh per half hour." : "Green energy they produced and used, per half hour."}
            />
            <div className="panel-body">{isMe ? <MeterChart rows={meter ?? []} /> : <CertificateChart txs={certs} />}</div>
          </section>

          {/* 06 — your activity (only on your own profile; others' accounts are private) */}
          {isMe && (
            <section className="panel">
              <PanelHead n="06" icon={<LedgerIcon size={18} />} title="Your activity" note="Summed per day. Open a day to see what happened in it." />
              <div className="panel-body">
                <ActivityByDay txs={myTxs ?? []} accountId={h.accountId ?? ""} maxDays={7} />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function PanelHead({ n, icon, title, note }: { n: string; icon: React.ReactNode; title: string; note?: string }) {
  return (
    <header className="panel-head">
      <span className="panel-n">{n}</span>
      {!SECTION_EMOJI[title] && <span className="panel-icon">{icon}</span>}
      <span>
        <h2>
          {SECTION_EMOJI[title] && <span className="emoji" aria-hidden>{SECTION_EMOJI[title]}</span>}
          {title}
        </h2>
        {note && <p>{note}</p>}
      </span>
    </header>
  );
}

/** Production and consumption on one scale; the difference is what goes to, or comes from, the market. */
function BalanceBars({ production, consumption }: { production: number; consumption: number }) {
  const max = Math.max(production, consumption, 0.01);
  const net = production - consumption;
  const rows = [
    { label: "Produced", v: production, cls: "bar-supply" },
    { label: "Used", v: consumption, cls: "bar-demand" },
  ];
  return (
    <div className="balance">
      {rows.map((r) => (
        <div key={r.label} className="balance-row">
          <span>{r.label}</span>
          <span className="balance-track">
            <span className={r.cls} style={{ width: `${(r.v / max) * 100}%` }} />
          </span>
          <b>{r.v.toFixed(2)}</b>
        </div>
      ))}
      <div className="balance-row net">
        <span>Net</span>
        <span className={"balance-net " + (net > 0.01 ? "supply" : net < -0.01 ? "demand" : "muted")}>
          {net > 0.01 ? "▲ to the market" : net < -0.01 ? "▼ from the market" : "= balanced"}
        </span>
        <b className={net > 0.01 ? "supply" : net < -0.01 ? "demand" : ""}>{Math.abs(net).toFixed(2)}</b>
      </div>
    </div>
  );
}

function MeterChart({ rows }: { rows: EnergyMeasurement[] }) {
  if (rows.length === 0) return <p className="honest">No readings yet.</p>;
  const data = rows
    .slice()
    .sort((a, b) => a.simTime - b.simTime)
    .map((m) => ({ time: fmtClock(m.simTime), production: m.production, consumption: m.consumption }));
  const yTicks = niceTicks(Math.max(0.5, ...data.map((d) => Math.max(d.production, d.consumption))));
  const UNIT_Y = "kWh per half hour";
  return (
    <figure className="figure">
      <Legend>
        <Key kind="line" color={COLORS.supply}>
          Production
        </Key>
        <Key kind="line" color={COLORS.demand}>
          Consumption
        </Key>
      </Legend>
      <ChartFrame y={UNIT_Y} x="time of day (simulated)">
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid stroke={COLORS.ruleSoft} />
          <XAxis dataKey="time" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: COLORS.rule }} minTickGap={32} />
          <YAxis width={40} tick={AXIS_TICK} tickLine={false} axisLine={false} ticks={yTicks} domain={[0, yTicks[yTicks.length - 1]]} />
          <Tooltip
            cursor={{ stroke: COLORS.ink, strokeWidth: 1 }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                title={label}
                rows={(payload ?? []).map((p) => ({ label: String(p.name), value: `${Number(p.value).toFixed(2)} kWh`, color: String(p.color) }))}
              />
            )}
          />
          <Area type="monotone" dataKey="production" name="Production" stroke={COLORS.supply} strokeWidth={2} fill={COLORS.supply} fillOpacity={0.1} isAnimationActive={false} />
          <Area type="monotone" dataKey="consumption" name="Consumption" stroke={COLORS.demand} strokeWidth={2} fill={COLORS.demand} fillOpacity={0.1} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
      </ChartFrame>
    </figure>
  );
}

/** Green kWh issued and retired per half hour, read from certificate movements. */
function CertificateChart({ txs }: { txs: LedgerTx[] }) {
  const byTime = new Map<number, { issued: number; retired: number }>();
  for (const t of txs) {
    if (t.type !== "CERT_ISSUE" && t.type !== "CERT_RETIRE") continue;
    const row = byTime.get(t.simTime) ?? { issued: 0, retired: 0 };
    if (t.type === "CERT_ISSUE") row.issued += t.amount;
    else row.retired += t.amount;
    byTime.set(t.simTime, row);
  }
  const data = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, v]) => ({ time: fmtClock(time), ...v }));
  if (data.length === 0) return <p className="honest">No certificate movements in the recent ledger.</p>;
  const yTicks = niceTicks(Math.max(0.5, ...data.map((d) => Math.max(d.issued, d.retired))));
  const UNIT_Y = "kWh per half hour";
  return (
    <figure className="figure">
      <Legend>
        <Key kind="line" color={COLORS.supply}>
          ☀️ Green energy produced
        </Key>
        <Key kind="line" color={COLORS.demand}>
          🏠 Green energy used
        </Key>
      </Legend>
      <ChartFrame y={UNIT_Y} x="time of day (simulated)">
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid stroke={COLORS.ruleSoft} />
          <XAxis dataKey="time" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: COLORS.rule }} minTickGap={32} />
          <YAxis width={40} tick={AXIS_TICK} tickLine={false} axisLine={false} ticks={yTicks} domain={[0, yTicks[yTicks.length - 1]]} />
          <Tooltip
            cursor={{ stroke: COLORS.ink, strokeWidth: 1 }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                title={label}
                rows={(payload ?? []).map((p) => ({ label: String(p.name), value: `${Number(p.value).toFixed(3)} kWh`, color: String(p.color) }))}
              />
            )}
          />
          <Area type="stepAfter" dataKey="issued" name="Issued" stroke={COLORS.supply} strokeWidth={2} fill={COLORS.supply} fillOpacity={0.1} isAnimationActive={false} />
          <Area type="stepAfter" dataKey="retired" name="Retired" stroke={COLORS.demand} strokeWidth={2} fill={COLORS.demand} fillOpacity={0.1} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
      </ChartFrame>
    </figure>
  );
}
