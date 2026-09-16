import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TripDayTimeline } from "./TripDayTimeline";
import type { DayPlan } from "./types";

const apiBase = import.meta.env.VITE_API_URL ?? "/api";

/**
 * Fetch the timed day plan from the server endpoint. Returns null on any
 * failure — the card then renders its honest no-data state instead of
 * crashing, the same contract as TidePanel's dayScore fetch.
 */
async function fetchDayPlan(slug: string): Promise<DayPlan | null> {
  try {
    const response = await fetch(
      `${apiBase}/beaches/${encodeURIComponent(slug)}/day-plan`,
      {
        headers: {
          "content-type": "application/json",
          "x-sunscout-user-id": "00000000-0000-7000-8000-000000000001",
        },
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: DayPlan | null };
    return body.data ?? null;
  } catch {
    return null;
  }
}

/**
 * TripDayTimelineCard — the expandable "Your beach day" section of the
 * Beach Day Guide. The server's GET /api/beaches/:slug/day-plan endpoint is
 * the source of truth on the wire; this card only fetches and renders it.
 * The deterministic buildDayPlan mirror in ./timeline is the tested client
 * engine used for the plan contract, not a second runtime composer — the
 * client must never re-derive what the server already sequenced.
 *
 * The initial* props exist so the loading/plan/error render paths are
 * testable without a DOM fetch (renderToStaticMarkup runs no effects).
 * Loading, empty, error and success states are all explicit.
 */
export function TripDayTimelineCard({
  slug,
  initialPlan = null,
  initialError = false,
  initialExpanded = false,
}: {
  /** Beach slug — without it the card renders nothing (call sites keep working). */
  slug?: string;
  initialPlan?: DayPlan | null;
  initialError?: boolean;
  /** Test hook: the card is collapsed by default in production. */
  initialExpanded?: boolean;
}) {
  const [plan, setPlan] = useState<DayPlan | null>(initialPlan);
  const [error, setError] = useState(initialError);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(initialExpanded);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoaded(false);
    setError(false);
    fetchDayPlan(slug).then((result) => {
      if (cancelled) return;
      setPlan(result);
      setError(result == null);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!slug) return null;

  const summary = error
    ? "Unavailable"
    : !loaded && !plan
      ? "Loading…"
      : plan == null
        ? "Unavailable"
        : plan.items.length
          ? `${plan.items.length} stop${plan.items.length === 1 ? "" : "s"} planned`
          : "No stops today";

  return (
    <section
      className="detail-section tripday-section"
      aria-label="Beach day timeline"
    >
      <button
        className="section-heading tide-heading"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="heading-group">
          {expanded ? <ChevronDown /> : <ChevronRight />}
          <strong>Your beach day</strong>
        </span>
        <span className="sandcastle">{summary}</span>
      </button>
      {expanded ? (
        error ? (
          <p className="chart-note" role="status">
            Beach day plan unavailable right now.
          </p>
        ) : !plan ? (
          <p className="chart-note" role="status">
            Loading your beach day…
          </p>
        ) : (
          <TripDayTimeline plan={plan} />
        )
      ) : null}
    </section>
  );
}

export default TripDayTimelineCard;
