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

// Демонстраційні судна: маршрут [lat, lon] усередині AREA_BOUNDS, 8-12 точок;
// судно стартує з першої точки. Рух - у B-06.
export const DEMO_VESSELS = [
  {
    // Смуга на північний схід, біля французького берега.
    id: "demo-1",
    name: "Демо-судно 1",
    speedKnots: 12.3,
    route: [
      [50.8, 1.2],
      [50.83, 1.26],
      [50.86, 1.32],
      [50.89, 1.38],
      [50.92, 1.44],
      [50.95, 1.5],
      [50.98, 1.56],
      [51.01, 1.62],
      [51.04, 1.68],
      [51.07, 1.74],
    ],
  },
  {
    // Смуга на південний захід, біля англійського берега.
    id: "demo-2",
    name: "Демо-судно 2",
    speedKnots: 15,
    route: [
      [51.2, 1.7],
      [51.17, 1.64],
      [51.14, 1.58],
      [51.11, 1.52],
      [51.08, 1.46],
      [51.05, 1.4],
      [51.02, 1.34],
      [50.99, 1.28],
      [50.96, 1.22],
    ],
  },
  {
    // Пором Дувр - Кале.
    id: "demo-3",
    name: "Демо-судно 3",
    speedKnots: 18.7,
    route: [
      [51.1, 1.35],
      [51.085, 1.4],
      [51.07, 1.45],
      [51.055, 1.5],
      [51.045, 1.55],
      [51.035, 1.6],
      [51.025, 1.65],
      [51.015, 1.7],
      [51.005, 1.75],
      [50.995, 1.79],
      [50.985, 1.82],
    ],
  },
] as const;

// OpenStreetMap Standard.
export const TILE_LAYER = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
} as const;
