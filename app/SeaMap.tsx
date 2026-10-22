"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState } from "react";
import { INITIAL_VIEW, TILE_LAYER } from "./config";
import type { Vessel } from "./vessel";

type Props = {
  vessels: Vessel[];
  onSelect: (id: string) => void;
  // Зміна значення (крім 0) повертає карту до початкового виду.
  viewResetKey: number;
};

const ICON_SIZE = 24;

// Значок будується як DOM-елемент: id потрапляє тільки в атрибут, не в HTML.
function createIconElement(vessel: Vessel): HTMLElement {
  const element = document.createElement("div");
  element.className = "vessel-icon";
  element.setAttribute("data-vessel-id", vessel.id);
  if (vessel.courseDeg === null) {
    element.setAttribute("data-icon", "neutral");
  } else {
    element.setAttribute("data-icon", "course");
    element.style.transform = `rotate(${vessel.courseDeg}deg)`;
  }
  return element;
}

export default function SeaMap({ vessels, onSelect, viewResetKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markersRef = useRef(new Map<string, Leaflet.Marker>());
  const onSelectRef = useRef(onSelect);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const markers = markersRef.current;
    let map: Leaflet.Map | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let cancelled = false;

    // Leaflet звертається до window під час імпорту, тому модуль
    // завантажується тільки в браузері, після монтування.
    import("leaflet").then((L) => {
      if (cancelled) return;

      map = L.map(container).setView(
        [INITIAL_VIEW.lat, INITIAL_VIEW.lon],
        INITIAL_VIEW.zoom,
      );
      L.tileLayer(TILE_LAYER.url, {
        attribution: TILE_LAYER.attribution,
        maxZoom: TILE_LAYER.maxZoom,
      }).addTo(map);

      resizeObserver = new ResizeObserver(() => map?.invalidateSize());
      resizeObserver.observe(container);

      leafletRef.current = L;
      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      map?.remove();
      markers.clear();
      leafletRef.current = null;
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Маркери синхронізуються зі списком суден; клік по карті вибір не змінює.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!mapReady || !L || !map) return;

    const markers = markersRef.current;
    const ids = new Set(vessels.map((vessel) => vessel.id));

    for (const [id, marker] of markers) {
      if (!ids.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    for (const vessel of vessels) {
      const icon = L.divIcon({
        className: "vessel-marker",
        html: createIconElement(vessel),
        iconSize: [ICON_SIZE, ICON_SIZE],
      });
      const existing = markers.get(vessel.id);
      if (existing) {
        existing.setLatLng([vessel.lat, vessel.lon]).setIcon(icon);
      } else {
        const marker = L.marker([vessel.lat, vessel.lon], { icon })
          .on("click", () => onSelectRef.current(vessel.id))
          .addTo(map);
        markers.set(vessel.id, marker);
      }
    }
  }, [mapReady, vessels]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || viewResetKey === 0) return;
    map.setView([INITIAL_VIEW.lat, INITIAL_VIEW.lon], INITIAL_VIEW.zoom);
  }, [mapReady, viewResetKey]);

  return <div ref={containerRef} className="sea-map" />;
}
