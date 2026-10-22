"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEMO_TICK_MS, DEMO_VESSELS, SNAPSHOT_VESSEL_LIMIT } from "./config";
import SeaMap from "./SeaMap";
import VesselCard from "./VesselCard";
import {
  formatSource,
  formatTime,
  initialBearing,
  toVesselName,
  type Vessel,
} from "./vessel";

// Результат останньої спроби (SPRINT-02, частина A). empty - loaded без суден.
type View =
  | { kind: "demo" }
  | { kind: "loading" }
  | {
      kind: "loaded";
      vessels: Vessel[];
      collectedAt: string;
      windowSeconds: number;
      truncated: boolean;
    }
  | { kind: "error"; message: string };

// Відповідь, що не відповідає контракту endpoint, - як внутрішня помилка.
const INTERNAL_ERROR_MESSAGE = "Внутрішня помилка сервера";

// GET /api/snapshot -> стан інтерфейсу. Часи - тільки з відповіді сервера.
async function fetchSnapshot(signal: AbortSignal): Promise<View> {
  try {
    const response = await fetch("/api/snapshot", { cache: "no-store", signal });
    const body: unknown = await response.json();
    const data = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    if (
      data.ok === true &&
      Array.isArray(data.vessels) &&
      typeof data.collectedAt === "string" &&
      typeof data.windowSeconds === "number" &&
      typeof data.truncated === "boolean"
    ) {
      return {
        kind: "loaded",
        vessels: data.vessels as Vessel[],
        collectedAt: data.collectedAt,
        windowSeconds: data.windowSeconds,
        truncated: data.truncated,
      };
    }
    const error = data.error as { message?: unknown } | undefined;
    if (data.ok === false && typeof error?.message === "string") {
      return { kind: "error", message: error.message };
    }
  } catch (cause) {
    if (signal.aborted) throw cause;
  }
  return { kind: "error", message: INTERNAL_ERROR_MESSAGE };
}

// Підпис поруч із картою: що ми бачимо.
function caption(view: View): string {
  switch (view.kind) {
    case "demo":
      return formatSource("demo");
    case "loading":
      return "Завантаження…";
    case "error":
      return "Даних на карті немає";
    case "loaded": {
      const text =
        `AISStream · знімок за ${view.windowSeconds} с · отримано ${formatTime(view.collectedAt)}` +
        ` · суден: ${view.vessels.length} · вибірка неповна`;
      return view.truncated ? `${text} · зупинено на ліміті ${SNAPSHOT_VESSEL_LIMIT}` : text;
    }
  }
}

function message(view: View): string | null {
  if (view.kind === "error") return `Не вдалося отримати дані: ${view.message}`;
  if (view.kind === "loaded" && view.vessels.length === 0) {
    return "За час збору позицій не отримано";
  }
  return null;
}

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
  const [view, setView] = useState<View>({ kind: "demo" });
  const [demo, setDemo] = useState(createDemoState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Лічильник повернень карти до початкового виду: тільки перший непорожній успіх.
  const [viewResetKey, setViewResetKey] = useState(0);
  const hadNonEmptySnapshot = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const isDemo = view.kind === "demo";

  // Запит, що ще йде, скасовується при виході зі сторінки.
  useEffect(() => () => requestRef.current?.abort(), []);

  async function loadSnapshot() {
    if (view.kind === "loading") return;
    // loading: демотаймер зупиняється (ефект нижче), судна, вибір і картка прибрані.
    setView({ kind: "loading" });
    setSelectedId(null);
    const controller = new AbortController();
    requestRef.current = controller;
    let next: View;
    try {
      next = await fetchSnapshot(controller.signal);
    } catch {
      return; // Сторінку залишено - стан більше не оновлюється.
    }
    if (next.kind === "loaded" && next.vessels.length > 0 && !hadNonEmptySnapshot.current) {
      hadNonEmptySnapshot.current = true;
      setViewResetKey((key) => key + 1);
    }
    setView(next);
  }

  // Один таймер на всі демонстраційні судна, тільки в стані idle-demo.
  // Ефект перезапускається при hot reload і подвійному монтуванні Strict Mode -
  // cleanup прибирає попередній таймер; вихід з demo його зупиняє.
  useEffect(() => {
    if (!isDemo) return;
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
  }, [isDemo]);

  // На карті - тільки набір поточного стану: демо, знімок або нічого.
  const vessels = useMemo(() => {
    if (view.kind === "demo") return demo.map((state) => state.vessel);
    if (view.kind === "loaded") return view.vessels;
    return [];
  }, [view, demo]);
  const selected = vessels.find((vessel) => vessel.id === selectedId);
  const note = message(view);

  return (
    <div className="radar">
      <SeaMap
        vessels={vessels}
        onSelect={setSelectedId}
        viewResetKey={viewResetKey}
      />
      <aside className="panel">
        <button
          type="button"
          className="panel__load"
          onClick={loadSnapshot}
          disabled={view.kind === "loading"}
        >
          Завантажити справжні позиції
        </button>
        <p className="panel__source">{caption(view)}</p>
        {note && <p className="panel__message">{note}</p>}
        {selected && <VesselCard vessel={selected} />}
      </aside>
    </div>
  );
}
