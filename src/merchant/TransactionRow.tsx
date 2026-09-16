import { LEDGER_STATE_META, toLedgerRowModel } from "./types";
import type { LedgerEntry } from "./types";

/**
 * One settlement ledger row: beach, slot date, state badge and the
 * gross/commission/net money trail. Pure presentational — all formatting
 * and state mapping goes through toLedgerRowModel so it stays unit-testable.
 */
export function TransactionRow({ entry }: { entry: LedgerEntry }) {
  const model = toLedgerRowModel(entry);
  const meta = LEDGER_STATE_META[model.state];
  return (
    <article className="stl-row" data-state={model.state}>
      <div className="stl-row-main">
        <strong>{model.beachName}</strong>
        <small>{model.whenLabel}</small>
      </div>
      <div className="stl-row-money">
        <span className="stl-gross">{model.grossLabel}</span>
        <small>
          fee {model.commissionLabel} · net <strong>{model.netLabel}</strong>
        </small>
      </div>
      <span
        className={`stl-badge stl-badge-${model.stateTone}`}
        title={meta.hint}
      >
        {model.stateLabel}
      </span>
    </article>
  );
}

export default TransactionRow;
