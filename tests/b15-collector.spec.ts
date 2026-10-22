import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  collectSnapshot,
  type Clock,
  type CollectOptions,
  type OpenSource,
  type SourceHandlers,
} from "../app/api/snapshot/collector";

// B-15 (SPRINT-03): приймальні тести збирача, node-проєкт без браузера.
// Без WebSocket і реальних очікувань: тестове джерело подій і переданий
// керований годинник; глобальний Date не підмінюється. Повідомлення -
// синтетичні варіанти зразка. Очікування - літерали із затвердженої таблиці B-15.

const START = "2026-10-23T12:00:00.000Z";
const WINDOW_MS = 15_000;
const LIMIT = 100;

const SAMPLE = JSON.parse(
  readFileSync("data/samples/position-report.sample.json", "utf8"),
);

// Синтетичний PositionReport на основі зразка.
function synthetic(
  mmsi: number,
  time: string,
  lat: number,
  lon: number,
  name: string | null = "СИНТЕТИЧНЕ",
): string {
  const message = structuredClone(SAMPLE);
  message.MetaData.MMSI = mmsi;
  message.MetaData.MMSI_String = mmsi;
  message.MetaData.time_utc = time;
  message.Message.PositionReport.UserID = mmsi;
  message.Message.PositionReport.Latitude = lat;
  message.Message.PositionReport.Longitude = lon;
  if (name === null) delete message.MetaData.ShipName;
  else message.MetaData.ShipName = name;
  return JSON.stringify(message);
}

const A = 200000001;
const T_1200 = "2026-01-01 12:00:00 +0000 UTC";
const T_1201 = "2026-01-01 12:01:00 +0000 UTC";
const P1 = [50.8, 1.0] as const;
const P2 = [51.2, 1.9] as const;
const CONFIRMATION = JSON.stringify({
  MessageType: "SubscriptionConfirmation",
  Message: { CompressionEnabled: true },
});
const PROVIDER_ERROR = JSON.stringify({ error: "синтетична помилка" });

// Керований годинник: час рухає тільки тест.
function controlledClock() {
  let now = Date.parse(START);
  const timers: { at: number; fire: () => void; active: boolean }[] = [];
  const clock: Clock = {
    now: () => new Date(now),
    setTimer(ms, fire) {
      const timer = { at: now + ms, fire, active: true };
      timers.push(timer);
      return () => {
        timer.active = false;
      };
    },
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      for (const timer of timers) {
        if (timer.active && timer.at <= now) {
          timer.active = false;
          timer.fire();
        }
      }
    },
    pendingTimers: () => timers.filter((timer) => timer.active).length,
  };
}

// Тестове джерело: фіксує відкриття, надіслане й закриття; обробники лишаються
// доступними після close(), щоб подавати пізні події.
function testSource() {
  const record = { opened: 0, sent: [] as string[], closed: 0 };
  let handlers: SourceHandlers | undefined;
  const openSource: OpenSource = (_url, h) => {
    record.opened++;
    handlers = h;
    return {
      send: (text) => void record.sent.push(text),
      close: () => void record.closed++,
    };
  };
  const events = () => {
    if (!handlers) throw new Error("джерело не відкрито");
    return handlers;
  };
  return { record, openSource, events };
}

function attempt(overrides: Partial<CollectOptions> = {}) {
  const time = controlledClock();
  const source = testSource();
  let settled = false;
  const result = collectSnapshot({
    apiKey: "synthetic-key",
    bounds: { south: 50.75, west: 0.95, north: 51.25, east: 1.95 },
    windowMs: WINDOW_MS,
    limit: LIMIT,
    openSource: source.openSource,
    clock: time.clock,
    ...overrides,
  });
  void result.then(() => {
    settled = true;
  });
  return {
    time,
    source,
    result,
    // Живе з'єднання: open і підтвердження підписки.
    connect() {
      source.events().onOpen();
      source.events().onMessage(CONFIRMATION);
    },
    send: (frame: string) => source.events().onMessage(frame),
    // Один оберт циклу подій - без очікування реального часу.
    async isSettled() {
      await new Promise((resolve) => setImmediate(resolve));
      return settled;
    },
  };
}

// Ресурси звільнені: з'єднання закрите один раз, відкладених дій немає.
function expectCleanedUp(run: ReturnType<typeof attempt>) {
  expect(run.source.record.closed).toBe(1);
  expect(run.time.pendingTimers()).toBe(0);
}

test("15.1 два однакові повідомлення про A -> один об'єкт A", async () => {
  const run = attempt();
  run.connect();
  run.send(synthetic(A, T_1200, ...P1));
  run.send(synthetic(A, T_1200, ...P1));
  run.time.advance(WINDOW_MS);
  expect(await run.result).toEqual({
    ok: true,
    vessels: [
      { id: "200000001", name: "СИНТЕТИЧНЕ", lat: 50.8, lon: 1.0, speedKnots: 12.4, courseDeg: 86.7, timestamp: "2026-01-01T12:00:00.000Z", source: "aisstream" },
    ],
    collectedAt: new Date("2026-10-23T12:00:15.000Z"),
    truncated: false,
    reason: "window_elapsed",
  });
});

test("15.2 A 12:01 з P2, потім A 12:00 з P1 -> лишається P2", async () => {
  const run = attempt();
  run.connect();
  run.send(synthetic(A, T_1201, ...P2));
  run.send(synthetic(A, T_1200, ...P1));
  run.time.advance(WINDOW_MS);
  const outcome = await run.result;
  expect(outcome.ok && outcome.vessels).toEqual([
    { id: "200000001", name: "СИНТЕТИЧНЕ", lat: 51.2, lon: 1.9, speedKnots: 12.4, courseDeg: 86.7, timestamp: "2026-01-01T12:01:00.000Z", source: "aisstream" },
  ]);
});

test("15.3 A з однаковим часом і різними позиціями -> лишається перша прийнята", async () => {
  const run = attempt();
  run.connect();
  run.send(synthetic(A, T_1200, ...P1));
  run.send(synthetic(A, T_1200, ...P2));
  run.time.advance(WINDOW_MS);
  const outcome = await run.result;
  expect(outcome.ok && outcome.vessels).toEqual([
    { id: "200000001", name: "СИНТЕТИЧНЕ", lat: 50.8, lon: 1.0, speedKnots: 12.4, courseDeg: 86.7, timestamp: "2026-01-01T12:00:00.000Z", source: "aisstream" },
  ]);
});

test("15.4 100 унікальних суден -> limit_reached, truncated; 101-е не прийняте", async () => {
  const run = attempt();
  run.connect();
  for (let mmsi = 200000001; mmsi <= 200000101; mmsi++) run.send(synthetic(mmsi, T_1200, ...P1));
  const outcome = await run.result;
  expect(outcome).toMatchObject({
    ok: true,
    truncated: true,
    reason: "limit_reached",
    collectedAt: new Date("2026-10-23T12:00:00.000Z"),
  });
  const ids = outcome.ok ? outcome.vessels.map((vessel) => vessel.id) : [];
  expect(ids).toHaveLength(100);
  expect(ids).toContain("200000001");
  expect(ids).toContain("200000100");
  expect(ids).not.toContain("200000101");
  expectCleanedUp(run);
});

test("15.5 100 повідомлень про одне судно -> одне судно, збір до кінця вікна", async () => {
  const run = attempt();
  run.connect();
  for (let i = 0; i < 100; i++) run.send(synthetic(A, T_1200, ...P1));
  expect(await run.isSettled()).toBe(false);
  run.time.advance(WINDOW_MS - 1);
  expect(await run.isSettled()).toBe(false);
  run.time.advance(1);
  const outcome = await run.result;
  expect(outcome).toMatchObject({ ok: true, truncated: false, reason: "window_elapsed" });
  expect(outcome.ok && outcome.vessels.map((vessel) => vessel.id)).toEqual(["200000001"]);
});

test("15.6 вікно минуло при живому з'єднанні без повідомлень -> порожній успіх", async () => {
  const run = attempt();
  run.connect();
  run.time.advance(WINDOW_MS);
  expect(await run.result).toEqual({
    ok: true,
    vessels: [],
    collectedAt: new Date("2026-10-23T12:00:15.000Z"),
    truncated: false,
    reason: "window_elapsed",
  });
  expectCleanedUp(run);
});

test.describe("15.7 з'єднання не відкрилося", () => {
  test("15.7a до кінця строку -> connect_failed", async () => {
    const run = attempt();
    run.time.advance(WINDOW_MS);
    expect(await run.result).toEqual({
      ok: false,
      code: "connect_failed",
      attemptedAt: new Date("2026-10-23T12:00:00.000Z"),
    });
    expect(run.source.record.sent).toEqual([]);
    expectCleanedUp(run);
  });

  test("15.7b помилка сокета до open -> connect_failed негайно", async () => {
    const run = attempt();
    run.source.events().onError();
    expect(await run.result).toEqual({
      ok: false,
      code: "connect_failed",
      attemptedAt: new Date("2026-10-23T12:00:00.000Z"),
    });
    expectCleanedUp(run);
  });
});

test("15.8 помилка провайдера після трьох валідних -> provider_error, позиції не повертаються", async () => {
  const run = attempt();
  run.connect();
  for (const mmsi of [200000001, 200000002, 200000003]) run.send(synthetic(mmsi, T_1200, ...P1));
  run.send(PROVIDER_ERROR);
  expect(await run.result).toEqual({
    ok: false,
    code: "provider_error",
    attemptedAt: new Date("2026-10-23T12:00:00.000Z"),
  });
  expectCleanedUp(run);
});

test("15.9 розрив після трьох валідних -> disconnected, позиції не повертаються", async () => {
  const run = attempt();
  run.connect();
  for (const mmsi of [200000001, 200000002, 200000003]) run.send(synthetic(mmsi, T_1200, ...P1));
  run.source.events().onClose();
  expect(await run.result).toEqual({
    ok: false,
    code: "disconnected",
    attemptedAt: new Date("2026-10-23T12:00:00.000Z"),
  });
  expectCleanedUp(run);
});

test("15.10 помилка провайдера після завершення за лімітом -> лишається успіх, другого завершення немає", async () => {
  const run = attempt();
  run.connect();
  for (let mmsi = 200000001; mmsi <= 200000100; mmsi++) run.send(synthetic(mmsi, T_1200, ...P1));
  run.send(PROVIDER_ERROR);
  run.source.events().onError();
  run.source.events().onClose();
  run.time.advance(WINDOW_MS);
  const outcome = await run.result;
  expect(outcome).toMatchObject({ ok: true, truncated: true, reason: "limit_reached" });
  expect(outcome.ok && outcome.vessels).toHaveLength(100);
  expectCleanedUp(run);
});

test("15.11 скасування до кінця вікна -> результат не завершується, з'єднання закрите, таймери очищені", async () => {
  const controller = new AbortController();
  const run = attempt({ signal: controller.signal });
  run.connect();
  run.send(synthetic(A, T_1200, ...P1));
  controller.abort();
  expectCleanedUp(run);
  // Пізні події й кінець вікна після скасування нічого не змінюють.
  run.send(synthetic(200000002, T_1200, ...P2));
  run.send(PROVIDER_ERROR);
  run.source.events().onClose();
  run.time.advance(WINDOW_MS);
  expect(await run.isSettled()).toBe(false);
  expectCleanedUp(run);
});

test("15.12 друге повідомлення про A без назви -> name null (об'єкт замінений цілком)", async () => {
  const run = attempt();
  run.connect();
  run.send(synthetic(A, T_1200, ...P1, "FIRST"));
  run.send(synthetic(A, "2026-01-01 12:00:01 +0000 UTC", ...P2, null));
  run.time.advance(WINDOW_MS);
  const outcome = await run.result;
  expect(outcome.ok && outcome.vessels).toEqual([
    { id: "200000001", name: null, lat: 51.2, lon: 1.9, speedKnots: 12.4, courseDeg: 86.7, timestamp: "2026-01-01T12:00:01.000Z", source: "aisstream" },
  ]);
});

test("15.13 collectedAt дорівнює часу переданого годинника в момент завершення", async () => {
  const run = attempt({ limit: 2 });
  run.connect();
  run.send(synthetic(200000001, T_1200, ...P1));
  run.time.advance(3_000);
  run.send(synthetic(200000002, T_1200, ...P2));
  expect(await run.result).toMatchObject({
    ok: true,
    reason: "limit_reached",
    collectedAt: new Date("2026-10-23T12:00:03.000Z"),
  });
});

test.describe("15.14 після будь-якого результату немає відкритих з'єднань і відкладених дій", () => {
  const branches: [string, (run: ReturnType<typeof attempt>) => void][] = [
    ["вікно з позицією", (run) => { run.connect(); run.send(synthetic(A, T_1200, ...P1)); run.time.advance(WINDOW_MS); }],
    ["порожній успіх", (run) => { run.connect(); run.time.advance(WINDOW_MS); }],
    ["ліміт", (run) => { run.connect(); for (let m = 200000001; m <= 200000100; m++) run.send(synthetic(m, T_1200, ...P1)); }],
    ["connect_failed за строком", (run) => run.time.advance(WINDOW_MS)],
    ["connect_failed помилкою до open", (run) => run.source.events().onError()],
    ["provider_error", (run) => { run.connect(); run.send(PROVIDER_ERROR); }],
    ["disconnected", (run) => { run.connect(); run.source.events().onClose(); }],
  ];
  for (const [name, drive] of branches) {
    test(name, async () => {
      const run = attempt();
      drive(run);
      await run.result;
      expectCleanedUp(run);
      expect(run.source.record.opened).toBe(1);
    });
  }

  test("скасування", async () => {
    const controller = new AbortController();
    const run = attempt({ signal: controller.signal });
    run.connect();
    controller.abort();
    expect(await run.isSettled()).toBe(false);
    expectCleanedUp(run);
    expect(run.source.record.opened).toBe(1);
  });
});
