import type { SceneNode } from "./LivingGrid";
import { RoleIcon } from "./concepts";

/** A list of participants beside the map; hovering one highlights it on the map, selecting it opens its profile. */
export function NeighbourGroup({
  title,
  tone,
  nodes,
  focus,
  onFocus,
  onOpen,
  signed = false,
}: {
  title: string;
  tone: "up" | "down" | "eq";
  nodes: SceneNode[];
  focus: string | null;
  onFocus: (id: string | null) => void;
  onOpen: (id: string) => void;
  /** Rows grouped by role rather than by state: show each row's own sign and colour. */
  signed?: boolean;
}) {
  if (nodes.length === 0) return null;
  const sorted = nodes.slice().sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow));
  return (
    <div className="nb-group">
      <div className="nb-title">
        {!signed && <i className={`sk sk-${tone}`} />}
        {title}
        <span>{nodes.length} · kWh/30 min</span>
      </div>
      {sorted.map((n) => (
        <button
          key={n.id}
          className={"nb-row" + (focus === n.id ? " focused" : "")}
          onMouseEnter={() => onFocus(n.id)}
          onMouseLeave={() => onFocus(null)}
          onFocus={() => onFocus(n.id)}
          onBlur={() => onFocus(null)}
          onClick={() => onOpen(n.id)}
        >
          <RoleIcon type={n.type} energyType={n.energyType} size={16} />
          <span className="nb-name">
            {n.name}
            <small>{n.type}</small>
          </span>
          {signed ? (
            <span className={"nb-value " + (n.flow > 0.01 ? "supply" : n.flow < -0.01 ? "demand" : "muted")}>
              {n.flow > 0.01 ? "▲" : n.flow < -0.01 ? "▼" : "="} {Math.abs(n.flow).toFixed(2)}
            </span>
          ) : (
            <span className={"nb-value " + (tone === "up" ? "supply" : tone === "down" ? "demand" : "muted")}>{Math.abs(n.flow).toFixed(2)}</span>
          )}
        </button>
      ))}
    </div>
  );
}
