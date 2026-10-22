"use client";

import { useState } from "react";
import { DEMO_VESSELS } from "./config";
import SeaMap from "./SeaMap";
import VesselCard from "./VesselCard";
import {
  formatSource,
  initialBearing,
  toVesselName,
  type Vessel,
} from "./vessel";

// Стан на старті: перша точка маршруту, курс - до другої точки.
function createDemoVessels(): Vessel[] {
  const timestamp = new Date().toISOString();
  return DEMO_VESSELS.map(({ id, name, speedKnots, route }) => {
    const [[lat, lon], [nextLat, nextLon]] = route;
    return {
      id,
      name: toVesselName(name),
      lat,
      lon,
      speedKnots,
      courseDeg: initialBearing(lat, lon, nextLat, nextLon),
      timestamp,
      source: "demo",
    };
  });
}

// Єдине місце стану суден і вибору: карта й картка читають звідси.
export default function Radar() {
  const [vessels] = useState(createDemoVessels);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
