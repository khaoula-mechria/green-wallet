import { Link } from "react-router-dom";

/**
 * The Green Wallet mark: two busbar slabs joined by one diagonal — a current
 * stepping between two ledger lines. Three separate pieces, so it also reads
 * as blocks in a chain. Works in one colour; the diagonal carries the green.
 */
export function Mark({ size = 28, mono = false, tile = true }: { size?: number; mono?: boolean; tile?: boolean }) {
  const ink = tile ? "#ffffff" : "currentColor";
  const current = mono ? ink : "#3fcf86";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="mark">
      {tile && <rect width="32" height="32" rx="6" fill="#0f1513" />}
      <rect x="13" y="6" width="14" height="5" fill={ink} />
      <polygon points="20.5,13 26.5,13 11.5,19 5.5,19" fill={current} />
      <rect x="5" y="21" width="14" height="5" fill={ink} />
    </svg>
  );
}

export function Brand({ to = "/", dark = false }: { to?: string; dark?: boolean }) {
  return (
    <Link className={"brand" + (dark ? " brand-dark" : "")} to={to}>
      <Mark size={30} />
      <span className="brand-text">
        <strong>Green Wallet</strong>
        <small>microgrid · ledger</small>
      </span>
    </Link>
  );
}
