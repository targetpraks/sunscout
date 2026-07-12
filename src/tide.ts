import type { TidePoint } from "./types";

export function tideExtrema(
  points: TidePoint[],
): Array<{ time: string; level: number; kind: "low" | "high" }> {
  if (points.length < 2) return points.map((p) => ({ ...p, kind: "low" }));
  const extrema: Array<{ time: string; level: number; kind: "low" | "high" }> =
    [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const left = prev?.level ?? curr.level;
    const right = next?.level ?? curr.level;
    if (
      curr.level <= left &&
      curr.level <= right &&
      curr.level < Math.max(left, right)
    ) {
      extrema.push({ ...curr, kind: "low" });
    } else if (
      curr.level >= left &&
      curr.level >= right &&
      curr.level > Math.min(left, right)
    ) {
      extrema.push({ ...curr, kind: "high" });
    }
  }
  if (!extrema.length) {
    extrema.push({ ...points[0], kind: "low" });
    extrema.push({ ...points[points.length - 1], kind: "high" });
  }
  return extrema;
}

export function daytimeLowest(points: TidePoint[]): TidePoint | null {
  const daytime = points.filter((p) => {
    const hour = Number(p.time.split(":")[0]);
    return hour >= 10 && hour <= 19;
  });
  if (!daytime.length) return null;
  return daytime.reduce(
    (min, p) => (p.level < min.level ? p : min),
    daytime[0],
  );
}
