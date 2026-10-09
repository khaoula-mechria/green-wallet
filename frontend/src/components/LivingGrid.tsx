import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { RoleIcon } from "./concepts";
import type { AuctionResult, EnergySource, HouseholdType, MarketStatus, MicrogridNode, SharedBatteryStatus } from "../types";

/**
 * The energy neighbourhood: Green Wallet's map. The signed-in household sits
 * at the centre; every other participant of the simulated microgrid is placed
 * around it, nearest first. Particles carry the kWh that actually moved in the
 * last half hour — surplus to the market, consumption into homes, charge into
 * the community battery, import and export through the utility connection —
 * and every arrival leaves a faint pulse. Each home shows its market state;
 * hovering previews it, clicking opens its profile.
 */

export interface SceneNode {
  id: string;
  name: string;
  type: HouseholdType;
  energyType: EnergySource;
  location: string;
  production: number;
  consumption: number;
  /** kWh exchanged with the local market this half hour: + supplied, − drawn. */
  flow: number;
  /** Home battery charge 0..1, or null without one. */
  batteryLevel: number | null;
}

export interface SceneState {
  nodes: SceneNode[];
  batteryKwh: number;
  batteryCapacityKwh: number;
  /** kWh into (+) or out of (−) the community battery this half hour. */
  batteryFlow: number;
  importKwh: number;
  exportKwh: number;
  price: number | null;
  minuteOfDay: number;
  paused: boolean;
}

type Pt = { x: number; y: number };

const W = 1000;
const H = 640;
const SKY_H = 104;
const CENTRE: Pt = { x: 470, y: 330 };
const HUB: Pt = { x: 590, y: 385 };
const BATTERY: Pt = { x: 728, y: 452 };
const PYLON: Pt = { x: 92, y: 492 };
const FARM_PLOTS: Pt[] = [
  { x: 200, y: 168 },
  { x: 805, y: 172 },
  { x: 930, y: 262 },
  { x: 86, y: 262 },
];
/** Home plots around the centre, ordered so that a few neighbours already surround you. */
const HOME_PLOTS: Pt[] = [
  { x: 450, y: 205 },
  { x: 395, y: 485 },
  { x: 625, y: 250 },
  { x: 235, y: 385 },
  { x: 780, y: 325 },
  { x: 310, y: 265 },
  { x: 585, y: 535 },
  { x: 865, y: 455 },
  { x: 645, y: 140 },
  { x: 240, y: 575 },
  { x: 735, y: 590 },
  { x: 120, y: 375 },
  { x: 955, y: 365 },
  { x: 925, y: 570 },
];

const LEAF = "#3B9A65";
const AMBER = "#CC6E1E";
const SKY = "#2F7FB5";

// ---------------------------------------------------------------- geometry

/** Isometric projection around an anchor (the object's footprint centre on the ground). */
const iso = (a: Pt, x: number, y: number, z: number): [number, number] => [a.x + (x - y), a.y + (x + y) / 2 - z];
const poly = (a: Pt, pts: Array<[number, number, number]>) =>
  pts.map(([x, y, z]) => iso(a, x, y, z).map((n) => n.toFixed(1)).join(",")).join(" ");

interface Edge {
  id: string;
  /** Node at the start of the path and at its end (pulses go to whichever receives). */
  a: string;
  b: string;
  d: string;
  pts: Pt[];
  cum: number[];
  len: number;
  kind: "local" | "grid";
}

/** A wire that follows the isometric "streets": along one axis, a rounded turn, then the other. */
function route(id: string, a: string, b: string, p: Pt, h: Pt, flip: boolean, kind: Edge["kind"]): Edge {
  const dx = h.x - p.x;
  const dy = h.y - p.y;
  const along = (dx + 2 * dy) / 4; // steps on (2, 1)
  const across = (2 * dy - dx) / 4; // steps on (-2, 1)
  const c = flip ? { x: p.x - 2 * across, y: p.y + across } : { x: p.x + 2 * along, y: p.y + along };
  const l1 = Math.hypot(c.x - p.x, c.y - p.y);
  const l2 = Math.hypot(h.x - c.x, h.y - c.y);
  const pts: Pt[] = [];
  const line = (s: Pt, e: Pt) => {
    const n = Math.max(1, Math.ceil(Math.hypot(e.x - s.x, e.y - s.y) / 5));
    for (let i = 0; i <= n; i++) pts.push({ x: s.x + ((e.x - s.x) * i) / n, y: s.y + ((e.y - s.y) * i) / n });
  };
  let d: string;
  if (l1 < 2 || l2 < 2) {
    line(p, h);
    d = `M${p.x},${p.y} L${h.x},${h.y}`;
  } else {
    const r = Math.min(24, l1 / 2, l2 / 2);
    const c1 = { x: c.x + ((p.x - c.x) / l1) * r, y: c.y + ((p.y - c.y) / l1) * r };
    const c2 = { x: c.x + ((h.x - c.x) / l2) * r, y: c.y + ((h.y - c.y) / l2) * r };
    line(p, c1);
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      const u = 1 - t;
      pts.push({ x: u * u * c1.x + 2 * u * t * c.x + t * t * c2.x, y: u * u * c1.y + 2 * u * t * c.y + t * t * c2.y });
    }
    line(c2, h);
    d = `M${p.x},${p.y} L${c1.x.toFixed(1)},${c1.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} L${h.x},${h.y}`;
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { id, a, b, d, pts, cum, len: cum[cum.length - 1], kind };
}

function pointAt(e: Edge, s: number): Pt {
  if (s <= 0) return e.pts[0];
  if (s >= e.len) return e.pts[e.pts.length - 1];
  let lo = 0;
  let hi = e.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (e.cum[mid] < s) lo = mid;
    else hi = mid;
  }
  const t = (s - e.cum[lo]) / (e.cum[hi] - e.cum[lo] || 1);
  return { x: e.pts[lo].x + (e.pts[hi].x - e.pts[lo].x) * t, y: e.pts[lo].y + (e.pts[hi].y - e.pts[lo].y) * t };
}

/** Which way, and how much, energy moves on an edge: [start→end, end→start]. */
function flowsOn(e: Edge, st: SceneState): [number, number] {
  if (e.id === "grid") return [st.importKwh, st.exportKwh];
  if (e.id === "battery") return [Math.max(0, st.batteryFlow), Math.max(0, -st.batteryFlow)];
  const n = st.nodes.find((x) => x.id === e.a);
  if (!n) return [0, 0];
  return [Math.max(0, n.flow), Math.max(0, -n.flow)];
}

/** Small deterministic random numbers, so the landscape is the same on every visit. */
function seeded(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type MarketState = "supplying" | "drawing" | "balanced";
const stateOf = (n: SceneNode): MarketState => (n.flow > 0.01 ? "supplying" : n.flow < -0.01 ? "drawing" : "balanced");

// ---------------------------------------------------------------- time of day

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mix = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

function daylight(minute: number) {
  const h = minute / 60;
  // 0 in full day, 1 in deep night, ramps at dawn (5–7.5) and dusk (17.5–20).
  const night = h < 5 || h > 20 ? 1 : h < 7.5 ? 1 - (h - 5) / 2.5 : h > 17.5 ? (h - 17.5) / 2.5 : 0;
  const golden = h > 5 && h < 8.5 ? 1 - Math.abs(h - 6.75) / 1.75 : h > 16.5 && h < 20 ? 1 - Math.abs(h - 18.25) / 1.75 : 0;
  const skyDay = mix("#dbe6ea", "#efdcc6", clamp01(golden));
  return {
    night,
    skyTop: mix(skyDay, "#4f5f74", night),
    skyLow: mix(mix("#eef0e8", "#f3e3cc", clamp01(golden)), "#939eab", night),
    sunT: (minute - 360) / 720,
  };
}

// ---------------------------------------------------------------- scene

export function GridScene({
  state,
  youId,
  showYou = true,
  interactive = true,
  highlightId = null,
  onHover,
  labels = "values",
}: {
  state: SceneState;
  /** The household at the centre of the map. */
  youId?: string;
  /** Mark the centre as "your home" (false on the illustrative login scene). */
  showYou?: boolean;
  interactive?: boolean;
  /** A participant highlighted from outside the map (e.g. a list beside it). */
  highlightId?: string | null;
  onHover?: (id: string | null) => void;
  /** "names" when the figures are already shown next to the map (the dashboard strip). */
  labels?: "values" | "names";
}) {
  const navigate = useNavigate();
  const [hovered, setHoveredState] = useState<string | null>(null);
  const setHovered = (id: string | null) => {
    setHoveredState(id);
    onHover?.(id);
  };
  const stateRef = useRef(state);
  stateRef.current = state;

  const particleLayer = useRef<SVGGElement>(null);
  const halos = useRef(new Map<string, SVGEllipseElement>());
  const rotors = useRef(new Map<string, SVGGElement>());
  const reduceMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);

  // Where everyone lives: you at the centre, homes around you nearest first, producers on the outer plots.
  const idsKey = state.nodes.map((n) => n.id).join(",");
  const layout = useMemo(() => {
    const byId = [...state.nodes].sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }));
    const centre = byId.find((n) => n.id === youId) ?? byId.find((n) => n.type === "prosumer") ?? byId[0];
    const others = byId.filter((n) => n !== centre);
    const producers = others.filter((n) => n.type === "producer");
    const prosumers = others.filter((n) => n.type === "prosumer");
    const consumers = others.filter((n) => n.type === "consumer");
    const homes: SceneNode[] = [];
    for (let i = 0; i < Math.max(prosumers.length, consumers.length); i++) {
      if (prosumers[i]) homes.push(prosumers[i]);
      if (consumers[i]) homes.push(consumers[i]);
    }
    const placed = new Map<string, { at: Pt; plot: number; farm: boolean; centre: boolean }>();
    if (centre) placed.set(centre.id, { at: CENTRE, plot: -1, farm: centre.type === "producer", centre: true });
    producers.slice(0, FARM_PLOTS.length).forEach((n, i) => placed.set(n.id, { at: FARM_PLOTS[i], plot: i, farm: true, centre: false }));
    homes.slice(0, HOME_PLOTS.length).forEach((n, i) => placed.set(n.id, { at: HOME_PLOTS[i], plot: i, farm: false, centre: false }));
    return { placed, centreId: centre?.id, hidden: state.nodes.length - placed.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, youId]);

  const edges = useMemo(() => {
    const list: Edge[] = [];
    for (const [id, p] of layout.placed) list.push(route(id, id, "hub", p.at, HUB, p.centre ? true : p.plot % 2 === 1, "local"));
    list.push(route("battery", "hub", "battery", HUB, BATTERY, false, "local"));
    list.push(route("grid", "grid", "hub", PYLON, HUB, true, "grid"));
    return list;
  }, [layout]);

  // A landscape scattered around the network, never on a wire or a plot.
  const trees = useMemo(() => {
    const rand = seeded(11);
    const solid: Array<[Pt, number]> = [
      ...[...layout.placed.values()].map((p) => [p.at, p.centre ? 92 : p.farm ? 80 : 54] as [Pt, number]),
      [HUB, 50],
      [BATTERY, 58],
      [PYLON, 46],
    ];
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < 400 && out.length < 34; i++) {
      const p = { x: 20 + rand() * (W - 40), y: SKY_H + 22 + rand() * (H - SKY_H - 34) };
      if (solid.some(([q, r]) => Math.hypot((p.x - q.x) * 0.8, p.y - q.y) < r)) continue;
      if (edges.some((e) => e.pts.some((q, k) => k % 3 === 0 && Math.hypot(p.x - q.x, p.y - q.y) < 20))) continue;
      if (out.some(([x, y]) => Math.hypot(p.x - x, p.y - y) < 34)) continue;
      out.push([p.x, p.y, 0.75 + rand() * 0.4]);
    }
    return out;
  }, [layout, edges]);

  // The particle engine: imperative SVG, one animation frame loop, no React re-renders.
  useEffect(() => {
    const layer = particleLayer.current;
    if (!layer || reduceMotion) return;
    const NS = "http://www.w3.org/2000/svg";
    type Particle = { s: number; v: number; el: SVGGElement; edge: Edge; dir: 1 | -1 };
    const parts: Particle[] = [];
    const credit = new Map<string, number>();
    const glow = new Map<string, number>();
    const angle = new Map<string, number>();
    let last = performance.now();
    let raf = 0;

    const spawn = (edge: Edge, dir: 1 | -1, kwh: number) => {
      const color = edge.kind === "grid" ? SKY : LEAF;
      const r = 2.5 + Math.min(1.7, 0.6 * Math.log1p(kwh));
      const g = document.createElementNS(NS, "g");
      g.setAttribute("opacity", "0");
      const halo = document.createElementNS(NS, "circle");
      halo.setAttribute("r", (r * 2.4).toFixed(1));
      halo.setAttribute("fill", color);
      halo.setAttribute("opacity", "0.18");
      const core = document.createElementNS(NS, "circle");
      core.setAttribute("r", r.toFixed(1));
      core.setAttribute("fill", color);
      const spark = document.createElementNS(NS, "circle");
      spark.setAttribute("r", (r * 0.42).toFixed(1));
      spark.setAttribute("fill", "#ffffff");
      spark.setAttribute("opacity", "0.9");
      g.append(halo, core, spark);
      layer.appendChild(g);
      parts.push({ s: 0, v: 56 + 9 * Math.log1p(kwh) + Math.random() * 12, el: g, edge, dir });
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = stateRef.current;

      for (const e of edges) {
        const [fwd, back] = flowsOn(e, st);
        for (const [dir, kwh] of [
          [1, fwd],
          [-1, back],
        ] as const) {
          const key = e.id + dir;
          if (st.paused || kwh < 0.02) {
            credit.delete(key);
            continue;
          }
          // Denser for more kWh, but sub-linear so a farm doesn't flood the map.
          const rate = Math.min(4.2, 0.22 + 0.72 * Math.sqrt(kwh));
          let c = (credit.get(key) ?? Math.random()) + rate * dt;
          while (c >= 1) {
            c -= 1;
            spawn(e, dir, kwh);
          }
          credit.set(key, c);
        }
      }

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.s += p.v * dt;
        if (p.s >= p.edge.len) {
          p.el.remove();
          parts.splice(i, 1);
          const target = p.dir === 1 ? p.edge.b : p.edge.a;
          glow.set(target, Math.min(1, (glow.get(target) ?? 0) + (target === "hub" ? 0.12 : 0.45)));
          continue;
        }
        const pt = pointAt(p.edge, p.dir === 1 ? p.s : p.edge.len - p.s);
        const fade = Math.min(1, p.s / 18, (p.edge.len - p.s) / 18);
        p.el.setAttribute("transform", `translate(${pt.x.toFixed(1)},${pt.y.toFixed(1)})`);
        p.el.setAttribute("opacity", fade.toFixed(2));
      }

      // Arrival pulses fade out over about a second.
      for (const [id, el] of halos.current) {
        const g = (glow.get(id) ?? 0) * Math.exp(-2.4 * dt);
        glow.set(id, g);
        el.setAttribute("opacity", (g * 0.75).toFixed(3));
        el.setAttribute("transform", `scale(${(0.85 + 0.35 * g).toFixed(3)})`);
      }

      // Turbines turn with their output.
      for (const [key, el] of rotors.current) {
        const n = st.nodes.find((x) => x.id === key.split("#")[0]);
        const speed = st.paused ? 0.1 : 0.25 + Math.min(2.6, (n?.production ?? 0) * 0.28);
        const a = ((angle.get(key) ?? Math.random() * 360) + speed * dt * 57.3) % 360;
        angle.set(key, a);
        el.setAttribute("transform", `rotate(${a.toFixed(1)})`);
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      parts.forEach((p) => p.el.remove());
    };
  }, [edges, reduceMotion]);

  const light = daylight(state.minuteOfDay);
  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));
  const batteryLevel = state.batteryCapacityKwh > 0 ? clamp01(state.batteryKwh / state.batteryCapacityKwh) : 0;
  const centreIsYou = showYou && Boolean(youId) && layout.centreId === youId;

  const open = (path: string) => () => interactive && navigate(path);

  // Back-to-front drawing order for everything standing on the ground.
  type Drawable = { y: number; el: JSX.Element };
  const drawables: Drawable[] = [];
  for (const [x, y, s] of trees) drawables.push({ y, el: <Tree key={`t${x.toFixed(0)}-${y.toFixed(0)}`} at={{ x, y }} s={s} /> });
  for (const [id, p] of layout.placed) {
    const n = nodeById.get(id)!;
    const scale = p.centre ? 1.22 : 1;
    const el = p.farm ? (
      n.energyType === "wind" ? (
        <WindFarm key={id} at={p.at} rotorRef={(i, r) => (r ? rotors.current.set(`${id}#${i}`, r) : rotors.current.delete(`${id}#${i}`))} />
      ) : (
        <SolarFarm key={id} at={p.at} />
      )
    ) : (
      <House key={id} at={p.at} node={n} scale={scale} muted={!p.centre} />
    );
    drawables.push({ y: p.at.y, el });
  }
  drawables.push({ y: HUB.y, el: <Substation key="hub" at={HUB} /> });
  drawables.push({ y: BATTERY.y, el: <CommunityBattery key="battery" at={BATTERY} level={batteryLevel} /> });
  drawables.push({ y: PYLON.y, el: <Pylon key="pylon" at={PYLON} /> });
  drawables.sort((p, q) => p.y - q.y);

  const haloRef = (id: string) => (el: SVGEllipseElement | null) => (el ? halos.current.set(id, el) : halos.current.delete(id));
  const anchors: Array<{ id: string; at: Pt; tone: string; rx: number }> = [
    ...[...layout.placed].map(([id, p]) => ({ id, at: p.at, tone: LEAF, rx: p.farm ? 62 : p.centre ? 46 : 36 })),
    { id: "hub", at: HUB, tone: LEAF, rx: 30 },
    { id: "battery", at: BATTERY, tone: LEAF, rx: 40 },
    { id: "grid", at: PYLON, tone: SKY, rx: 30 },
  ];

  const supplying = state.nodes.filter((n) => n.flow > 0.01);
  const drawing = state.nodes.filter((n) => n.flow < -0.01);
  const summary =
    `Microgrid map: ${supplying.length} participants supplying ${supplying.reduce((s, n) => s + n.flow, 0).toFixed(1)} kWh, ` +
    `${drawing.length} drawing ${drawing.reduce((s, n) => s - n.flow, 0).toFixed(1)} kWh. ` +
    `Community battery ${Math.round(batteryLevel * 100)}%. Utility import ${state.importKwh.toFixed(1)} kWh, export ${state.exportKwh.toFixed(1)} kWh.`;

  const focusId = hovered ?? highlightId;
  const focusNode = focusId ? nodeById.get(focusId) : undefined;
  const focusPlace = focusId ? layout.placed.get(focusId) : undefined;
  const you = layout.centreId ? nodeById.get(layout.centreId) : undefined;

  const batteryValue =
    state.batteryFlow > 0.02 ? `▲ in ${state.batteryFlow.toFixed(1)} kWh/30 min` : state.batteryFlow < -0.02 ? `▼ out ${(-state.batteryFlow).toFixed(1)} kWh/30 min` : "holding";
  const gridValue =
    state.importKwh > 0.02 ? `▶ import ${state.importKwh.toFixed(1)} kWh/30 min` : state.exportKwh > 0.02 ? `◀ export ${state.exportKwh.toFixed(1)} kWh/30 min` : "standing by";

  return (
    <div className={"lg" + (interactive ? " lg-interactive" : "")}>
      <svg className="lg-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <defs>
          <linearGradient id="lg-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={light.skyTop} />
            <stop offset="1" stopColor={light.skyLow} />
          </linearGradient>
          <linearGradient id="lg-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e7ebde" />
            <stop offset="1" stopColor="#dde4d2" />
          </linearGradient>
        </defs>

        {/* Sky, distant hills, the ground and a few fields. */}
        <rect width={W} height={H} fill="url(#lg-ground)" />
        <rect width={W} height={SKY_H} fill="url(#lg-sky)" />
        <SunOrMoon t={light.sunT} night={light.night} />
        <path d="M0,84 C110,56 200,64 290,78 C390,94 450,54 550,60 C650,66 700,90 800,74 C880,62 940,66 1000,78 L1000,112 L0,112 Z" fill={mix("#cbd5c4", "#7d8a8f", light.night)} />
        <path d="M0,100 C140,82 260,98 360,94 C480,89 560,76 670,88 C770,98 870,86 1000,94 L1000,118 L0,118 Z" fill={mix("#d8dfcc", "#a3ad9f", light.night)} />
        <rect y={SKY_H + 6} width={W} height={H - SKY_H - 6} fill="url(#lg-ground)" />
        <polygon points={poly({ x: 300, y: 450 }, [[-70, -40, 0], [60, -40, 0], [60, 50, 0], [-70, 50, 0]])} fill="#e2e8d3" />
        <polygon points={poly({ x: 830, y: 250 }, [[-60, -50, 0], [70, -50, 0], [70, 40, 0], [-60, 40, 0]])} fill="#e3e9d5" />
        <polygon points={poly({ x: 690, y: 590 }, [[-60, -40, 0], [50, -40, 0], [50, 40, 0], [-60, 40, 0]])} fill="#e1e7d1" />

        {/* Your plot: the parcel you stand on, and a slow "you are here" beacon. */}
        {centreIsYou && (
          <g>
            <polygon points={poly(CENTRE, [[-46, -40, 0], [46, -40, 0], [46, 40, 0], [-46, 40, 0]])} fill="#3b9a65" fillOpacity={0.1} stroke="#24704a" strokeOpacity={0.55} strokeWidth={1.2} strokeDasharray="4 3" />
            {!reduceMotion && (
              <ellipse cx={CENTRE.x} cy={CENTRE.y} rx={60} ry={30} fill="none" stroke="#24704a" strokeWidth={1.2} className="lg-beacon" />
            )}
          </g>
        )}

        {/* Paths and wires. A wire carrying energy is tinted by what it carries. */}
        {edges.map((e) => (
          <path key={`road-${e.id}`} d={e.d} fill="none" stroke="#f2f3ec" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {edges.map((e) => {
          const [f, b] = flowsOn(e, state);
          const kwh = f + b;
          const active = kwh >= 0.02;
          return (
            <path
              key={`wire-${e.id}`}
              d={e.d}
              fill="none"
              stroke={active ? (e.kind === "grid" ? SKY : LEAF) : "#c4c0b1"}
              strokeOpacity={active ? 0.35 + 0.4 * Math.min(1, kwh / 4) : 0.75}
              strokeWidth={active ? 1.4 + Math.min(1.2, kwh / 8) : 1.1}
              strokeLinecap="round"
              style={{ transition: "stroke 1.2s ease, stroke-opacity 1.2s ease, stroke-width 1.2s ease" }}
            />
          );
        })}

        {/* Arrival pulses sit on the ground under each node. */}
        {anchors.map((a) => (
          <g key={`halo-${a.id}`} transform={`translate(${a.at.x},${a.at.y})`}>
            <ellipse ref={haloRef(a.id)} rx={a.rx} ry={a.rx / 2} fill={a.tone} fillOpacity={0.18} stroke={a.tone} strokeOpacity={0.6} strokeWidth={1} opacity={0} />
          </g>
        ))}

        {/* Focus ring for the participant being previewed. */}
        {focusPlace && (
          <ellipse cx={focusPlace.at.x} cy={focusPlace.at.y + 2} rx={focusPlace.farm ? 66 : 40} ry={focusPlace.farm ? 33 : 20} fill="none" stroke="#0f1513" strokeWidth={1.3} strokeDasharray="3 3" />
        )}

        {drawables.map((d) => d.el)}

        {/* Evening falls over the scene; windows stay lit above it. */}
        <rect width={W} height={H} fill="#24324a" opacity={0.17 * light.night} pointerEvents="none" style={{ transition: "opacity 2s linear" }} />
        {[...layout.placed].map(([id, p]) => {
          const n = nodeById.get(id)!;
          if (p.farm) return null;
          const lit = clamp01(0.08 + light.night * 0.8 + Math.min(1, n.consumption / 1.2) * 0.25);
          return <WindowLights key={`w-${id}`} at={p.at} lit={lit} scale={p.centre ? 1.22 : 1} />;
        })}

        <g ref={particleLayer} pointerEvents="none" />
        {reduceMotion && edges.map((e) => <StaticArrows key={`arrow-${e.id}`} edge={e} flows={flowsOn(e, state)} />)}

        {/* Market state of every other participant, at a glance. */}
        {[...layout.placed].map(([id, p]) => {
          if (p.centre) return null;
          const n = nodeById.get(id)!;
          const lift = p.farm ? (n.energyType === "wind" ? 96 : 30) : 50;
          return <StateMarker key={`s-${id}`} at={{ x: p.at.x + (p.farm ? 0 : 14), y: p.at.y - lift }} state={stateOf(n)} />;
        })}

        {/* Hit areas. */}
        {[...layout.placed].map(([id, p]) => (
          <ellipse
            key={`hit-${id}`}
            cx={p.at.x}
            cy={p.at.y - 16}
            rx={p.farm ? 64 : p.centre ? 46 : 38}
            ry={p.farm ? 42 : p.centre ? 38 : 32}
            fill="transparent"
            className="lg-hit"
            role={interactive ? "link" : undefined}
            aria-label={interactive ? `Open ${nodeById.get(id)?.name}` : undefined}
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(null)}
            onClick={open(`/households/${id}`)}
          />
        ))}
        {interactive && (
          <>
            <ellipse cx={HUB.x} cy={HUB.y - 10} rx={34} ry={24} fill="transparent" className="lg-hit" onClick={open("/auction")} aria-label="Open the auction" role="link" />
            <ellipse cx={BATTERY.x} cy={BATTERY.y - 18} rx={40} ry={32} fill="transparent" className="lg-hit" onClick={open("/battery")} aria-label="Open storage settings" role="link" />
          </>
        )}
      </svg>

      {/* Labels are HTML so they stay crisp at any size. */}
      {interactive && (
        <>
          <SceneTag at={HUB} lift={40} code="🏪 MARKET" value={labels === "names" ? undefined : state.price === null ? "no trade yet" : `${state.price.toFixed(3)} TEC/kWh`} />
          <SceneTag
            at={BATTERY}
            lift={58}
            code={labels === "names" ? "🔋 BATTERY" : `🔋 BATTERY ${Math.round(batteryLevel * 100)}%`}
            value={labels === "names" ? undefined : batteryValue}
            tone={state.batteryFlow > 0.02 ? "leaf" : undefined}
          />
          <SceneTag
            at={PYLON}
            lift={86}
            code="🔌 UTILITY"
            value={labels === "names" ? undefined : gridValue}
            tone={state.importKwh > 0.02 || state.exportKwh > 0.02 ? "sky" : undefined}
          />
        </>
      )}
      {centreIsYou && you && <YouTag node={you} lift={layout.placed.get(you.id)?.farm ? 64 : 60} showFlow={labels === "values"} />}
      {focusNode && focusPlace && !(focusPlace.centre && centreIsYou && !hovered) && (
        <Preview node={focusNode} at={focusPlace.at} lift={focusPlace.farm ? (focusNode.energyType === "wind" ? 112 : 46) : focusPlace.centre ? 64 : 56} interactive={interactive} you={focusPlace.centre && centreIsYou} />
      )}

      {layout.hidden > 0 && <div className="lg-more">+{layout.hidden} more participants, listed beside the map</div>}
    </div>
  );
}

function flowLine(n: SceneNode) {
  const s = stateOf(n);
  if (s === "supplying") return { cls: "supply", text: `▲ supplying ${n.flow.toFixed(2)} kWh/30 min` };
  if (s === "drawing") return { cls: "demand", text: `▼ drawing ${(-n.flow).toFixed(2)} kWh/30 min` };
  return { cls: "muted", text: "= self-sufficient" };
}

const pct = (at: Pt) => ({ left: Math.min(90, Math.max(10, (at.x / W) * 100)), top: (at.y / H) * 100 });

function SceneTag({ at, lift, code, value, tone }: { at: Pt; lift: number; code: string; value?: string; tone?: "leaf" | "sky" }) {
  const p = pct({ x: at.x, y: at.y - lift });
  return (
    <div className={"lg-tag" + (tone ? ` ${tone}` : "")} style={{ left: `${p.left}%`, top: `${p.top}%` }}>
      <b>{code}</b>
      {value && <span>{value}</span>}
    </div>
  );
}

function YouTag({ node, lift, showFlow }: { node: SceneNode; lift: number; showFlow: boolean }) {
  const p = pct({ x: CENTRE.x, y: CENTRE.y - lift });
  const f = flowLine(node);
  return (
    <div className="lg-you" style={{ left: `${p.left}%`, top: `${p.top}%` }}>
      <b>📍 Your home</b>
      {showFlow && <span className={f.cls}>{f.text}</span>}
    </div>
  );
}

function Preview({ node, at, lift, interactive, you }: { node: SceneNode; at: Pt; lift: number; interactive: boolean; you: boolean }) {
  const below = at.y - lift < 150;
  const p = pct({ x: at.x, y: below ? at.y + 14 : at.y - lift });
  const f = flowLine(node);
  return (
    <div className={"lg-preview" + (below ? " below" : "")} style={{ left: `${p.left}%`, top: `${p.top}%` }}>
      <div className="lg-preview-head">
        <RoleIcon type={node.type} energyType={node.energyType} size={18} />
        <span>
          <strong>
            {node.name}
            {you && <em> · you</em>}
          </strong>
          <small>
            {node.type} · {node.location}
          </small>
        </span>
      </div>
      <div className={"lg-preview-flow " + f.cls}>{f.text}</div>
      <div className="lg-preview-grid">
        <span>made</span>
        <b>{node.production.toFixed(2)}</b>
        <span>used</span>
        <b>{node.consumption.toFixed(2)}</b>
        <span>kWh/30 min</span>
        <b />
        {node.batteryLevel !== null && (
          <>
            <span>battery</span>
            <b>{Math.round(node.batteryLevel * 100)}%</b>
          </>
        )}
      </div>
      {interactive && <div className="lg-preview-open">Open profile →</div>}
    </div>
  );
}

function StateMarker({ at, state }: { at: Pt; state: MarketState }) {
  const fill = state === "supplying" ? LEAF : state === "drawing" ? AMBER : "#98a19c";
  return (
    <g transform={`translate(${at.x},${at.y})`} pointerEvents="none">
      <line x1={0} y1={7} x2={0} y2={13} stroke={fill} strokeWidth={1} opacity={0.7} />
      <rect x={-7} y={-7} width={14} height={14} rx={2} fill={fill} stroke="#ffffff" strokeWidth={1.4} />
      {state === "supplying" && <path d="M-3.4,1.8 L0,-2.2 L3.4,1.8" fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />}
      {state === "drawing" && <path d="M-3.4,-1.8 L0,2.2 L3.4,-1.8" fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />}
      {state === "balanced" && <path d="M-3.2,-1.4 H3.2 M-3.2,1.6 H3.2" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />}
    </g>
  );
}

function StaticArrows({ edge, flows }: { edge: Edge; flows: [number, number] }) {
  const out: JSX.Element[] = [];
  flows.forEach((kwh, i) => {
    if (kwh < 0.02) return;
    const s = edge.len * (i === 0 ? 0.45 : 0.55);
    const p = pointAt(edge, s);
    const q = pointAt(edge, s + (i === 0 ? 4 : -4));
    const a = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    out.push(
      <path
        key={i}
        d="M-4,-4 L3,0 L-4,4"
        fill="none"
        stroke={edge.kind === "grid" ? SKY : LEAF}
        strokeWidth={1.8}
        strokeLinecap="round"
        transform={`translate(${p.x},${p.y}) rotate(${a})`}
      />
    );
  });
  return <>{out}</>;
}

// ---------------------------------------------------------------- objects

function SunOrMoon({ t, night }: { t: number; night: number }) {
  if (t >= -0.04 && t <= 1.04) {
    const x = 80 + 840 * t;
    const y = 84 - 62 * Math.sin(Math.PI * clamp01(t));
    return (
      <g>
        <circle cx={x} cy={y} r={20} fill="#f6d58b" opacity={0.25} />
        <circle cx={x} cy={y} r={9} fill="#f2bf5e" />
      </g>
    );
  }
  return <circle cx={820} cy={36} r={8} fill="#e8ecf1" opacity={0.85 * night} />;
}

function Tree({ at, s }: { at: Pt; s: number }) {
  const r = 8.5 * s;
  return (
    <g>
      <ellipse cx={at.x + 4 * s} cy={at.y + 1} rx={r * 1.05} ry={r * 0.42} fill="#3e4a2e" opacity={0.1} />
      <line x1={at.x} y1={at.y} x2={at.x} y2={at.y - r * 0.9} stroke="#8a7a62" strokeWidth={1.6 * s} />
      <circle cx={at.x} cy={at.y - r * 1.5} r={r} fill="#86ad79" />
      <circle cx={at.x + r * 0.35} cy={at.y - r * 1.35} r={r * 0.7} fill="#7aa16e" />
      <circle cx={at.x - r * 0.3} cy={at.y - r * 1.85} r={r * 0.45} fill="#a1c493" />
    </g>
  );
}

const HW = 34; // house footprint along x
const HD = 26; // along y
const HH = 20; // wall height
const HR = 12; // roof rise

function House({ at, node, scale, muted }: { at: Pt; node: SceneNode; scale: number; muted: boolean }) {
  const w = HW / 2;
  const d = HD / 2;
  const solar = node.type === "prosumer";
  // Neighbours are drawn a touch quieter than your own home.
  const roof = solar ? (muted ? ["#77756f", "#8b8881"] : ["#5f5d58", "#77746d"]) : muted ? ["#b8846a", "#c79a80"] : ["#a9674a", "#bd7f61"];
  const wallL = muted ? "#f4efe5" : "#fbf6ec";
  const wallR = muted ? "#e2d9c8" : "#e6d8bf";
  const e = 2.5; // eaves overhang
  const slope = (x: number, t: number): [number, number, number] => [x, (d + e) * (1 - t), HH + HR * t];
  return (
    <g transform={scale !== 1 ? `translate(${at.x},${at.y}) scale(${scale}) translate(${-at.x},${-at.y})` : undefined}>
      <ellipse cx={at.x + 8} cy={at.y + 4} rx={34} ry={13} fill="#3e4a2e" opacity={0.09} />
      <polygon points={poly(at, [[-w - e, -d - e, HH], [w + e, -d - e, HH], [w + e, 0, HH + HR], [-w - e, 0, HH + HR]])} fill={roof[1]} />
      <polygon points={poly(at, [[-w, d, 0], [w, d, 0], [w, d, HH], [-w, d, HH]])} fill={wallL} />
      <polygon points={poly(at, [[w, -d, 0], [w, d, 0], [w, d, HH], [w, -d, HH]])} fill={wallR} />
      <polygon points={poly(at, [[w, -d, HH], [w, d, HH], [w, 0, HH + HR]])} fill={wallR} />
      <polygon points={poly(at, [[-w - e, d + e, HH], [w + e, d + e, HH], [w + e, 0, HH + HR], [-w - e, 0, HH + HR]])} fill={roof[0]} />
      {solar && (
        <g>
          <polygon points={poly(at, [slope(-w + 2, 0.14), slope(w - 2, 0.14), slope(w - 2, 0.86), slope(-w + 2, 0.86)])} fill="#2f4a62" />
          {[-w / 3, w / 3].map((x) => (
            <line key={x} x1={iso(at, ...slope(x, 0.14))[0]} y1={iso(at, ...slope(x, 0.14))[1]} x2={iso(at, ...slope(x, 0.86))[0]} y2={iso(at, ...slope(x, 0.86))[1]} stroke="#7f9bb3" strokeWidth={0.6} />
          ))}
          <polyline points={poly(at, [slope(-w + 2, 0.5), slope(w - 2, 0.5)])} stroke="#7f9bb3" strokeWidth={0.6} fill="none" />
          <polygon points={poly(at, [slope(-w + 2, 0.62), slope(-w + 10, 0.62), slope(-w + 6, 0.86), slope(-w + 2, 0.86)])} fill="#ffffff" opacity={0.12} />
        </g>
      )}
      <polygon points={poly(at, [[w - 12, d, 0], [w - 6, d, 0], [w - 6, d, 12], [w - 12, d, 12]])} fill="#7b6a56" />
      {WINDOWS.map((q, i) => (
        <polygon key={i} points={poly(at, q)} fill="#a9b8bc" />
      ))}
      {node.batteryLevel !== null && <HomeBattery at={at} level={node.batteryLevel} />}
    </g>
  );
}

const WINDOWS: Array<Array<[number, number, number]>> = [
  [[-HW / 2 + 4, HD / 2, 8], [-HW / 2 + 10, HD / 2, 8], [-HW / 2 + 10, HD / 2, 15], [-HW / 2 + 4, HD / 2, 15]],
  [[-HW / 2 + 14, HD / 2, 8], [-HW / 2 + 20, HD / 2, 8], [-HW / 2 + 20, HD / 2, 15], [-HW / 2 + 14, HD / 2, 15]],
  [[HW / 2, -6, 8], [HW / 2, 1, 8], [HW / 2, 1, 15], [HW / 2, -6, 15]],
];

function WindowLights({ at, lit, scale }: { at: Pt; lit: number; scale: number }) {
  return (
    <g
      pointerEvents="none"
      style={{ transition: "opacity 1.5s ease" }}
      opacity={lit}
      transform={scale !== 1 ? `translate(${at.x},${at.y}) scale(${scale}) translate(${-at.x},${-at.y})` : undefined}
    >
      {WINDOWS.map((q, i) => (
        <polygon key={i} points={poly(at, q)} fill="#ffd27f" />
      ))}
    </g>
  );
}

/** A small battery cabinet beside the house; its green level is the home battery's charge. */
function HomeBattery({ at, level }: { at: Pt; level: number }) {
  const x0 = HW / 2 + 4;
  const x1 = x0 + 6;
  const y0 = HD / 2 - 9;
  const y1 = HD / 2 - 2;
  const h = 13;
  const fill = 1.5 + (h - 3) * clamp01(level);
  return (
    <g>
      <polygon points={poly(at, [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]])} fill="#f4f0e7" />
      <polygon points={poly(at, [[x0, y1, 0], [x1, y1, 0], [x1, y1, h], [x0, y1, h]])} fill="#ebe5d9" />
      <polygon points={poly(at, [[x1, y0, 0], [x1, y1, 0], [x1, y1, h], [x1, y0, h]])} fill="#d6cdbb" />
      <polygon points={poly(at, [[x0 + 1.5, y1, 1.5], [x1 - 1.5, y1, 1.5], [x1 - 1.5, y1, fill], [x0 + 1.5, y1, fill]])} fill={LEAF} style={{ transition: "all 1.2s ease" }} />
    </g>
  );
}

function SolarFarm({ at }: { at: Pt }) {
  const panels: JSX.Element[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const x = -34 + c * 17;
      const y = -20 + r * 14;
      panels.push(
        <g key={`${r}-${c}`}>
          <polygon points={poly(at, [[x, y + 6, 2], [x + 14, y + 6, 2], [x + 14, y, 9], [x, y, 9]])} fill="#2f4a62" />
          <polyline points={poly(at, [[x + 7, y + 6, 2], [x + 7, y, 9]])} stroke="#7f9bb3" strokeWidth={0.6} fill="none" />
          <polyline points={poly(at, [[x, y + 3, 5.5], [x + 14, y + 3, 5.5]])} stroke="#7f9bb3" strokeWidth={0.5} fill="none" />
        </g>
      );
    }
  }
  return (
    <g>
      <polygon points={poly(at, [[-40, -26, 0], [38, -26, 0], [38, 26, 0], [-40, 26, 0]])} fill="#d6ddc5" />
      {panels}
      <polygon points={poly(at, [[30, 14, 0], [38, 14, 0], [38, 20, 0], [38, 20, 9], [30, 20, 9]])} fill="#e9e4d8" />
    </g>
  );
}

function WindFarm({ at, rotorRef }: { at: Pt; rotorRef: (i: number, el: SVGGElement | null) => void }) {
  const towers: Array<[number, number, number]> = [
    [-26, -14, 0.85],
    [10, -20, 0.95],
    [-4, 16, 1.1],
  ];
  return (
    <g>
      {towers.map(([x, y, s], i) => {
        const [bx, by] = iso(at, x, y, 0);
        const top = by - 66 * s;
        return (
          <g key={i}>
            <ellipse cx={bx + 6} cy={by + 2} rx={10 * s} ry={4 * s} fill="#3e4a2e" opacity={0.1} />
            <polygon points={`${bx - 2.2 * s},${by} ${bx + 2.2 * s},${by} ${bx + 1 * s},${top} ${bx - 1 * s},${top}`} fill="#f2f0ea" stroke="#cfc9bb" strokeWidth={0.6} />
            <g transform={`translate(${bx},${top})`}>
              <g ref={(el) => rotorRef(i, el)}>
                {[0, 120, 240].map((a) => (
                  <path key={a} d={`M0,0 L${-2 * s},${-4 * s} L0,${-27 * s} L${2 * s},${-4 * s} Z`} fill="#f7f5ef" stroke="#c6bfb0" strokeWidth={0.6} transform={`rotate(${a})`} />
                ))}
              </g>
              <circle r={2.4 * s} fill="#e4dfd3" stroke="#bdb6a6" strokeWidth={0.6} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

function Substation({ at }: { at: Pt }) {
  return (
    <g>
      <ellipse cx={at.x + 6} cy={at.y + 4} rx={30} ry={11} fill="#3e4a2e" opacity={0.09} />
      <polygon points={poly(at, [[-18, -18, 0], [18, -18, 0], [18, 18, 0], [-18, 18, 0]])} fill="#e3e0d4" />
      <polygon points={poly(at, [[-18, 18, 0], [18, 18, 0], [18, 18, 3], [-18, 18, 3]])} fill="#d3cfc1" />
      <polygon points={poly(at, [[18, -18, 0], [18, 18, 0], [18, 18, 3], [18, -18, 3]])} fill="#c4bfb0" />
      <polygon points={poly(at, [[-18, -18, 3], [18, -18, 3], [18, 18, 3], [-18, 18, 3]])} fill="#ebe8de" />
      <polygon points={poly(at, [[-8, -6, 17], [8, -6, 17], [8, 6, 17], [-8, 6, 17]])} fill="#c9d0c8" />
      <polygon points={poly(at, [[-8, 6, 3], [8, 6, 3], [8, 6, 17], [-8, 6, 17]])} fill="#b6beb5" />
      <polygon points={poly(at, [[8, -6, 3], [8, 6, 3], [8, 6, 17], [8, -6, 17]])} fill="#a2aaa1" />
      {[-4, 0, 4].map((x) => {
        const [x1, y1] = iso(at, x, 0, 17);
        return (
          <g key={x}>
            <line x1={x1} y1={y1} x2={x1} y2={y1 - 7} stroke="#8d9189" strokeWidth={1.4} />
            <circle cx={x1} cy={y1 - 7.5} r={1.4} fill="#c9a96b" />
          </g>
        );
      })}
    </g>
  );
}

function CommunityBattery({ at, level }: { at: Pt; level: number }) {
  const w = 20;
  const d = 10;
  const h = 30;
  const segments = 6;
  return (
    <g>
      <ellipse cx={at.x + 8} cy={at.y + 5} rx={40} ry={14} fill="#3e4a2e" opacity={0.1} />
      <polygon points={poly(at, [[-w - 3, -d - 3, 0], [w + 3, -d - 3, 0], [w + 3, d + 3, 0], [-w - 3, d + 3, 0]])} fill="#dcd8cb" />
      <polygon points={poly(at, [[-w, d, 0], [w, d, 0], [w, d, h], [-w, d, h]])} fill="#3f4c46" />
      <polygon points={poly(at, [[w, -d, 0], [w, d, 0], [w, d, h], [w, -d, h]])} fill="#323d38" />
      <polygon points={poly(at, [[-w, -d, h], [w, -d, h], [w, d, h], [-w, d, h]])} fill="#5a6862" />
      {Array.from({ length: segments }, (_, i) => {
        const z0 = 4 + i * 4.2;
        const fill = clamp01(level * segments - i);
        return (
          <g key={i}>
            <polygon points={poly(at, [[-w + 5, d, z0], [w - 5, d, z0], [w - 5, d, z0 + 3], [-w + 5, d, z0 + 3]])} fill="#56645d" />
            <polygon
              points={poly(at, [[-w + 5, d, z0], [w - 5, d, z0], [w - 5, d, z0 + 3], [-w + 5, d, z0 + 3]])}
              fill="#79d29b"
              fillOpacity={fill}
              style={{ transition: "fill-opacity 1.2s ease" }}
            />
          </g>
        );
      })}
    </g>
  );
}

function Pylon({ at }: { at: Pt }) {
  const legs: Array<[number, number]> = [
    [-7, -7],
    [7, -7],
    [7, 7],
    [-7, 7],
  ];
  const top = 72;
  const at3 = (x: number, y: number, z: number) => iso(at, x, y, z);
  const lines: Array<[[number, number], [number, number]]> = [];
  for (const [x, y] of legs) lines.push([at3(x, y, 0), at3(x * 0.2, y * 0.2, top)]);
  for (const z of [16, 34, 52]) {
    const k = 1 - (z / top) * 0.8;
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = legs[i];
      const [x2, y2] = legs[(i + 1) % 4];
      lines.push([at3(x1 * k, y1 * k, z), at3(x2 * k, y2 * k, z)]);
    }
  }
  const arms: Array<[number, number]> = [
    [56, 20],
    [66, 14],
  ];
  for (const [z, span] of arms) lines.push([at3(0, -span, z), at3(0, span, z)]);
  // The line heads off to the wider grid, beyond the edge of the map.
  const [ax, ay] = at3(0, -20, 56);
  const [bx, by] = at3(0, 20, 56);
  return (
    <g>
      <ellipse cx={at.x + 10} cy={at.y + 3} rx={22} ry={7} fill="#3e4a2e" opacity={0.1} />
      <path d={`M${ax},${ay} Q${ax - 60},${ay + 40} -10,${ay + 20}`} fill="none" stroke="#9d978a" strokeWidth={0.8} />
      <path d={`M${bx},${by} Q${bx - 80},${by + 60} -10,${by + 70}`} fill="none" stroke="#9d978a" strokeWidth={0.8} />
      {lines.map(([[x1, y1], [x2, y2]], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#8e887b" strokeWidth={1} />
      ))}
      {arms.flatMap(([z, span]) =>
        [-span, span].map((y) => {
          const [x, yy] = at3(0, y, z);
          return <circle key={`${z}${y}`} cx={x} cy={yy + 2} r={1.5} fill="#b6ad98" />;
        })
      )}
    </g>
  );
}

// ---------------------------------------------------------------- data

/** Live microgrid data shaped for the map. Energy into a home battery stays at home, so it is netted out of the wire. */
export function useLiveScene(): SceneState | null {
  const { data: nodes } = usePolling(() => api.get<MicrogridNode[]>("/microgrid"), 2500);
  const { data: grid } = usePolling(() => api.get<SharedBatteryStatus>("/grid/status"), 2500);
  const { data: status } = usePolling(() => api.get<MarketStatus>("/market/status"), 2500);
  const { data: auction } = usePolling(() => api.get<AuctionResult | null>("/market/auctions/latest"), 2500);

  // Battery levels change once per interval; keep the change between snapshots.
  const memory = useRef<{ key: string; homes: Map<string, number>; shared: number; dHomes: Map<string, number>; dShared: number } | null>(null);
  if (nodes && grid) {
    const shared = grid.rented.usedKwh + grid.gridPool.chargeKwh;
    const key = nodes.map((n) => `${n.production}:${n.consumption}:${n.batteryChargeKwh}`).join("|") + `|${shared}`;
    const prev = memory.current;
    if (!prev || prev.key !== key) {
      memory.current = {
        key,
        homes: new Map(nodes.map((n) => [n.id, n.batteryChargeKwh])),
        shared,
        dHomes: prev ? new Map(nodes.map((n) => [n.id, n.batteryChargeKwh - (prev.homes.get(n.id) ?? n.batteryChargeKwh)])) : new Map(),
        dShared: prev ? shared - prev.shared : 0,
      };
    }
  }

  if (!nodes || !grid || !status) return null;
  const mem = memory.current;
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      energyType: n.energyType,
      location: n.location,
      production: n.production,
      consumption: n.consumption,
      flow: n.netFlow - (mem?.dHomes.get(n.id) ?? 0),
      batteryLevel: n.batteryCapacityKwh > 0 ? n.batteryChargeKwh / n.batteryCapacityKwh : null,
    })),
    batteryKwh: grid.rented.usedKwh + grid.gridPool.chargeKwh,
    batteryCapacityKwh: grid.capacityKwh,
    batteryFlow: mem?.dShared ?? 0,
    importKwh: auction?.importedKwh ?? 0,
    exportKwh: auction?.exportedKwh ?? 0,
    price: status.lastPrice,
    minuteOfDay: status.simTime % 1440,
    paused: status.paused,
  };
}

/** The live map, fed by the market. */
export function LiveGrid(props: { youId?: string; highlightId?: string | null; onHover?: (id: string | null) => void }) {
  const state = useLiveScene();
  if (!state) return <div className="lg lg-loading" />;
  return <GridScene state={state} {...props} />;
}

/** How to read the map, shown under it. */
export function SceneLegend() {
  return (
    <div className="scene-legend">
      <span>
        <span className="particle-key leaf" />
        local energy
      </span>
      <span>
        <span className="particle-key sky" />
        utility grid
      </span>
      <span className="state-key">
        <i className="sk sk-up" />
        supplying
      </span>
      <span className="state-key">
        <i className="sk sk-down" />
        drawing
      </span>
      <span className="state-key">
        <i className="sk sk-eq" />
        self-sufficient
      </span>
    </div>
  );
}

