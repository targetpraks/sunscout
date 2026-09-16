import { describe, expect, it } from "vitest";
import {
  COMPANION_NAME_MAX,
  COMPANION_RELATIONSHIPS,
  companionsErrorMessage,
  formatCompanionLabel,
  isDuplicateCompanionName,
  partitionCompanionsByRelationship,
  RELATIONSHIP_LABELS,
  toggleAttachedCompanion,
  validateCompanionName,
  withNewCompanionAttached,
  type Companion,
} from "./types";

function makeCompanion(overrides: Partial<Companion> = {}): Companion {
  return {
    publicId: "11111111-1111-4111-8111-111111111111",
    name: "Ana",
    relationship: "friend",
    createdAt: "2026-09-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("validateCompanionName", () => {
  it("accepts a normal name and returns it trimmed with an empty message", () => {
    expect(validateCompanionName("  Ana  ")).toEqual({
      name: "Ana",
      message: "",
    });
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(validateCompanionName("").message).toBe("Enter a name");
    expect(validateCompanionName("   ").message).toBe("Enter a name");
  });

  it("rejects a name over the 80-character limit", () => {
    const result = validateCompanionName("a".repeat(COMPANION_NAME_MAX + 1));
    expect(result.message).toContain("80");
  });

  it("accepts a name exactly at the limit", () => {
    expect(validateCompanionName("a".repeat(COMPANION_NAME_MAX)).message).toBe(
      "",
    );
  });
});

describe("isDuplicateCompanionName", () => {
  const companions = [
    makeCompanion({ name: "Ana" }),
    makeCompanion({ publicId: "2", name: "Bruno" }),
  ];

  it("matches case-insensitively", () => {
    expect(isDuplicateCompanionName("ana", companions)).toBe(true);
    expect(isDuplicateCompanionName("BRUNO", companions)).toBe(true);
  });

  it("ignores surrounding whitespace on the candidate", () => {
    expect(isDuplicateCompanionName("  ana  ", companions)).toBe(true);
  });

  it("allows a genuinely new name", () => {
    expect(isDuplicateCompanionName("Carla", companions)).toBe(false);
  });

  it("treats an empty profile as never duplicate", () => {
    expect(isDuplicateCompanionName("Ana", [])).toBe(false);
  });
});

describe("toggleAttachedCompanion", () => {
  it("adds an id that is not attached", () => {
    expect(toggleAttachedCompanion(["c-1"], "c-2")).toEqual(["c-1", "c-2"]);
  });

  it("removes an id that is attached", () => {
    expect(toggleAttachedCompanion(["c-1", "c-2"], "c-1")).toEqual(["c-2"]);
  });

  it("returns a fresh array and does not mutate the input", () => {
    const attached = ["c-1"];
    toggleAttachedCompanion(attached, "c-2");
    expect(attached).toEqual(["c-1"]);
  });

  it("starts from an empty set", () => {
    expect(toggleAttachedCompanion([], "c-1")).toEqual(["c-1"]);
  });
});

describe("withNewCompanionAttached", () => {
  it("appends the newly created companion so it renders checked", () => {
    expect(withNewCompanionAttached(["c-1"], "c-new")).toEqual([
      "c-1",
      "c-new",
    ]);
  });
});

describe("partitionCompanionsByRelationship", () => {
  it("groups companions and skips empty groups at render time", () => {
    const companions = [
      makeCompanion({ publicId: "1", name: "Ana", relationship: "family" }),
      makeCompanion({ publicId: "2", name: "Bruno", relationship: "friend" }),
      makeCompanion({ publicId: "3", name: "Carla", relationship: "family" }),
      makeCompanion({ publicId: "4", name: "Dani", relationship: "solo" }),
    ];
    const groups = partitionCompanionsByRelationship(companions);
    expect(groups.family.map((c) => c.name)).toEqual(["Ana", "Carla"]);
    expect(groups.friend.map((c) => c.name)).toEqual(["Bruno"]);
    expect(groups.solo.map((c) => c.name)).toEqual(["Dani"]);
  });

  it("returns empty groups for an empty profile", () => {
    const groups = partitionCompanionsByRelationship([]);
    for (const relationship of COMPANION_RELATIONSHIPS) {
      expect(groups[relationship]).toEqual([]);
    }
  });

  it("keys every relationship the labels know about", () => {
    expect(Object.keys(RELATIONSHIP_LABELS).sort()).toEqual(
      [...COMPANION_RELATIONSHIPS].sort(),
    );
  });
});

describe("formatCompanionLabel", () => {
  it("joins name and relationship label", () => {
    expect(formatCompanionLabel({ name: "Ana", relationship: "family" })).toBe(
      "Ana · Family",
    );
  });
});

describe("companionsErrorMessage", () => {
  it("maps the duplicate-name 409 to friendly copy", () => {
    expect(
      companionsErrorMessage(new Error("companion_duplicate_name")),
    ).toContain("already have");
  });

  it("maps the not-owned 422 to friendly copy", () => {
    expect(
      companionsErrorMessage(new Error("companion_not_owned_or_missing")),
    ).toContain("no longer in your profile");
  });

  it("maps a missing booking to friendly copy", () => {
    expect(companionsErrorMessage(new Error("booking_not_found"))).toContain(
      "could not be found",
    );
  });

  it("humanizes unknown api error codes", () => {
    const message = companionsErrorMessage(new Error("api_timeout"));
    expect(message).toBe("api timeout");
  });

  it("falls back for non-error values", () => {
    expect(companionsErrorMessage(undefined)).toBe("Something went wrong");
  });
});
