import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchPersonalAlerts } from "./api";
import {
  filterAlerts,
  type AlertRulePriority,
  type PersonalAlert,
} from "./types";

/**
 * Triggered-alert banner for personal condition rules. Self-sufficient and
 * user-scoped: fetches the user's personal-rule notifications itself (the
 * existing /api/me/notifications feed, filtered to the personal-rule
 * kind), so mounting it needs no props and no changes upstream.
 *
 * Shows only alerts at or above `minPriority` (default "normal"). Loading,
 * error and empty states are deliberately silent — the banner must never
 * block or clutter the Today card it sits on. Render is inert until data
 * arrives (no window/localStorage access), which also keeps the existing
 * DayScoreCard static-markup tests deterministic.
 */
export function AlertBanner({
  minPriority = "normal",
}: {
  /** Minimum priority an alert needs to be shown. */
  minPriority?: AlertRulePriority;
}) {
  const [alerts, setAlerts] = useState<PersonalAlert[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPersonalAlerts()
      .then((loaded) => {
        if (!cancelled) setAlerts(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || !alerts) return null; // loading / fetch error stay silent
  const visible = filterAlerts(alerts, minPriority);
  if (!visible.length) return null;

  return (
    <>
      {visible.map((alert) => (
        <div
          key={alert.id}
          className={`alert-banner ${alert.priority === "high" ? "warning" : ""}`}
          role="status"
          aria-label="Personal beach alert"
        >
          <BellRing />
          <span>
            <strong>{alert.title}</strong>
            {alert.body ? <small>{alert.body}</small> : null}
          </span>
        </div>
      ))}
    </>
  );
}
