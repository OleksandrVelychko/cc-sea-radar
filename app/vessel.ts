// Структура судна й формати картки з docs/tasks/SPRINT-01.md, частина A.

export type VesselSource = "demo" | "aisstream";

export type Vessel = {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  speedKnots: number | null;
  // Курс руху (не напрямок носа), у [0, 360).
  courseDeg: number | null;
  // ISO 8601 із зоною.
  timestamp: string;
  source: VesselSource;
};

export const NO_DATA = "Немає даних";

const SOURCE_LABELS: Record<VesselSource, string> = {
  demo: "Демонстраційні дані",
  aisstream: "AISStream",
};

// Порожній рядок - не назва.
export function toVesselName(raw: string | null): string | null {
  return raw === null || raw === "" ? null : raw;
}

// Початковий азимут відрізка по великому колу, у [0, 360).
export function initialBearing(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): number {
  const rad = Math.PI / 180;
  const phi1 = fromLat * rad;
  const phi2 = toLat * rad;
  const deltaLambda = (toLon - fromLon) * rad;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return ((Math.atan2(y, x) / rad) % 360 + 360) % 360;
}

export function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// 12.34 -> "12.3 kn", 12 -> "12 kn", 0 -> "0 kn"; null -> "Немає даних".
export function formatSpeed(speedKnots: number | null): string {
  if (speedKnots === null) return NO_DATA;
  return `${String(Math.round(speedKnots * 10) / 10)} kn`;
}

// 359.6 -> "0°"; null -> "Немає даних".
export function formatCourse(courseDeg: number | null): string {
  if (courseDeg === null) return NO_DATA;
  return `${Math.round(courseDeg) % 360}°`;
}

// "2026-10-22T12:00:00+03:00" -> "09:00:00 UTC".
export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return NO_DATA;
  return `${date.toISOString().slice(11, 19)} UTC`;
}

export function formatSource(source: VesselSource): string {
  return SOURCE_LABELS[source];
}
