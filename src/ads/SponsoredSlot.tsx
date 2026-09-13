import type { CSSProperties } from "react";
import {
  AD_KIND_LABELS,
  SPONSORED_LABEL,
  type SponsoredPlacement,
} from "./types";

const styles = {
  slot: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 12px",
    borderTop: "1px solid rgba(15,30,46,0.08)",
  } satisfies CSSProperties,
  top: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  brand: {
    fontWeight: 700,
    fontSize: 13,
    color: "#0F1E2E",
  } satisfies CSSProperties,
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    background: "rgba(255,107,92,0.14)",
    color: "#FF6B5C",
  } satisfies CSSProperties,
  kind: { fontSize: 11, color: "#5B6B7B" } satisfies CSSProperties,
  headline: {
    fontWeight: 600,
    fontSize: 14,
    color: "#0F1E2E",
  } satisfies CSSProperties,
  body: { fontSize: 12, color: "#5B6B7B", margin: 0 } satisfies CSSProperties,
  cta: {
    fontSize: 12,
    fontWeight: 600,
    color: "#0A6E78",
    textDecoration: "none",
  } satisfies CSSProperties,
};

/**
 * One paid placement, always carrying the visible Sponsored disclosure.
 * Pure props — no data fetching, no clock reads, so it renders identically
 * on the server and in node tests.
 */
export function SponsoredSlot({
  placement,
}: {
  placement: SponsoredPlacement;
}) {
  const label = placement.label?.trim() || SPONSORED_LABEL;
  return (
    <li style={styles.slot}>
      <span style={styles.top}>
        <span style={styles.badge}>{label}</span>
        <span style={styles.brand}>{placement.brandName}</span>
        <span style={styles.kind}>{AD_KIND_LABELS[placement.kind]}</span>
      </span>
      {placement.headline ? (
        <span style={styles.headline}>{placement.headline}</span>
      ) : null}
      {placement.body ? <p style={styles.body}>{placement.body}</p> : null}
      {placement.targetUrl ? (
        <a
          href={placement.targetUrl}
          // The honest SEO disclosure for paid links.
          rel="sponsored noopener noreferrer"
          target="_blank"
          style={styles.cta}
        >
          Learn more
        </a>
      ) : null}
    </li>
  );
}
