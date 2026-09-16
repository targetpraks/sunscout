/**
 * Beach Detail section for the community vibe loop.
 *
 * `VibeBar` is self-contained (own fetch + optimistic update); this wrapper
 * derives the viewer's audience tag from the beach's primary suitability and
 * mounts the bar. Condition-accuracy ratings are owned by `src/accuracy`
 * (the canonical implementation merged via PR #11 and mounted separately on
 * Today + Beach Detail) — this section is vibes-only so each community
 * signal keeps exactly one surface.
 */
import { VibeBar } from "../vibes/VibeBar";
import type { AudienceTag } from "../vibes/types";

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

export function BeachCommunitySection({
  beachId,
  beach,
}: {
  beachId: string;
  beach: { suitability?: Array<{ id?: string; label?: string }> };
}) {
  return <VibeBar beachId={beachId} audienceTag={audienceTagFor(beach)} />;
}

export default BeachCommunitySection;
