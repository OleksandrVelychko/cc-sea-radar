"use client";

import { useEffect, useMemo, useState } from "react";
import { DEMO_TICK_MS, DEMO_VESSELS } from "./config";
import SeaMap from "./SeaMap";
import VesselCard from "./VesselCard";
import {
  formatSource,
  initialBearing,
  toVesselName,
  type Vessel,
} from "./vessel";

type DemoRoute = (typeof DEMO_VESSELS)[number]["route"];

// Судно разом з індексом поточної точки його маршруту.
type DemoState = {
  vessel: Vessel;
  route: DemoRoute;
  pointIndex: number;
};

// Стан на старті: перша точка маршруту, курс - до другої точки.
function createDemoState(): DemoState[] {
  const timestamp = new Date().toISOString();
  return DEMO_VESSELS.map(({ id, name, speedKnots, route }) => {
    const [[lat, lon], [nextLat, nextLon]] = route;
    return {
      vessel: {
        id,
        name: toVesselName(name),
        lat,
        lon,
        speedKnots,
        courseDeg: initialBearing(lat, lon, nextLat, nextLon),
        timestamp,
        source: "demo",
      },
      route,
      pointIndex: 0,
    };
  });
}

// Крок на наступну точку; курс - від попередньої точки до поточної.
// На останній точці швидкість стає 0, далі судно не змінюється.
function advance(state: DemoState, timestamp: string): DemoState {
  const { vessel, route, pointIndex } = state;
  const lastIndex = route.length - 1;
  if (pointIndex >= lastIndex) return state;

  const [prevLat, prevLon] = route[pointIndex];
  const nextIndex = pointIndex + 1;
  const [lat, lon] = route[nextIndex];
  return {
    vessel: {
      ...vessel,
      lat,
      lon,
      speedKnots: nextIndex === lastIndex ? 0 : vessel.speedKnots,
      courseDeg: initialBearing(prevLat, prevLon, lat, lon),
      timestamp,
    },
    route,
    pointIndex: nextIndex,
  };
}

// Єдине місце стану суден і вибору: карта й картка читають звідси.
export default function Radar() {
  const [demo, setDemo] = useState(createDemoState);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Один таймер на всі судна. Ефект перезапускається при hot reload і
  // подвійному монтуванні Strict Mode - cleanup прибирає попередній таймер.
  useEffect(() => {
    // Час на старті - момент запуску таймера (тільки для суден, що ще не рушили).
    const startedAt = new Date().toISOString();
    setDemo((prev) =>
      prev.map((state) =>
        state.pointIndex === 0
          ? { ...state, vessel: { ...state.vessel, timestamp: startedAt } }
          : state,
      ),
    );

    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      if (process.env.NODE_ENV === "development") {
        console.log(`[demo] тік ${tick}`);
      }
      // Час обчислюється поза updater: Strict Mode може викликати його двічі.
      const timestamp = new Date().toISOString();
      setDemo((prev) => {
        const next = prev.map((state) => advance(state, timestamp));
        return next.every((state, i) => state === prev[i]) ? prev : next;
      });
    }, DEMO_TICK_MS);

    return () => clearInterval(timer);
  }, []);

  const vessels = useMemo(() => demo.map((state) => state.vessel), [demo]);
  const selected = vessels.find((vessel) => vessel.id === selectedId);

  return (
    <div className="radar">
      <SeaMap vessels={vessels} onSelect={setSelectedId} />
      <aside className="panel">
        <p className="panel__source">{formatSource("demo")}</p>
        {selected && <VesselCard vessel={selected} />}
      </aside>
    </div>
  );
}
