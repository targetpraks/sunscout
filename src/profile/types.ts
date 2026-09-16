/**
 * Client-side companion domain types and pure helpers for the group profile
 * and the booking "Who's coming" editor. Mirrors the server module
 * (server/companions.ts) — the front-end cannot import server code, so keep
 * the two copies aligned. Field names match the server serializers.
 */

export const COMPANION_RELATIONSHIPS = ["family", "friend", "solo"] as const;

export type CompanionRelationship = (typeof COMPANION_RELATIONSHIPS)[number];

export const RELATIONSHIP_LABELS: Record<CompanionRelationship, string> = {
  family: "Family",
  friend: "Friend",
  solo: "Solo",
};

export type Companion = {
  publicId: string;
  name: string;
  relationship: CompanionRelationship;
  createdAt: string;
};

export const COMPANION_NAME_MAX = 80;

/**
 * Client-side name validation mirroring the server's zod schema: trimmed,
 * 1–80 chars. Always returns { name, message } — an empty message means
 * valid, and name is the trimmed value to use.
 */
export function validateCompanionName(name: string): {
  name: string;
  message: string;
} {
  const trimmed = name.trim();
  if (!trimmed) return { name: trimmed, message: "Enter a name" };
  if (trimmed.length > COMPANION_NAME_MAX) {
    return {
      name: trimmed,
      message: `Name must be ${COMPANION_NAME_MAX} characters or fewer`,
    };
  }
  return { name: trimmed, message: "" };
}

/** True when the trimmed name collides case-insensitively — mirrors the 409. */
export function isDuplicateCompanionName(
  name: string,
  companions: ReadonlyArray<Pick<Companion, "name">>,
): boolean {
  const needle = name.trim().toLowerCase();
  return companions.some(
    (companion) => companion.name.trim().toLowerCase() === needle,
  );
}

export function formatCompanionLabel(
  companion: Pick<Companion, "name" | "relationship">,
): string {
  return `${companion.name} · ${RELATIONSHIP_LABELS[companion.relationship]}`;
}

/**
 * Toggle-one checkbox semantics over the FULL attached set: returns the
 * complete companion id array to send to the full-replace PATCH — removing
 * the id when it is present, adding it when it is not. The editor must
 * always PATCH this complete array, never a delta.
 */
export function toggleAttachedCompanion(
  attachedPublicIds: ReadonlyArray<string>,
  companionPublicId: string,
): string[] {
  return attachedPublicIds.includes(companionPublicId)
    ? attachedPublicIds.filter((id) => id !== companionPublicId)
    : [...attachedPublicIds, companionPublicId];
}

/**
 * The next attached set after adding a brand-new companion to the profile:
 * the created companion is attached right away so the user sees it checked.
 */
export function withNewCompanionAttached(
  attachedPublicIds: ReadonlyArray<string>,
  newCompanionPublicId: string,
): string[] {
  return [...attachedPublicIds, newCompanionPublicId];
}

/**
 * Group companions by relationship for the editor's sections. Iteration
 * order follows COMPANION_RELATIONSHIPS; companions within a group keep
 * their incoming order.
 */
export function partitionCompanionsByRelationship(
  companions: ReadonlyArray<Companion>,
): Record<CompanionRelationship, Companion[]> {
  const groups: Record<CompanionRelationship, Companion[]> = {
    family: [],
    friend: [],
    solo: [],
  };
  for (const companion of companions) {
    groups[companion.relationship].push(companion);
  }
  return groups;
}

/**
 * Friendly copy for the editor's known error codes, matching the server's
 * error identifiers. Lives in types.ts (not the component) so node vitest
 * can import it without pulling a .tsx through the transform.
 */
export function companionsErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "companion_duplicate_name")
    return "You already have a companion with that name.";
  if (code === "companion_not_owned_or_missing")
    return "One of those companions is no longer in your profile — refresh and try again.";
  if (code === "booking_not_found") return "This booking could not be found.";
  return error instanceof Error
    ? error.message.replaceAll("_", " ")
    : "Something went wrong";
}
