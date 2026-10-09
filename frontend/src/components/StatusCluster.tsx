import { api, API_MODE } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { fmtClock } from "../format";
import type { MarketStatus } from "../types";
import { IconMoon, IconSun } from "./icons";

/** Simulated time and the market's heartbeat, top right of every page. */
export function StatusCluster() {
  const { data: status } = usePolling(() => api.get<MarketStatus>("/market/status"), 1000);
  if (!status) return <div className="status-cluster" />;

  const minute = status.simTime % 1440;
  const day = Math.floor(status.simTime / 1440) + 1;
  const daytime = minute >= 360 && minute < 1080;
  const seconds = Math.ceil(status.nextSettlementInMs / 1000);

  return (
    <div className="status-cluster">
      <div className="sim-clock">
        <span className={"sim-clock-icon" + (daytime ? " day" : " night")}>{daytime ? <IconSun size={26} /> : <IconMoon size={24} />}</span>
        <span>
          <span className="sim-clock-day">Day {day}</span>
          <span className="sim-clock-time">{fmtClock(status.simTime)}</span>
          <span className="sim-clock-note">simulated time</span>
        </span>
      </div>
      <div className={"market-pill" + (status.paused ? " paused" : "")}>
        <span className="market-dot" />
        <span>
          <strong>{status.paused ? "Market paused" : "Market live"}</strong>
          <small>{status.paused ? "settlement on hold" : `next settlement in ${seconds}s`}</small>
        </span>
      </div>
      {API_MODE === "mock" && <span className="mock-flag">Demo data, simulated in your browser</span>}
    </div>
  );
}
