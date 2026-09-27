import { useEffect, useRef, useState, useCallback } from "react";

/** Fetches `fn` immediately and then every `intervalMs`, keeping the data fresh
 * so dashboards/marketplace reflect the live simulation without a manual refresh. */
export function usePolling<T>(fn: () => Promise<T>, intervalMs = 4000, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    try {
      const result = await fnRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
    const id = setInterval(() => void reload(), intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload };
}
