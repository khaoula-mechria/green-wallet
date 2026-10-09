/**
 * Ledger primitives. Identifiers are printed exactly, in mono, with their
 * structure made visible: a transaction ID is payer@seconds.nanos, an account
 * is shard.realm.num, a hash is read in groups of four.
 */

/** Hedera-style transaction ID: 0.0.1000@1791495530.000000123 */
export function TxId({ id, compact = false }: { id: string; compact?: boolean }) {
  const at = id.indexOf("@");
  if (at < 0) return <span className="txid">{id}</span>;
  const payer = id.slice(0, at);
  const [secs, nanos = ""] = id.slice(at + 1).split(".");
  return (
    <span className="txid" title={id}>
      <span className="txid-payer">{payer}</span>
      <span className="txid-sep">@</span>
      <span>{compact ? secs.slice(-6) : secs}</span>
      {!compact && nanos && <span className="txid-nanos">.{nanos}</span>}
    </span>
  );
}

/** Hedera-style account: 0.0.4804 */
export function AccountId({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="acct acct-none">—</span>;
  return <span className="acct">{id}</span>;
}

/** A hash shown in groups of four, optionally cut to a number of groups. */
export function Hash({ value, groups }: { value: string; groups?: number }) {
  const parts = value.match(/.{1,4}/g) ?? [value];
  const shown = groups ? parts.slice(0, groups) : parts;
  return (
    <span className="hash" title={value}>
      {shown.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
      {groups && parts.length > groups && <span className="hash-more">…</span>}
    </span>
  );
}

/** A network fee in HBAR, always paid by the operator account. */
export function Fee({ hbar }: { hbar: number }) {
  return <span className="fee">{hbar.toFixed(4)} ℏ</span>;
}
