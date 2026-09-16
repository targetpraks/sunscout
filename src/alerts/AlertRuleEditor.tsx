import { Bell, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createAlertRule, deleteAlertRule, fetchAlertRules } from "./api";
import {
  ALERT_RULE_KINDS,
  describeRule,
  type AlertRule,
  type AlertRuleKind,
  type AlertRulePriority,
  type CreateAlertRuleInput,
  type SavedBeach,
} from "./types";

const KIND_LABELS: Record<AlertRuleKind, string> = {
  wind_below: "Wind drops below",
  golden_hour_within: "Golden hour starts within",
  hazard_clear: "A hazard clears",
};

const PRIORITY_LABELS: Record<AlertRulePriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

const inputStyle = {
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid var(--sand, #d8cfc2)",
  fontSize: 13,
} as const;

/**
 * Personal alert-rule editor ("tell me before I go"). Self-sufficient and
 * user-scoped: fetches the user's rules and saved beaches from
 * GET /api/conditions/alert-rules, so it mounts with no props and needs
 * no changes to App.tsx, routes.ts or TidePanel.
 *
 * Honest states: a form error (e.g. duplicate rule) is shown inline, the
 * empty state invites the first rule, the busy state disables the submit,
 * and a fetch failure explains itself instead of rendering a broken form.
 * The initial render is inert (the fetch lives in an effect), which keeps
 * the existing DayScoreCard static-markup tests deterministic.
 */
export function AlertRuleEditor() {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [beaches, setBeaches] = useState<SavedBeach[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<AlertRuleKind>("wind_below");
  const [thresholdKmh, setThresholdKmh] = useState(15);
  const [offsetMinutes, setOffsetMinutes] = useState(30);
  const [priority, setPriority] = useState<AlertRulePriority>("normal");

  useEffect(() => {
    if (!open || rules !== null || loadError) return;
    let cancelled = false;
    fetchAlertRules()
      .then((payload) => {
        if (cancelled) return;
        setRules(payload.rules);
        setBeaches(payload.savedBeaches);
        setSlug((current) => current || payload.savedBeaches[0]?.slug || "");
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load your alert rules.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, rules, loadError]);

  const refresh = async () => {
    const payload = await fetchAlertRules();
    setRules(payload.rules);
    setBeaches(payload.savedBeaches);
  };

  const submit = async () => {
    if (!slug) return;
    setBusy(true);
    setFormError(null);
    const input: CreateAlertRuleInput =
      kind === "wind_below"
        ? { slug, kind, config: { thresholdKmh }, priority }
        : kind === "golden_hour_within"
          ? { slug, kind, config: { offsetMinutes }, priority }
          : { slug, kind, config: {}, priority };
    try {
      await createAlertRule(input);
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      setFormError(
        message === "rule_exists"
          ? "You already have this rule for that beach."
          : message === "beach_not_found"
            ? "That beach is no longer available."
            : "Could not save the rule. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ruleId: number) => {
    setBusy(true);
    setFormError(null);
    try {
      await deleteAlertRule(ruleId);
      await refresh();
    } catch {
      setFormError("Could not delete the rule. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail-section" aria-label="Beach alerts">
      <button
        className="action-row"
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          fontWeight: 600,
          color: "var(--teal)",
        }}
        onClick={() => setOpen((current) => !current)}
      >
        <Bell />
        {open ? "Hide beach alerts" : "Beach alerts"}
      </button>

      {open ? (
        loadError ? (
          <p className="chart-note" role="alert">
            {loadError}
          </p>
        ) : rules === null ? (
          <p className="chart-note" role="status">
            Loading your alert rules…
          </p>
        ) : (
          <>
            {rules.length ? (
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
                {rules.map((rule) => (
                  <li
                    key={rule.id}
                    className="forecast-bar"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      fontSize: 13,
                    }}
                  >
                    <span>
                      <strong>{rule.beachName}</strong>
                      <small style={{ display: "block" }}>
                        {describeRule(rule)} · {PRIORITY_LABELS[rule.priority]}
                      </small>
                    </span>
                    <button
                      type="button"
                      aria-label={`Delete rule: ${rule.beachName} ${describeRule(rule)}`}
                      disabled={busy}
                      style={{
                        all: "unset",
                        cursor: "pointer",
                        color: "var(--coral)",
                      }}
                      onClick={() => remove(rule.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="chart-note">
                No alert rules yet — tell SunScout what to watch for.
              </p>
            )}

            {beaches.length ? (
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  fontSize: 13,
                  marginTop: 8,
                }}
              >
                <select
                  aria-label="Beach to watch"
                  style={inputStyle}
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                >
                  {beaches.map((beach) => (
                    <option key={beach.slug} value={beach.slug}>
                      {beach.name}
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    aria-label="Alert type"
                    style={inputStyle}
                    value={kind}
                    onChange={(event) =>
                      setKind(event.target.value as AlertRuleKind)
                    }
                  >
                    {ALERT_RULE_KINDS.map((ruleKind) => (
                      <option key={ruleKind} value={ruleKind}>
                        {KIND_LABELS[ruleKind]}
                      </option>
                    ))}
                  </select>
                  {kind === "wind_below" ? (
                    <label
                      style={{ display: "flex", gap: 4, alignItems: "center" }}
                    >
                      <input
                        type="number"
                        min={0}
                        max={200}
                        aria-label="Wind threshold km/h"
                        style={{ ...inputStyle, width: 72 }}
                        value={thresholdKmh}
                        onChange={(event) =>
                          setThresholdKmh(Number(event.target.value))
                        }
                      />
                      km/h
                    </label>
                  ) : null}
                  {kind === "golden_hour_within" ? (
                    <label
                      style={{ display: "flex", gap: 4, alignItems: "center" }}
                    >
                      <input
                        type="number"
                        min={5}
                        max={240}
                        aria-label="Golden hour offset minutes"
                        style={{ ...inputStyle, width: 72 }}
                        value={offsetMinutes}
                        onChange={(event) =>
                          setOffsetMinutes(Number(event.target.value))
                        }
                      />
                      min
                    </label>
                  ) : null}
                  <select
                    aria-label="Priority"
                    style={inputStyle}
                    value={priority}
                    onChange={(event) =>
                      setPriority(event.target.value as AlertRulePriority)
                    }
                  >
                    {(Object.keys(PRIORITY_LABELS) as AlertRulePriority[]).map(
                      (option) => (
                        <option key={option} value={option}>
                          {PRIORITY_LABELS[option]}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={busy || !slug}
                  style={{
                    all: "unset",
                    cursor: busy || !slug ? "default" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--teal)",
                    opacity: busy || !slug ? 0.5 : 1,
                  }}
                  onClick={submit}
                >
                  <Plus size={15} />
                  {busy ? "Saving…" : "Add alert rule"}
                </button>
                {formError ? (
                  <p className="form-error" role="alert">
                    {formError}
                  </p>
                ) : null}
                <p className="chart-note">
                  Alerts appear here and in your notifications the moment the
                  condition refresh matches your rule.
                </p>
              </div>
            ) : (
              <p className="chart-note">
                Save a beach first — rules watch your saved beaches.
              </p>
            )}
          </>
        )
      ) : null}
    </div>
  );
}
