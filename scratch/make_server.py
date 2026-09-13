"""One-shot generator for server/beachPulse.ts — inlines types + scoring
from src/pulse (server tsconfig rootDir forbids cross-tree imports).
Deleted after running."""
import re
from pathlib import Path

types = Path("src/pulse/types.ts").read_text()
scoring = Path("src/pulse/scoring.ts").read_text()

# Strip the leading /** ... */ header from types (client-specific prose).
types_body = re.sub(r"\A/\*\*.*?\*/\s*", "", types, count=1, flags=re.S)

# Grab scoring's design-contract header, then the body without the ./types import.
m = re.match(r"\A(/\*\*.*?\*/)\s*", scoring, flags=re.S)
if m is None:
    raise SystemExit("could not find scoring.ts header")
header = m.group(1)
body = scoring[m.end():]
body = re.sub(r'import type \{[^}]*\} from "\./types";\s*\n', "", body, count=1)

header = header.replace(
    "per-audience scoring core (client mirror)",
    "per-audience scoring core (server mirror)",
).replace(
    "KEEP IN SYNC with server/beachPulse.ts",
    "KEEP IN SYNC with src/pulse/scoring.ts",
).replace(
    "the server tree cannot import from\n * src/",
    "the server tree (rootDir: \".\") cannot import from\n * src/",
)

out = header + "\n\n" + types_body.rstrip() + "\n\n" + body
Path("server/beachPulse.ts").write_text(out)
print(f"wrote server/beachPulse.ts ({len(out)} bytes)")

# Server test: same fixture, same assertions — the drift guard for the mirror.
test = Path("src/pulse/scoring.test.ts").read_text()
test = test.replace('from "./scoring"', 'from "./beachPulse"')
test = test.replace('from "./types"', 'from "./beachPulse"')
test = re.sub(r'\Aimport \{ describe, expect, it \} from "vitest";\s*\n', "", test, count=1)
test_header = '''/**
 * Server-side Beach Pulse tests.
 *
 * These are the drift guard for the server/client mirror: the fixture and
 * every assertion are identical to src/pulse/scoring.test.ts (same beaches,
 * same numbers, same expected orderings). If either module diverges by one
 * constant, one of the two suites fails loudly.
 */

import { describe, expect, it } from "vitest";
'''
Path("server/beachPulse.test.ts").write_text(test_header + test)
print(f"wrote server/beachPulse.test.ts ({len(test_header + test)} bytes)")