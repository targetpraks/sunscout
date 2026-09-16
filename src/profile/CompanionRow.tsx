import { Users, X } from "lucide-react";
import { RELATIONSHIP_LABELS, type Companion } from "./types";

/**
 * Presentational companion chip: name + relationship, with an optional
 * remove affordance. Used by the profile editor and the booking receipt's
 * "Who's coming" section. Styles are scoped inline (styles.css is owned by
 * the app shell) under the shared .pf- prefix for profile-surface components.
 */
export function companionChipStyles(): string {
  return `
    .pf-chip-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .pf-chip { display: inline-flex; align-items: center; gap: 6px; background: #fff; border: 1px solid rgba(10,110,120,0.18); border-radius: 999px; padding: 5px 10px; font-size: 13px; font-weight: 600; color: #0F1E2E; box-shadow: 0 1px 2px rgba(15,30,46,0.05); }
    .pf-chip svg { color: #0A6E78; flex: none; }
    .pf-chip small { color: #51616f; font-weight: 500; text-transform: capitalize; }
    .pf-chip button { display: inline-grid; place-items: center; background: none; border: none; color: #c04b40; cursor: pointer; padding: 1px; border-radius: 6px; }
    .pf-chip button:hover { background: rgba(255,107,92,0.12); }
    .pf-chip-empty { color: #51616f; font-size: 13px; }
  `;
}

export function CompanionRow({
  companion,
  onRemove,
}: {
  companion: Pick<Companion, "publicId" | "name" | "relationship">;
  /** When omitted the chip renders read-only (receipt display). */
  onRemove?: (companionPublicId: string) => void;
}) {
  return (
    <span className="pf-chip" data-companion={companion.publicId}>
      <Users size={14} aria-hidden />
      <span>{companion.name}</span>
      <small>{RELATIONSHIP_LABELS[companion.relationship]}</small>
      {onRemove ? (
        <button
          onClick={() => onRemove(companion.publicId)}
          aria-label={`Remove ${companion.name}`}
          type="button"
        >
          <X size={13} />
        </button>
      ) : null}
    </span>
  );
}

export default CompanionRow;
