// Єдине місце значень, узгоджених у docs/tasks/SPRINT-01.md.

// Дуврська протока: прямокутник району.
export const AREA_BOUNDS = {
  south: 50.75,
  west: 0.95,
  north: 51.25,
  east: 1.95,
} as const;

export const INITIAL_VIEW = {
  lat: 51.0,
  lon: 1.45,
  zoom: 10,
} as const;

// Одне нерухоме демонстраційне судно (B-03/B-04); маршрути - у B-05.
export const DEMO_VESSEL = {
  id: "demo-1",
  name: "Демо-судно 1",
  lat: 51.02,
  lon: 1.38,
  speedKnots: 12.3,
  courseDeg: 45,
} as const;

// OpenStreetMap Standard.
export const TILE_LAYER = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
} as const;
