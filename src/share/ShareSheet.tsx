import { useState, type CSSProperties } from "react";
import { ShareCard } from "./ShareCard";
import type { ShareCardPayload } from "./types";

export type ShareSheetProps = {
  /** Controlled: the mount site (or rail) owns the open state. */
  open: boolean;
  /** When null, a closed sheet renders nothing even if `open` is true. */
  payload: ShareCardPayload | null;
  onClose: () => void;
};

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,30,46,0.55)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  zIndex: 50,
};

const panelStyle: CSSProperties = {
  width: "100%",
  maxWidth: 420,
  maxHeight: "85vh",
  overflowY: "auto",
  background: "#FAF6F0",
  borderRadius: "20px 20px 0 0",
  padding: 16,
  boxSizing: "border-box",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  margin: "0 0 12px",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 700,
  color: "#0F1E2E",
};

const closeButtonStyle: CSSProperties = {
  border: "none",
  background: "rgba(15,30,46,0.08)",
  color: "#0F1E2E",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  padding: "6px 12px",
  cursor: "pointer",
};

const copyButtonStyle: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 12,
  border: "none",
  background: "#FF6B5C",
  color: "#FFFFFF",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 700,
  padding: "10px 16px",
  cursor: "pointer",
};

const handoffNoteStyle: CSSProperties = {
  display: "block",
  margin: "10px 0 0",
  fontSize: 11,
  color: "#5A6B7A",
  textAlign: "center",
};

/**
 * Bottom sheet hosting a ShareCard — the PRD 5.5 social handoff surface.
 *
 * Controlled and local-only: no navigator.share requirement, no external
 * service. The deep link is a plain copyable URL (rendered by ShareCard)
 * plus an explicit copy button that degrades gracefully when the
 * clipboard API is unavailable (e.g. non-secure contexts) — the link text
 * itself always remains select-to-copy.
 */
export function ShareSheet({ open, payload, onClose }: ShareSheetProps) {
  const [copied, setCopied] = useState(false);

  if (!open || !payload) return null;

  const closeSheet = () => {
    // Reset so a reopened sheet doesn't inherit the previous copy state.
    setCopied(false);
    onClose();
  };

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(payload.deepLink);
        setCopied(true);
      }
    } catch {
      // Clipboard unavailable — the visible URL stays select-to-copy.
    }
  };

  return (
    <div
      className="share-sheet"
      style={backdropStyle}
      onClick={closeSheet}
      role="presentation"
    >
      <div
        className="share-sheet-panel"
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${payload.beachName}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeSheet();
        }}
      >
        <header className="share-sheet-header" style={headerStyle}>
          <h3 className="share-sheet-title" style={titleStyle}>
            Share this beach
          </h3>
          <button
            type="button"
            className="share-sheet-close"
            style={closeButtonStyle}
            onClick={closeSheet}
            aria-label="Close share sheet"
          >
            Close
          </button>
        </header>

        <ShareCard payload={payload} />

        <button
          type="button"
          className="share-sheet-copy"
          style={copyButtonStyle}
          onClick={() => void handleCopy()}
        >
          {copied ? "Link copied ✓" : "Copy link"}
        </button>

        <span className="share-sheet-note" style={handoffNoteStyle}>
          Hand the audience to SunScout — the link opens live conditions, no
          sponsored placement.
        </span>
      </div>
    </div>
  );
}
