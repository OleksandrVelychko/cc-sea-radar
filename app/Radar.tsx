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

// Два незалежні стани (SPRINT-03b, частина A): показаний набір із підписом
// джерела і результат останньої спроби окремим рядком.

type Snapshot = {
  vessels: Vessel[];
  collectedAt: string;
  windowSeconds: number;
  truncated: boolean;
};

// Показаний набір: після завантаження сторінки - демонстрація; замінюється
// тільки непорожнім успіхом.
type Shown = { kind: "demo" } | ({ kind: "snapshot" } & Snapshot);

// Результат останньої спроби; null - натискань ще не було.
type Attempt =
  | { kind: "loading" }
  | { kind: "success"; collectedAt: string; count: number }
  | { kind: "empty"; collectedAt: string }
  | { kind: "error"; attemptedAt: string; message: string }
  | { kind: "noResponse" };

type Outcome =
  | ({ kind: "snapshot" } & Snapshot)
  | { kind: "error"; attemptedAt: string; message: string }
  | { kind: "noResponse" };

const HINT = "Після оновлення сторінки знову показуються демонстраційні дані";

function isTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

// GET /api/snapshot -> результат спроби. Часи - тільки з тіла відповіді.
// Немає відповіді, нерозбірне тіло або тіло без потрібних полів - noResponse.
async function fetchSnapshot(signal: AbortSignal): Promise<Outcome> {
  try {
    const response = await fetch("/api/snapshot", { cache: "no-store", signal });
    const body: unknown = await response.json();
    const data = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    if (
      data.ok === true &&
      Array.isArray(data.vessels) &&
      isTime(data.collectedAt) &&
      typeof data.windowSeconds === "number" &&
      typeof data.truncated === "boolean"
    ) {
      return {
        kind: "snapshot",
        vessels: data.vessels as Vessel[],
        collectedAt: data.collectedAt,
        windowSeconds: data.windowSeconds,
        truncated: data.truncated,
      };
    }
    const error = data.error as { message?: unknown } | undefined;
    if (data.ok === false && isTime(data.attemptedAt) && typeof error?.message === "string") {
      return { kind: "error", attemptedAt: data.attemptedAt, message: error.message };
    }
  } catch (cause) {
    if (signal.aborted) throw cause;
  }
  return { kind: "noResponse" };
}

// Підпис джерела: що саме на карті й коли воно отримане.
function caption(shown: Shown): string {
  if (shown.kind === "demo") return formatSource("demo");
  const text =
    `AISStream · знімок за ${shown.windowSeconds} с · отримано ${formatTime(shown.collectedAt)}` +
    ` · суден: ${shown.vessels.length} · вибірка неповна`;
  return shown.truncated ? `${text} · зупинено на ліміті ${SNAPSHOT_VESSEL_LIMIT}` : text;
}

// Рядок результату останньої спроби.
function attemptLine(attempt: Attempt): string {
  switch (attempt.kind) {
    case "loading":
      return "Завантаження…";
    case "success":
      return `Спроба ${formatTime(attempt.collectedAt)}: отримано суден: ${attempt.count}`;
    case "empty":
      return `Спроба ${formatTime(attempt.collectedAt)}: за час збору позицій не отримано`;
    case "error":
      return `Спроба ${formatTime(attempt.attemptedAt)}: не вдалося отримати дані: ${attempt.message}`;
    case "noResponse":
      return "Спроба: не вдалося отримати дані: Немає відповіді сервера";
  }
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
  const [shown, setShown] = useState<Shown>({ kind: "demo" });
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [demo, setDemo] = useState(createDemoState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Лічильник повернень карти до початкового виду: тільки перший непорожній успіх.
  const [viewResetKey, setViewResetKey] = useState(0);
  const hadNonEmptySnapshot = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const isDemo = shown.kind === "demo";
  const loading = attempt?.kind === "loading";

  // Запит, що ще йде, скасовується при виході зі сторінки.
  useEffect(() => () => requestRef.current?.abort(), []);

  async function loadSnapshot() {
    if (loading) return;
    // Під час запиту набір, підпис, вибір і картка лишаються; демо рухається.
    setAttempt({ kind: "loading" });
    const controller = new AbortController();
    requestRef.current = controller;
    let outcome: Outcome;
    try {
      outcome = await fetchSnapshot(controller.signal);
    } catch {
      return; // Сторінку залишено - стан більше не оновлюється.
    }
    if (outcome.kind !== "snapshot") {
      setAttempt(outcome);
      return;
    }
    const { vessels } = outcome;
    if (vessels.length === 0) {
      // Порожня відповідь змінює тільки результат спроби.
      setAttempt({ kind: "empty", collectedAt: outcome.collectedAt });
      return;
    }
    // Непорожній успіх: набір замінюється цілком (без злиття), в одному оновленні
    // з результатом спроби й вибором; демотаймер зупиняється (ефект нижче).
    if (!hadNonEmptySnapshot.current) {
      hadNonEmptySnapshot.current = true;
      setViewResetKey((key) => key + 1);
    }
    setShown(outcome);
    setAttempt({ kind: "success", collectedAt: outcome.collectedAt, count: vessels.length });
    setSelectedId((id) => (vessels.some((vessel) => vessel.id === id) ? id : null));
  }

  // Один таймер на всі демонстраційні судна, поки показана демонстрація.
  // Ефект перезапускається при hot reload і подвійному монтуванні Strict Mode -
  // cleanup прибирає попередній таймер; заміна набору знімком його зупиняє.
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

  // На карті - показаний набір: демонстрація або останній непорожній знімок.
  const vessels = useMemo(
    () => (shown.kind === "demo" ? demo.map((state) => state.vessel) : shown.vessels),
    [shown, demo],
  );
  const selected = vessels.find((vessel) => vessel.id === selectedId);

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
          disabled={loading}
        >
          Завантажити справжні позиції
        </button>
        <p className="panel__source">{caption(shown)}</p>
        {attempt && <p className="panel__attempt">{attemptLine(attempt)}</p>}
        <p className="panel__hint">{HINT}</p>
        {selected && <VesselCard vessel={selected} />}
      </aside>
    </div>
  );
}
