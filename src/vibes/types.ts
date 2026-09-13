// Client-side types for the per-audience vibe vote surface. These mirror the
// shapes returned by GET /api/beaches/:id/vibes and POST /api/vibes in
// server/vibes.ts. Named distinctly from the VibeVote toggle type in
// ../types.ts (legacy vibe_tag toggles) to avoid confusion.

export type VibeTag =
  | "chill"
  | "party"
  | "family"
  | "romantic"
  | "hidden-gem"
  | "beach-club";

// Superset of the beach_suitability audience ids and the per-audience
// leaderboard scopes — keyed for Beach Pulse consumption.
export type AudienceTag =
  | "families"
  | "friends"
  | "solo"
  | "couples"
  | "party"
  | "clubs"
  | "chill"
  | "beach-club";

export type VibeTally = {
  tag: string;
  votes: number;
  weight: number;
  share: number;
};

/** The Beach Pulse community-signal shape emitted alongside every aggregate. */
export type PulseVibeSignal = {
  kind: "vibe_votes";
  beachId: string;
  computedAt: string;
  windowStart: string;
  totalVotes: number;
  dominantVibe: string | null;
  dominantAudience: string | null;
  perVibe: Record<string, number>;
  perAudience: Record<string, number>;
};

export type ViewerState = {
  voted: boolean;
  cooldownUntil: string | null;
  cooldownRemainingMs: number;
};

export type BeachVibesResponse = {
  beachId: string;
  totalVotes: number;
  windowStart: string;
  computedAt: string;
  vibes: VibeTally[];
  audiences: VibeTally[];
  pulse: PulseVibeSignal;
  viewer?: ViewerState;
};

export type VibeVoteInput = {
  beachId: string;
  vibe: VibeTag;
  audienceTag: AudienceTag;
};

/** POST /api/vibes response: the fresh aggregate plus the viewer cooldown. */
export type CastVibeVoteResult = BeachVibesResponse & {
  cooldownUntil: string;
};
