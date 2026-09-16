import { Check, Plus } from "lucide-react";
import type { PlannedBeach } from "./types";

/**
 * One beach row in the distance-sorted planner list: image, name, decision,
 * and the walk/drive distance + time pair from the haversine model. Beaches
 * without coordinates degrade to the catalog's static drive/distance text
 * rather than showing blank numbers.
 */
export function BeachDistanceRow({
  planned,
  selected,
  onOpen,
  onToggle,
}: {
  planned: PlannedBeach;
  selected: boolean;
  onOpen: (beachId: string) => void;
  onToggle: (beachId: string) => void;
}) {
  const { beach, travel } = planned;
  return (
    <article className="result-row">
      <button className="result-main" onClick={() => onOpen(beach.id)}>
        <img src={beach.image} alt="" />
        <span className="result-copy">
          <span className="result-topline">
            <strong>{beach.name}</strong>
          </span>
          <span>{beach.decision}</span>
          <small className="result-meta">
            {travel
              ? `Walk ${travel.walkMinutes} min · ${travel.walkDistanceKm} km — Drive ${travel.driveMinutes} min · ${travel.driveDistanceKm} km`
              : `${beach.drive} · ${beach.distance} · straight-line distance unavailable`}
          </small>
        </span>
      </button>
      <button
        className={`result-save ${selected ? "saved" : ""}`}
        onClick={() => onToggle(beach.id)}
        aria-label={
          selected
            ? `Remove ${beach.name} from trip`
            : `Add ${beach.name} to trip`
        }
      >
        {selected ? <Check /> : <Plus />}
      </button>
    </article>
  );
}
