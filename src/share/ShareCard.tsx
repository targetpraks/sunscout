import type { CSSProperties } from "react";
import { MISSING_VALUE } from "./card";
import type { ShareCardLine, ShareCardPayload } from "./types";

export type ShareCardProps = {
  /** Deterministic payload produced by assembleShareCard. */
  payload: ShareCardPayload;
};

const cardStyle: CSSProperties = {
  background: "#FFFFFF",
  borderRadius: 16,
  border: "1px solid rgba(15,30,46,0.08)",
  padding: 14,
  color: "#0F1E2E",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 8,
  margin: 0,
};

const nameStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  margin: 0,
};

const liveStyle: CSSProperties = {
  fontSize: 11,
  color: "#2E8B6B",
  fontWeight: 600,
  flex: "0 0 auto",
};

const regionStyle: CSSProperties = {
  margin: "2px 0 0",
  fontSize: 12,
  color: "#5A6B7A",
};

const linesStyle: CSSProperties = {
  listStyle: "none",
  margin: "12px 0 0",
  padding: 0,
  display: "grid",
  gap: 8,
};

const lineStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 13,
};

const lineLabelStyle: CSSProperties = {
  color: "#5A6B7A",
};

const lineValueStyle: CSSProperties = {
  fontWeight: 600,
  textAlign: "right",
};

const pulseValueStyle: CSSProperties = {
  ...lineValueStyle,
  color: "#0A6E78",
  fontSize: 15,
};

const noteStyle: CSSProperties = {
  margin: "12px 0 0",
  padding: "8px 10px",
  borderRadius: 10,
  fontSize: 12,
  lineHeight: 1.4,
};

const degradedNoteStyle: CSSProperties = {
  ...noteStyle,
  background: "rgba(255,107,92,0.10)",
  color: "#B33A2E",
};

const staleNoteStyle: CSSProperties = {
  ...noteStyle,
  background: "rgba(15,30,46,0.05)",
  color: "#5A6B7A",
};

const linkSectionStyle: CSSProperties = {
  margin: "14px 0 0",
  padding: 12,
  borderRadius: 12,
  background: "rgba(10,110,120,0.08)",
};

const chipStyle: CSSProperties = {
  display: "inline-block",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#0A6E78",
  border: "1px solid rgba(10,110,120,0.35)",
  borderRadius: 999,
  padding: "3px 8px",
};

const linkStyle: CSSProperties = {
  display: "block",
  margin: "8px 0 0",
  color: "#0A6E78",
  fontWeight: 600,
  fontSize: 12,
  wordBreak: "break-all",
};

const linkNoteStyle: CSSProperties = {
  display: "block",
  margin: "6px 0 0",
  fontSize: 11,
  color: "#5A6B7A",
};

const captionStyle: CSSProperties = {
  margin: "12px 0 0",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px dashed rgba(15,30,46,0.15)",
  fontSize: 12,
  lineHeight: 1.5,
};

const captionLabelStyle: CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#5A6B7A",
  marginBottom: 4,
};

function lineValueStyleFor(index: number): CSSProperties {
  return index === 0 ? pulseValueStyle : lineValueStyle;
}

function renderLine(line: ShareCardLine, index: number) {
  const isMissing = line.value === MISSING_VALUE;
  return (
    <li key={line.label} className="share-card-line" style={lineStyle}>
      <span className="share-card-line-label" style={lineLabelStyle}>
        {line.label}
      </span>
      <span
        className="share-card-line-value"
        style={
          isMissing
            ? { ...lineValueStyleFor(index), color: "#5A6B7A" }
            : lineValueStyleFor(index)
        }
      >
        {line.value}
      </span>
    </li>
  );
}

/**
 * Pure presentational share card. Renders a ShareCardPayload exactly as
 * assembled — no own state, no clock, so output is deterministic given
 * the payload and it renders identically in the browser, in node tests,
 * and (eventually) to a static image for TikTok/IG export.
 */
export function ShareCard({ payload }: ShareCardProps) {
  return (
    <article
      className="share-card"
      style={cardStyle}
      aria-label={`Share card for ${payload.beachName}`}
    >
      <header className="share-card-header" style={headerStyle}>
        <h4 className="share-card-name" style={nameStyle}>
          {payload.beachName}
        </h4>
        <span className="share-card-live" style={liveStyle}>
          Right now
        </span>
      </header>
      {payload.region ? (
        <p className="share-card-region" style={regionStyle}>
          {payload.region}
        </p>
      ) : null}

      <ul className="share-card-lines" style={linesStyle}>
        {payload.lines.map(renderLine)}
      </ul>

      {payload.degraded ? (
        <p
          className="share-card-note-degraded"
          style={degradedNoteStyle}
          role="note"
        >
          Live values are unavailable right now — this card refreshes with the
          next reading. The link still points at the beach.
        </p>
      ) : payload.staleConditions ? (
        <p className="share-card-note-stale" style={staleNoteStyle} role="note">
          Last observed a while ago — treat these values as a guide, not gospel.
        </p>
      ) : null}

      <div className="share-card-link" style={linkSectionStyle}>
        <span className="share-card-link-chip" style={chipStyle}>
          Sponsored-free, data-side
        </span>
        <a
          className="share-card-link-url"
          style={linkStyle}
          href={payload.deepLink}
          target="_blank"
          rel="noopener noreferrer"
        >
          {payload.deepLink}
        </a>
        <span className="share-card-link-note" style={linkNoteStyle}>
          No paid placement in this card or its ranking — plain URL, select and
          copy.
        </span>
      </div>

      <div className="share-card-caption" style={captionStyle}>
        <span className="share-card-caption-label" style={captionLabelStyle}>
          Paste into TikTok / Instagram
        </span>
        <span className="share-card-caption-text">{payload.caption}</span>
      </div>
    </article>
  );
}
