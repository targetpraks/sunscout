import { useCallback, useEffect, useState } from "react";
import { castVibeVote, fetchBeachVibes } from "./api";
import type {
  AudienceTag,
  BeachVibesResponse,
  PulseVibeSignal,
  VibeTag,
} from "./types";

// Pure view-state derivation, exported so the node-environment test can
// exercise it without rendering.
export type VibeBarState = {
  status: "loading" | "ready" | "error";
  empty: boolean;
  disabled: boolean;
  cooldownRemainingMs: number;
  dominantVibe: string | null;
  signal: PulseVibeSignal | null;
};

export function vibeBarState(
  aggregate: BeachVibesResponse | null,
  cooldownRemainingMs: number,
  errorMessage: string | null,
): VibeBarState {
  if (errorMessage != null) {
    return {
      status: "error",
      empty: false,
      disabled: true,
      cooldownRemainingMs,
      dominantVibe: null,
      signal: null,
    };
  }
  if (aggregate == null) {
    return {
      status: "loading",
      empty: false,
      disabled: true,
      cooldownRemainingMs,
      dominantVibe: null,
      signal: null,
    };
  }
  const disabled = cooldownRemainingMs > 0;
  return {
    status: "ready",
    empty: aggregate.totalVotes === 0,
    disabled,
    cooldownRemainingMs,
    dominantVibe: aggregate.pulse.dominantVibe,
    signal: aggregate.pulse,
  };
}

const VIBE_OPTIONS: { tag: VibeTag; label: string }[] = [
  { tag: "chill", label: "Chill" },
  { tag: "party", label: "Party" },
  { tag: "family", label: "Family" },
  { tag: "romantic", label: "Romantic" },
  { tag: "hidden-gem", label: "Hidden gem" },
  { tag: "beach-club", label: "Beach club" },
];

function formatCooldown(ms: number): string {
  const hours = Math.ceil(ms / (60 * 60 * 1_000));
  return `Voted — new vote in ~${hours}h`;
}

export type VibeBarProps = {
  beachId: string;
  audienceTag: AudienceTag;
  /** Pre-seeded aggregate (skips the fetch) — used by tests and optimistic hosts. */
  initialAggregate?: BeachVibesResponse | null;
  /** Pre-seeded error (skips the fetch) — used by tests. */
  initialError?: string | null;
  /** Clock override for the cooldown countdown — used by tests. */
  nowMs?: number;
};

/**
 * Renders the current per-vibe aggregate for a beach and lets the viewer cast
 * one per-audience vibe vote per day. Exposes the Pulse-shaped community
 * signal via the `data-pulse` attribute for downstream Beach Pulse
 * consumers, and disables voting while the 24h cooldown is active.
 */
export function VibeBar({
  beachId,
  audienceTag,
  initialAggregate = null,
  initialError = null,
  nowMs,
}: VibeBarProps) {
  const [aggregate, setAggregate] = useState<BeachVibesResponse | null>(
    initialAggregate,
  );
  const [error, setError] = useState<string | null>(initialError);
  const [voting, setVoting] = useState(false);
  const [cooldownRemainingMs, setCooldownRemainingMs] = useState(
    initialAggregate?.viewer?.cooldownRemainingMs ?? 0,
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchBeachVibes(beachId);
      setAggregate(data);
      setCooldownRemainingMs(data.viewer?.cooldownRemainingMs ?? 0);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load beach vibes",
      );
    }
  }, [beachId]);

  useEffect(() => {
    // Skip the fetch when the host pre-seeded state (tests, optimistic hosts).
    if (initialAggregate != null || initialError != null) return;
    void load();
  }, []);

  const state = vibeBarState(aggregate, cooldownRemainingMs, error);

  const onVote = async (vibe: VibeTag) => {
    setVoting(true);
    setError(null);
    try {
      const data = await castVibeVote({ beachId, vibe, audienceTag });
      setAggregate(data);
      setCooldownRemainingMs(
        Math.max(
          0,
          new Date(data.cooldownUntil).getTime() - (nowMs ?? Date.now()),
        ),
      );
    } catch (cause) {
      // 409 duplicate_vibe_vote means the cooldown beat us — refresh to show
      // the authoritative cooldown state rather than a dead button.
      if (cause instanceof Error && cause.message === "duplicate_vibe_vote") {
        await load();
      } else {
        setError(
          cause instanceof Error ? cause.message : "Could not cast vibe vote",
        );
      }
    } finally {
      setVoting(false);
    }
  };

  if (state.status === "loading") {
    return (
      <section className="vibe-bar" aria-busy="true">
        <h3>Beach vibe</h3>
        <p>Loading beach vibes…</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="vibe-bar" role="alert">
        <h3>Beach vibe</h3>
        <p>{error}</p>
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </section>
    );
  }

  const data = aggregate as BeachVibesResponse;
  const cooldownActive = state.disabled;

  return (
    <section
      className="vibe-bar"
      data-beach-id={beachId}
      data-cooldown={cooldownActive ? "true" : "false"}
      data-pulse={JSON.stringify(state.signal)}
    >
      <h3>Beach vibe</h3>
      {state.empty ? (
        <p>No votes yet — be the first to set today&apos;s vibe.</p>
      ) : (
        <ul className="vibe-tallies">
          {data.vibes.map((entry) => (
            <li key={entry.tag} className="vibe-tally">
              <span className="vibe-tally-label">{entry.tag}</span>
              <span
                className="vibe-tally-bar"
                style={{ width: `${Math.round(entry.share * 100)}%` }}
                aria-hidden="true"
              />
              <span className="vibe-tally-count">{entry.votes}</span>
            </li>
          ))}
        </ul>
      )}
      {cooldownActive && state.cooldownRemainingMs > 0 ? (
        <p className="vibe-cooldown">
          {formatCooldown(state.cooldownRemainingMs)}
        </p>
      ) : null}
      <div className="vibe-options" role="group" aria-label="Cast a vibe vote">
        {VIBE_OPTIONS.map((option) => (
          <button
            key={option.tag}
            type="button"
            className="vibe-option"
            data-vibe={option.tag}
            disabled={cooldownActive || voting}
            aria-disabled={cooldownActive || voting}
            onClick={() => void onVote(option.tag)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export default VibeBar;
