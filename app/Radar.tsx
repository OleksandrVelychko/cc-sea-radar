"use client";

import { useState } from "react";
import { DEMO_VESSEL } from "./config";
import SeaMap from "./SeaMap";
import VesselCard from "./VesselCard";
import { formatSource, toVesselName, type Vessel } from "./vessel";

function createDemoVessels(): Vessel[] {
  return [
    {
      ...DEMO_VESSEL,
      name: toVesselName(DEMO_VESSEL.name),
      timestamp: new Date().toISOString(),
      source: "demo",
    },
  ];
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
