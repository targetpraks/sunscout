/**
 * Share button for the "right now" beach conditions card (PRD §5.5).
 *
 * Mounted from the Beach Detail conditions panel (TidePanel). Builds the
 * card synchronously from already-loaded local data and pushes it out via
 * the Web Share API, falling back to the clipboard when unavailable.
 * The card preview (ShareCard) is rendered once an outcome is available,
 * so the user sees exactly what was shared.
 */

import { Share2 } from "lucide-react";
import { useState } from "react";
import type { Beach } from "../types";
import { buildShareCard, browserShareDeps, shareCard } from "./share";
import { ShareCard } from "./ShareCard";
import type { ShareConditions, ShareOutcome } from "./types";

type Status = "idle" | "sharing" | ShareOutcome;

const statusMessage: Record<Status, string | null> = {
  idle: null,
  sharing: "Sharing…",
  shared: "Shared!",
  copied: "Copied to clipboard",
  cancelled: null, // user closed the native sheet — not an error, stay quiet
  unavailable: "Sharing isn't available in this browser — copy failed.",
  failed: "Couldn't share or copy. Please try again.",
};

export function ShareCardButton({
  beach,
  conditions,
  onOutcome,
}: {
  beach: Beach;
  conditions?: ShareConditions;
  onOutcome?: (outcome: ShareOutcome) => void;
}) {
  const [status, setStatus] = useState<Status>("idle");

  const handleClick = () => {
    // Card assembly and the share call must both start inside the click
    // handler with no awaits in between — the Web Share API requires the
    // user gesture, and buildShareCard is synchronous local-only work.
    const card = buildShareCard(beach, conditions);
    setStatus("sharing");
    shareCard(card, browserShareDeps())
      .then((outcome) => {
        setStatus(outcome);
        onOutcome?.(outcome);
      })
      .catch(() => {
        // shareCard never rejects by contract; guard against the unexpected.
        setStatus("failed");
        onOutcome?.("failed");
      });
  };

  const message = statusMessage[status];
  const showPreview =
    status !== "idle" && status !== "sharing" && status !== "cancelled";
  const card = showPreview ? buildShareCard(beach, conditions) : null;

  return (
    <div className="share-card-button">
      <button
        className="secondary-button share-trigger"
        onClick={handleClick}
        disabled={status === "sharing"}
        aria-label={`Share live conditions for ${beach.name}`}
      >
        <Share2 /> Share this beach right now
      </button>
      <span className="share-status" role="status" aria-live="polite">
        {message}
      </span>
      {card ? <ShareCard card={card} /> : null}
    </div>
  );
}
