/**
 * Presentational preview of an assembled "right now" share card
 * (PRD §5.5). Pure rendering — all assembly logic lives in ./share.
 */

import type { CSSProperties } from "react";
import type { ShareCard as ShareCardData } from "./types";

const cardStyle: CSSProperties = {
  background: "#FAF6F0",
  border: "1px solid rgba(10, 110, 120, 0.18)",
  borderRadius: 14,
  color: "#0F1E2E",
  fontSize: 13,
  lineHeight: 1.45,
  margin: "10px 0 0",
  padding: "10px 12px",
};

const titleStyle: React.CSSProperties = {
  color: "#0A6E78",
  fontWeight: 700,
  margin: 0,
};

const fieldListStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
  listStyle: "none",
  margin: "8px 0 0",
  padding: 0,
};

const fieldLabelStyle: React.CSSProperties = {
  color: "#5A6B7A",
  display: "block",
  fontSize: 11,
};

const linkStyle: React.CSSProperties = {
  color: "#0A6E78",
  display: "inline-block",
  fontSize: 12,
  marginTop: 6,
  overflowWrap: "anywhere",
};

/**
 * Renders the card exactly as it will read when shared: title, the
 * condition lines that survived degradation, the caption, and the deep
 * link back to the beach.
 */
export function ShareCard({ card }: { card: ShareCardData }) {
  return (
    <figure className="share-card" style={cardStyle}>
      <figcaption className="share-card-title" style={titleStyle}>
        {card.title}
      </figcaption>
      {card.fields.length > 0 ? (
        <ul className="share-card-fields" style={fieldListStyle}>
          {card.fields.map((field) => (
            <li className="share-card-field" key={field.label}>
              <span className="share-card-field-label" style={fieldLabelStyle}>
                {field.label}
              </span>
              <strong className="share-card-field-value">{field.value}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="share-card-empty" style={{ margin: "8px 0 0" }}>
          Live conditions are temporarily unavailable for this beach.
        </p>
      )}
      <blockquote
        className="share-card-caption"
        style={{ margin: "8px 0 0", fontSize: 12 }}
      >
        {card.caption}
      </blockquote>
      <a className="share-card-link" href={card.url} style={linkStyle}>
        {card.url}
      </a>
    </figure>
  );
}
