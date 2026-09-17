import type { Beach } from "../types";
import type { HeatCluster, MapPoint } from "./types";
import { clusterFocusBeach, crowdOpacity, heatRadius } from "./pulseHeat";

/**
 * Crowd-density heat overlay for the beach map. Presentational: it takes
 * already-binned clusters and projected points and renders one translucent
 * disc per cluster with live crowd data. Tapping a disc resolves the
 * cluster's focus beach (highest live crowd) and emits it upward — the
 * shell's handler performs the actual beach-detail navigation.
 *
 * Clusters without a finite crowd value render no disc: "no heat data" is
 * shown as absence, not as a fabricated zero blob.
 */
export function HeatLayer({
  clusters,
  points,
  onClusterSelect,
}: {
  clusters: HeatCluster[];
  points: MapPoint[];
  /** Receives the cluster's focus beach on tap. */
  onClusterSelect?: (beach: Beach) => void;
}) {
  return (
    <g data-testid="heat-layer">
      {clusters
        .filter((cluster) => cluster.avgCrowd != null)
        .map((cluster) => {
          const focus = clusterFocusBeach(cluster, points);
          const tappable = focus != null && onClusterSelect != null;
          return (
            <circle
              key={cluster.key}
              data-testid="heat-cluster"
              data-focus-beach={cluster.focusBeachId}
              cx={cluster.x}
              cy={cluster.y}
              r={heatRadius(cluster.count)}
              fill="#FF6B5C"
              fillOpacity={crowdOpacity(cluster.avgCrowd as number)}
              style={{ cursor: tappable ? "pointer" : "default" }}
              onClick={
                tappable && focus ? () => onClusterSelect?.(focus) : undefined
              }
            />
          );
        })}
    </g>
  );
}
