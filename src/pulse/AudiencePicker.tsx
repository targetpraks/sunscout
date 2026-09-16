import { useRef } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { AUDIENCE_LABELS, PULSE_AUDIENCES } from "./scoring";
import type { PulseAudience } from "./types";

type Props = {
  /** Currently selected audience (controlled component). */
  value: PulseAudience;
  /** Invoked when a chip is clicked or reached with arrow keys. */
  onChange: (audience: PulseAudience) => void;
  /** Id of the region the chips control (aria-controls), e.g. the leaderboard. */
  controlsId?: string;
  /** Accessible name for the chip group. */
  label?: string;
  className?: string;
};

const listStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  margin: 0,
};

const chipStyle = (selected: boolean): CSSProperties => ({
  padding: "8px 16px",
  borderRadius: "999px",
  border: `1px solid ${selected ? "#0A6E78" : "#0F1E2E1F"}`,
  backgroundColor: selected ? "#0A6E78" : "#FAF6F0",
  color: selected ? "#FAF6F0" : "#0F1E2E",
  fontWeight: selected ? 700 : 500,
  fontSize: "13px",
  lineHeight: 1.2,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

/**
 * Six keyboard-accessible audience chips (Family, Friends, Solo, Couples,
 * Party, Chill) for the Beach Pulse leaderboard. Tablist semantics with a
 * roving tabindex: Tab lands on the selected chip, arrows/Home/End move (and
 * select) between audiences, so switching is a single-key action for keyboard
 * and switch-access users. Standalone like the rest of the pulse folder:
 * imports only from ./scoring and ./types, no new dependencies.
 */
export default function AudiencePicker({
  value,
  onChange,
  controlsId,
  label = "Audience",
  className,
}: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);

  const focusChip = (index: number) => {
    const chips =
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        "button[role='tab']",
      );
    chips?.[index]?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const count = PULSE_AUDIENCES.length;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % count;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + count) % count;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = count - 1;
    }
    if (next === null) return;
    // Arrow moves select AND focus — a single keystroke switches audience.
    event.preventDefault();
    onChange(PULSE_AUDIENCES[next]);
    focusChip(next);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-controls={controlsId}
      className={className}
      style={listStyle}
    >
      {PULSE_AUDIENCES.map((audience, index) => {
        const selected = audience === value;
        return (
          <button
            key={audience}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(audience)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            style={chipStyle(selected)}
          >
            {AUDIENCE_LABELS[audience]}
          </button>
        );
      })}
    </div>
  );
}
