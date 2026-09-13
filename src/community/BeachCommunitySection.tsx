/**
 * Beach Detail sections for the community loop: vibe votes + accuracy ratings.
 *
 * `VibeBar` and `AccuracyWidget` are self-contained presentational components;
 * this wrapper is their mount point on Beach Detail. It owns the fetching and
 * the optimistic update so the components stay pure and testable.
 *
 * Without this both components were orphaned — built and tested, but rendered
 * nowhere, so a beachgoer could not vote a vibe or rate a condition and the
 * Beach Pulse community signals could never accumulate.
 */
import { useCallback, useEffect, useState } from "react";
import { VibeBar } from "../vibes/VibeBar";
import type { AudienceTag } from "../vibes/types";
import { AccuracyWidget } from "../accuracy/AccuracyWidget";
import { fetchBeachAccuracy, submitAccuracyRating } from "../accuracy/api";
import type { AccuracyCondition, BeachAccuracy } from "../accuracy/types";

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
  onToast,
}: {
  beachId: string;
  beach: { suitability?: Array<{ id?: string; label?: string }> };
  onToast?: (message: string) => void;
}) {
  const [accuracy, setAccuracy] = useState<BeachAccuracy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAccuracy(await fetchBeachAccuracy(beachId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "accuracy_unavailable");
    } finally {
      setLoading(false);
    }
  }, [beachId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRate = useCallback(
    async (condition: AccuracyCondition, rating: number) => {
      try {
        await submitAccuracyRating({ beachId, condition, rating });
        onToast?.("Thanks — accuracy feedback recorded");
        await load();
      } catch (cause) {
        onToast?.(
          cause instanceof Error
            ? cause.message.replaceAll("_", " ")
            : "Could not record feedback",
        );
      }
    },
    [beachId, load, onToast],
  );

  return (
    <>
      <VibeBar beachId={beachId} audienceTag={audienceTagFor(beach)} />
      <AccuracyWidget
        accuracy={accuracy}
        loading={loading}
        error={error}
        onRate={handleRate}
      />
    </>
  );
}

export default BeachCommunitySection;
