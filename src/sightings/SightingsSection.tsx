import { useCallback, useEffect, useState } from "react";
import { SightingCapture } from "./SightingCapture";
import { SightingRail } from "./SightingRail";
import type { NewSightingInput, Sighting } from "./types";

const apiBase = import.meta.env.VITE_API_URL ?? "/api";

/**
 * Post a capture through the live POST /api/sightings endpoint. The server
 * schema is FLAT (mediaForm/mediaUrl/mediaPlatform/.../peopleInFrame/
 * peopleConsent), while SightingCapture produces the nested
 * NewSightingInput — translate here. The shared helper's nested contract
 * stays untouched (it is covered by the events/sightings api tests).
 */
async function postSighting(input: NewSightingInput): Promise<void> {
  const native = input.nativeMedia;
  const social = input.socialLink;
  const response = await fetch(`${apiBase}/sightings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sunscout-user-id": "00000000-0000-7000-8000-000000000001",
    },
    body: JSON.stringify({
      beachId: input.beachId,
      audience: input.audience,
      timeOfDay: input.timeOfDay ?? undefined,
      caption: input.caption ?? undefined,
      mediaForm: native ? "native" : "link",
      mediaUrl: native?.url ?? social?.url ?? "",
      mediaMimeType: native?.mimeType,
      mediaPlatform: social?.platform,
      mediaAttribution: social?.attribution,
      peopleInFrame: input.consent.peopleInFrame,
      peopleConsent: input.consent.peopleConsent,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      issues?: Array<{ message?: string }>;
    };
    throw new Error(
      body.error ??
        body.issues?.map((issue) => issue.message).join(" ") ??
        `api_${response.status}`,
    );
  }
}

type RailStatus = "loading" | "ready" | "error";

/**
 * Beach Detail section for the ephemeral sightings surface. Self-contained,
 * same pattern as TidePanel's dayScore fetch: loads the beach-scoped feed
 * from the live GET /api/beaches/:id/sightings endpoint (the server is
 * expiry- and moderation-aware), renders the rail, and hosts the capture
 * sheet. Link-mode captures post end-to-end via POST /api/sightings; native
 * uploads degrade honestly inside SightingCapture until the storage
 * pipeline ships. Refreshes the rail after a successful post.
 */
export function SightingsSection({ beachId }: { beachId: string }) {
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [status, setStatus] = useState<RailStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch(
        `${apiBase}/beaches/${encodeURIComponent(beachId)}/sightings`,
        {
          headers: {
            "content-type": "application/json",
            "x-sunscout-user-id": "00000000-0000-7000-8000-000000000001",
          },
        },
      );
      if (!response.ok) throw new Error(`api_${response.status}`);
      const body = (await response.json()) as { data?: Sighting[] };
      setSightings(body.data ?? []);
      setStatus("ready");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load sightings.",
      );
      setStatus("error");
    } finally {
      setNow(new Date());
    }
  }, [beachId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <SightingRail
        sightings={sightings}
        status={status}
        now={now}
        error={error}
        beachId={beachId}
        onCapture={() => setCaptureOpen(true)}
        onRetry={() => void load()}
      />
      {status === "ready" && sightings.length > 0 ? (
        <button
          className="text-button"
          type="button"
          onClick={() => setCaptureOpen(true)}
        >
          Post a sighting for this beach
        </button>
      ) : null}
      {captureOpen ? (
        <SightingCapture
          beachId={beachId}
          onCancel={() => setCaptureOpen(false)}
          submitting={submitting}
          submitError={submitError}
          onSubmit={async (input) => {
            setSubmitting(true);
            setSubmitError(null);
            try {
              await postSighting(input);
              setSubmitting(false);
              setCaptureOpen(false);
              await load();
            } catch (cause) {
              setSubmitting(false);
              setSubmitError(
                cause instanceof Error
                  ? cause.message
                  : "Could not post sighting.",
              );
              throw cause;
            }
          }}
        />
      ) : null}
    </>
  );
}

export default SightingsSection;
