/**
 * Beach Detail section for the community vibe loop.
 *
 * Two community surfaces, each with exactly one home:
 * - `PulseStrip` (top) — the live per-audience Beach Pulse score plus the
 *   top contributing factors, flowing through ../pulse/api against the
 *   mounted GET /api/beaches/:id/pulse endpoint.
 * - `VibeBar` (below) — self-contained (own fetch + optimistic update),
 *   mounted with the viewer's audience tag derived from the beach's
 *   primary suitability.
 *
 * Condition-accuracy ratings are owned by `src/accuracy` (the canonical
 * implementation merged via PR #11 and mounted separately on Today +
 * Beach Detail) — this section keeps each community signal on exactly
 * one surface.
 */
import { VibeBar } from "../vibes/VibeBar";
import type { AudienceTag } from "../vibes/types";
import PulseStrip from "../pulse/PulseStrip";
import type { PulseAudience } from "../pulse/types";

/** The beach's primary audience tag drives which vibe bucket the viewer votes in. */
function audienceTagFor(beach: {
  suitability?: Array<{ id?: string; label?: string }>;
}): AudienceTag {
  const primary = beach.suitability?.[0];
  const raw = (primary?.id ?? primary?.label ?? "").toLowerCase();
  if (raw.includes("famil")) return "families";
  if (raw.includes("solo")) return "solo";
  if (raw.includes("coup")) return "couples";
  if (raw.includes("club")) return "clubs";
  if (raw.includes("party")) return "party";
  if (raw.includes("friend")) return "friends";
  return "chill";
}

/**
 * The beach's primary suitability, as the Beach Pulse audience whose
 * score the strip shows — families bring the family weights, club and
 * party scenes bring the party weights. Defaults to the family profile
 * when the beach carries no suitability tag.
 */
export function pulseAudienceFor(beach: {
  suitability?: Array<{ id?: string; label?: string }>;
}): PulseAudience {
  const primary = beach.suitability?.[0];
  const raw = (primary?.id ?? primary?.label ?? "").toLowerCase();
  if (raw.includes("famil")) return "family";
  if (raw.includes("solo")) return "solo";
  if (raw.includes("coup")) return "couples";
  if (raw.includes("party")) return "party";
  if (raw.includes("club")) return "party";
  if (raw.includes("friend")) return "friends";
  if (raw.includes("chill")) return "chill";
  return "family";
}

export function BeachCommunitySection({
  beachId,
  beach,
}: {
  beachId: string;
  beach: { suitability?: Array<{ id?: string; label?: string }> };
}) {
  return (
    <>
      <PulseStrip beachId={beachId} audience={pulseAudienceFor(beach)} />
      <VibeBar beachId={beachId} audienceTag={audienceTagFor(beach)} />
    </>
  );
}

export default BeachCommunitySection;
