import { useEffect, useState } from "react";
import { CircleAlert, Plus, Users, X } from "lucide-react";
import {
  createCompanion,
  fetchCompanions,
  updateBookingCompanions,
} from "./api";
import {
  COMPANION_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
  companionsErrorMessage,
  isDuplicateCompanionName,
  partitionCompanionsByRelationship,
  toggleAttachedCompanion,
  validateCompanionName,
  withNewCompanionAttached,
  type Companion,
  type CompanionRelationship,
} from "./types";

/**
 * "Who's coming" editor for one booking: the caller's full companion list
 * with checkboxes for who is coming, an inline add-companion form (the new
 * companion is auto-checked), and a Save that PATCHes the COMPLETE attached
 * id array (full-replace semantics — never a delta). Styles are scoped
 * inline under the shared .pf- prefix (styles.css is owned by the app
 * shell).
 */
export function CompanionsEditor({
  bookingPublicId,
  attachedCompanions,
  onClose,
  onSaved,
}: {
  bookingPublicId: string;
  /** The companions currently attached to the booking (chips state). */
  attachedCompanions: ReadonlyArray<
    Pick<Companion, "publicId" | "name" | "relationship">
  >;
  onClose: () => void;
  /** Receives the server-confirmed attached set after a successful save. */
  onSaved: (companions: Companion[]) => void;
}) {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [attachedIds, setAttachedIds] = useState<string[]>(
    attachedCompanions.map((companion) => companion.publicId),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRelationship, setNewRelationship] =
    useState<CompanionRelationship>("friend");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchCompanions()
      .then((list) => {
        if (!cancelled) setCompanions(list);
      })
      .catch((loadError) => {
        if (!cancelled) setError(companionsErrorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = partitionCompanionsByRelationship(companions);
  const attachedCount = attachedIds.length;

  const handleToggle = (companionPublicId: string) => {
    setAttachedIds((current) =>
      toggleAttachedCompanion(current, companionPublicId),
    );
  };

  const handleAdd = async () => {
    setFormError("");
    const validated = validateCompanionName(newName);
    if (validated.message) {
      setFormError(validated.message);
      return;
    }
    if (isDuplicateCompanionName(validated.name, companions)) {
      setFormError("You already have a companion with that name.");
      return;
    }
    try {
      const created = await createCompanion({
        name: validated.name,
        relationship: newRelationship,
      });
      setCompanions((current) => [created, ...current]);
      setAttachedIds((current) =>
        withNewCompanionAttached(current, created.publicId),
      );
      setNewName("");
    } catch (addError) {
      setFormError(companionsErrorMessage(addError));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const saved = await updateBookingCompanions(bookingPublicId, attachedIds);
      onSaved(saved);
    } catch (saveError) {
      setError(companionsErrorMessage(saveError));
      setSaving(false);
    }
  };

  return (
    <div
      className="pf-editor-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Edit who's coming"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="pf-editor">
        <style>{`
          .pf-editor-backdrop { position: fixed; inset: 0; background: rgba(15,30,46,0.45); display: grid; place-items: end center; z-index: 50; }
          .pf-editor { background: #FAF6F0; width: 100%; max-width: 430px; max-height: 82dvh; overflow-y: auto; border-radius: 18px 18px 0 0; padding: 18px 16px 24px; }
          .pf-editor-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
          .pf-editor-head h2 { margin: 0; font-size: 18px; color: #0F1E2E; }
          .pf-editor-head button { background: none; border: none; color: #51616f; cursor: pointer; padding: 4px; border-radius: 8px; }
          .pf-editor-sub { color: #51616f; font-size: 13px; margin: 0 0 14px; }
          .pf-editor-error { display: flex; gap: 8px; align-items: center; color: #c04b40; background: rgba(255,107,92,0.08); border-radius: 10px; padding: 10px 12px; margin: 0 0 12px; font-size: 13px; }
          .pf-editor-group-title { display: flex; align-items: center; gap: 6px; margin: 14px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #0A6E78; font-weight: 700; }
          .pf-editor-companion { display: flex; align-items: center; gap: 10px; background: #fff; border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; }
          .pf-editor-companion input[type="checkbox"] { width: 18px; height: 18px; accent-color: #0A6E78; flex: none; }
          .pf-editor-companion label { flex: 1; display: grid; gap: 1px; cursor: pointer; }
          .pf-editor-companion label strong { font-size: 14px; color: #0F1E2E; }
          .pf-editor-companion label small { color: #51616f; font-size: 12px; }
          .pf-editor-add { display: flex; gap: 8px; align-items: center; background: #fff; border-radius: 12px; padding: 10px 12px; margin-top: 14px; flex-wrap: wrap; }
          .pf-editor-add input { flex: 1 1 120px; border: 1px solid #c9d3db; border-radius: 8px; padding: 8px 10px; font-size: 14px; min-width: 0; }
          .pf-editor-add select { border: 1px solid #c9d3db; border-radius: 8px; padding: 8px 6px; font-size: 13px; background: #fff; }
          .pf-editor-add button { display: inline-flex; align-items: center; gap: 4px; background: #0A6E78; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
          .pf-editor-actions { display: flex; gap: 10px; margin-top: 16px; }
          .pf-editor-actions button { flex: 1; border-radius: 10px; padding: 11px 0; font-size: 14px; font-weight: 600; cursor: pointer; }
          .pf-editor-cancel { background: none; border: 1px solid #c9d3db; color: #51616f; }
          .pf-editor-save { background: #0A6E78; border: none; color: #fff; }
          .pf-editor-save:disabled { opacity: 0.6; cursor: default; }
          .pf-empty { color: #51616f; font-size: 13px; padding: 12px 0; }
        `}</style>
        <div className="pf-editor-head">
          <h2>Who's coming</h2>
          <button onClick={onClose} aria-label="Close editor" type="button">
            <X size={18} />
          </button>
        </div>
        <p className="pf-editor-sub">
          {attachedCount} {attachedCount === 1 ? "companion" : "companions"}{" "}
          attached to this booking.
        </p>
        {error ? (
          <div className="pf-editor-error" role="alert">
            <CircleAlert size={16} />
            <span>{error}</span>
          </div>
        ) : null}
        {loading ? (
          <p className="pf-empty">Loading your companions…</p>
        ) : !companions.length ? (
          <p className="pf-empty">
            No companions in your profile yet — add someone below so this
            booking can be planned for the whole group.
          </p>
        ) : (
          COMPANION_RELATIONSHIPS.map((relationship) =>
            groups[relationship].length ? (
              <div key={relationship}>
                <div className="pf-editor-group-title">
                  <Users size={13} /> {RELATIONSHIP_LABELS[relationship]}
                </div>
                {groups[relationship].map((companion) => (
                  <div className="pf-editor-companion" key={companion.publicId}>
                    <input
                      id={`pf-c-${companion.publicId}`}
                      type="checkbox"
                      checked={attachedIds.includes(companion.publicId)}
                      onChange={() => handleToggle(companion.publicId)}
                      disabled={saving}
                    />
                    <label htmlFor={`pf-c-${companion.publicId}`}>
                      <strong>{companion.name}</strong>
                      <small>
                        {RELATIONSHIP_LABELS[companion.relationship]}
                      </small>
                    </label>
                  </div>
                ))}
              </div>
            ) : null,
          )
        )}
        <div className="pf-editor-add">
          <input
            value={newName}
            maxLength={80}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleAdd();
            }}
            placeholder="Add a companion by name"
            aria-label="New companion name"
          />
          <select
            value={newRelationship}
            onChange={(event) =>
              setNewRelationship(event.target.value as CompanionRelationship)
            }
            aria-label="New companion relationship"
          >
            {COMPANION_RELATIONSHIPS.map((relationship) => (
              <option key={relationship} value={relationship}>
                {RELATIONSHIP_LABELS[relationship]}
              </option>
            ))}
          </select>
          <button onClick={() => void handleAdd()} type="button">
            <Plus size={15} /> Add
          </button>
        </div>
        {formError ? (
          <div className="pf-editor-error" role="alert">
            <CircleAlert size={16} />
            <span>{formError}</span>
          </div>
        ) : null}
        <div className="pf-editor-actions">
          <button
            className="pf-editor-cancel"
            onClick={onClose}
            disabled={saving}
            type="button"
          >
            Cancel
          </button>
          <button
            className="pf-editor-save"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            type="button"
          >
            {saving ? "Saving…" : "Save who's coming"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CompanionsEditor;
