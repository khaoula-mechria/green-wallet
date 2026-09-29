/** Horizontal fill bar for batteries and storage compartments. */
export function Gauge({
  value,
  max,
  label,
  color = "var(--color-primary)",
  compact,
}: {
  value: number;
  max: number;
  label?: string;
  color?: string;
  compact?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={"gauge" + (compact ? " gauge-compact" : "")}>
      {label !== undefined && (
        <div className="gauge-label">
          <span>{label}</span>
          <span>
            {value.toFixed(2)} / {max.toFixed(0)} kWh
          </span>
        </div>
      )}
      <div className="gauge-track">
        <div className="gauge-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
