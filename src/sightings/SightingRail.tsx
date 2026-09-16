import { useState, type CSSProperties } from "react";
import { assembleShareCard } from "../share/card";
import { ShareSheet } from "../share/ShareSheet";
import type {
  ShareBeachIdentity,
  ShareConditionSnapshot,
} from "../share/types";
import {
  formatSightingAge,
  formatSightingAudience,
  formatSightingTimeOfDay,
  freshnessWeight,
  selectRailSightings,
  type Sighting,
} from "./types";

export type SightingRailProps = {
  /** Raw sightings for the beach — the rail filters them itself. */
  sightings: Sighting[];
  status: "loading" | "ready" | "error";
  /** Render clock, injected so rendering stays deterministic. */
  now: Date;
  error?: string | null;
  /** Maximum number of sightings shown. */
  limit?: number;
  beachId?: string;
  /**
   * Beach identity backing the PRD 5.5 share handoff. When provided, the
   * rail renders a share action per sighting plus a beach-level action,
   * and the opened ShareSheet carries this identity in its deep link.
   * Omit to hide all share affordances.
   */
  beach?: ShareBeachIdentity;
  /** Live conditions for the share card; null/omitted degrades the card. */
  conditions?: ShareConditionSnapshot | null;
  onCapture?: () => void;
  onRetry?: () => void;
};

const sectionStyle: CSSProperties = {
  background: "#FAF6F0",
  borderRadius: 16,
  padding: 16,
  color: "#0F1E2E",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  margin: 0,
};

const countStyle: CSSProperties = {
  fontSize: 12,
  color: "#5A6B7A",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  display: "flex",
  gap: 12,
  overflowX: "auto",
  margin: "12px 0 0",
  padding: 0,
};

const itemStyle: CSSProperties = {
  flex: "0 0 auto",
  width: 200,
  background: "#FFFFFF",
  borderRadius: 12,
  border: "1px solid rgba(15,30,46,0.08)",
  overflow: "hidden",
};

const itemMediaStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: 120,
  objectFit: "cover",
};

const videoBadgeStyle: CSSProperties = {
  ...itemMediaStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#0F1E2E",
  color: "#FAF6F0",
  fontSize: 13,
  fontWeight: 600,
};

const linkCardStyle: CSSProperties = {
  ...itemMediaStyle,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "center",
  gap: 6,
  padding: 12,
  boxSizing: "border-box",
  background: "rgba(10,110,120,0.08)",
};

const itemBodyStyle: CSSProperties = {
  padding: 10,
  fontSize: 12,
};

const ageStyle: CSSProperties = {
  fontWeight: 600,
  color: "#0A6E78",
};

const freshnessStyle: CSSProperties = {
  marginLeft: 8,
  color: "#2E8B6B",
};

const stateStyle: CSSProperties = {
  margin: "12px 0 0",
  padding: "14px 12px",
  borderRadius: 12,
  background: "rgba(15,30,46,0.04)",
  fontSize: 13,
  textAlign: "center",
};

const stateButtonStyle: CSSProperties = {
  marginTop: 8,
  padding: "8px 14px",
  borderRadius: 999,
  border: "none",
  background: "#FF6B5C",
  color: "#FFFFFF",
  fontWeight: 600,
  cursor: "pointer",
};

const noteStyle: CSSProperties = {
  margin: "10px 0 0",
  fontSize: 11,
  color: "#5A6B7A",
};

const shareActionStyle: CSSProperties = {
  marginTop: 8,
  padding: "5px 10px",
  borderRadius: 999,
  border: "1px solid rgba(10,110,120,0.35)",
  background: "rgba(10,110,120,0.08)",
  color: "#0A6E78",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

const headerActionStyle: CSSProperties = {
  ...shareActionStyle,
  marginTop: 0,
  flex: "0 0 auto",
};

export function SightingRail({
  sightings,
  status,
  now,
  error = null,
  limit = 6,
  beachId,
  beach,
  conditions = null,
  onCapture,
  onRetry,
}: SightingRailProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const rail = selectRailSightings(sightings, { now, limit, beachId });
  // PRD 5.5 handoff: the share card carries live beach conditions, so every
  // sighting and the beach itself share one payload built from the same
  // injected `now` the rail renders with — no hidden clock.
  const sharePayload =
    beach != null ? assembleShareCard({ beach, conditions }, now) : null;
  const openShare = () => setShareOpen(true);

  return (
    <section
      className="sighting-rail"
      style={sectionStyle}
      aria-label="Recent sightings"
    >
      <header className="sighting-rail-header" style={headerStyle}>
        <h3>Sightings</h3>
        <span className="sighting-rail-count" style={countStyle}>
          {status === "ready" ? `${rail.length} live` : "…"}
        </span>
        {beach != null ? (
          <button
            type="button"
            className="sighting-rail-share"
            style={headerActionStyle}
            aria-label={`Share ${beach.name} conditions`}
            onClick={openShare}
          >
            Share beach
          </button>
        ) : null}
      </header>

      {status === "loading" ? (
        <div className="sighting-rail-state" style={stateStyle} role="status">
          Loading recent sightings…
        </div>
      ) : status === "error" ? (
        <div className="sighting-rail-state" style={stateStyle} role="alert">
          <p style={{ margin: 0 }}>{error ?? "Could not load sightings."}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} style={stateButtonStyle}>
              Try again
            </button>
          ) : null}
        </div>
      ) : rail.length === 0 ? (
        <div className="sighting-rail-state" style={stateStyle}>
          <p style={{ margin: 0 }}>
            No sightings here yet — be the first to show what this beach looks
            like right now.
          </p>
          {onCapture ? (
            <button type="button" onClick={onCapture} style={stateButtonStyle}>
              Post the first sighting
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="sighting-rail-list" style={listStyle}>
          {rail.map((sighting) => (
            <li
              key={sighting.id}
              className="sighting-item"
              style={itemStyle}
              data-form={sighting.media.form}
            >
              {sighting.media.form === "native" ? (
                sighting.media.mimeType.startsWith("image/") ? (
                  <img
                    className="sighting-item-media"
                    style={itemMediaStyle}
                    src={sighting.media.url}
                    alt={sighting.caption ?? "Beach sighting"}
                    loading="lazy"
                  />
                ) : (
                  <div className="sighting-item-video" style={videoBadgeStyle}>
                    Video · {sighting.media.mimeType}
                  </div>
                )
              ) : (
                <div className="sighting-item-link" style={linkCardStyle}>
                  <a
                    href={sighting.media.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#0A6E78", fontWeight: 600 }}
                  >
                    View on{" "}
                    {sighting.media.platform === "tiktok"
                      ? "TikTok"
                      : "Instagram"}{" "}
                    ↗
                  </a>
                  <span style={{ color: "#5A6B7A" }}>
                    Credit: {sighting.media.attribution}
                  </span>
                </div>
              )}
              <div className="sighting-item-body" style={itemBodyStyle}>
                <span className="sighting-age" style={ageStyle}>
                  {formatSightingAge(sighting.capturedAt, now)}
                </span>
                <span
                  className="sighting-freshness"
                  style={freshnessStyle}
                  aria-label="Freshness weight"
                >
                  {Math.round(freshnessWeight(sighting, now) * 100)}% fresh
                </span>
                <br />
                <span className="sighting-tags">
                  {formatSightingAudience(sighting.audience)}
                  {sighting.timeOfDay
                    ? ` · ${formatSightingTimeOfDay(sighting.timeOfDay)}`
                    : ""}
                </span>
                {sighting.caption ? (
                  <p className="sighting-caption" style={{ margin: "6px 0 0" }}>
                    {sighting.caption}
                  </p>
                ) : null}
                {beach != null ? (
                  <button
                    type="button"
                    className="sighting-item-share"
                    style={shareActionStyle}
                    aria-label={`Share ${beach.name} conditions from this sighting`}
                    onClick={openShare}
                  >
                    Share
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="sighting-rail-note" style={noteStyle}>
        Photos &amp; videos vanish after 7 days. Links stay as credits — never
        re-hosted.
      </footer>

      {/* Beach-scoped by design: every share entry point (per-sighting and
          beach-level) hands the audience to the same live beach card —
          the deep link points at the beach, not the ephemeral sighting. */}
      {sharePayload != null ? (
        <ShareSheet
          open={shareOpen}
          payload={sharePayload}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </section>
  );
}
