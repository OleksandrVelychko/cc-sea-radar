import { expect, test } from "@playwright/test";
import {
  AISSTREAM_URL,
  readFirstPositionReport,
  type Clock,
  type OpenSource,
  type ReaderOptions,
  type SourceHandlers,
} from "../app/api/snapshot/reader";

// Тести reader без мережі й браузера: джерело подій і годинник - підставні.
const KEY = "test-key-not-real";
const BOUNDS = { south: 50.75, west: 0.95, north: 51.25, east: 1.95 };
const WINDOW_MS = 15_000;
const START = Date.parse("2026-10-23T12:00:00.000Z");

const POSITION = {
  MessageType: "PositionReport",
  MetaData: { MMSI: 123456789 },
  Message: { PositionReport: { Sog: 12.4 } },
};
const CONFIRMATION = {
  MessageType: "SubscriptionConfirmation",
  Message: { CompressionEnabled: true },
};

function fakeClock() {
  let now = START;
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
    activeTimers: () => timers.filter((timer) => timer.active).length,
  };
}

function fakeSource() {
  const state = {
    url: "",
    sent: [] as string[],
    closed: 0,
    handlers: undefined as SourceHandlers | undefined,
  };
  const openSource: OpenSource = (url, handlers) => {
    state.url = url;
    state.handlers = handlers;
    return {
      send: (text) => void state.sent.push(text),
      close: () => void state.closed++,
    };
  };
  const emit = () => {
    if (!state.handlers) throw new Error("джерело не відкрито");
    return state.handlers;
  };
  return { state, openSource, emit };
}

function start(overrides: Partial<ReaderOptions> = {}) {
  const time = fakeClock();
  const source = fakeSource();
  const result = readFirstPositionReport({
    apiKey: KEY,
    bounds: BOUNDS,
    windowMs: WINDOW_MS,
    openSource: source.openSource,
    clock: time.clock,
    ...overrides,
  });
  return { time, source, result };
}

const json = (value: unknown) => JSON.stringify(value);

test("підписка надсилається одразу після open, одна, у форматі спринту", async () => {
  const { source } = start();
  expect(source.state.url).toBe(AISSTREAM_URL);
  expect(source.state.sent).toEqual([]);
  source.emit().onOpen();
  expect(source.state.sent).toHaveLength(1);
  expect(JSON.parse(source.state.sent[0])).toEqual({
    APIKey: KEY,
    BoundingBoxes: [
      [
        [50.75, 0.95],
        [51.25, 1.95],
      ],
    ],
    FilterMessageTypes: ["PositionReport"],
  });
});

test("перший PositionReport повертається як raw; з'єднання й таймер закриті", async () => {
  const { time, source, result } = start();
  source.emit().onOpen();
  time.advance(1_234);
  source.emit().onMessage(json(POSITION));
  expect(await result).toEqual({
    ok: true,
    raw: POSITION,
    collectedAt: new Date(START + 1_234),
  });
  expect(source.state.closed).toBe(1);
  expect(time.activeTimers()).toBe(0);
});

test("SubscriptionConfirmation пропускається, raw - наступний PositionReport", async () => {
  const { source, result } = start();
  source.emit().onOpen();
  source.emit().onMessage(json(CONFIRMATION));
  source.emit().onMessage(json({ MessageType: "ShipStaticData", Message: {} }));
  source.emit().onMessage(json(POSITION));
  const outcome = await result;
  expect(outcome.ok && outcome.raw).toEqual(POSITION);
});

test("бінарний кадр (UTF-8 JSON) декодується", async () => {
  const { source, result } = start();
  source.emit().onOpen();
  const bytes = new TextEncoder().encode(json(POSITION));
  source.emit().onMessage(bytes.buffer);
  const outcome = await result;
  expect(outcome.ok && outcome.raw).toEqual(POSITION);
});

test("строк минув при живому з'єднанні - raw: null", async () => {
  const { time, source, result } = start();
  source.emit().onOpen();
  source.emit().onMessage(json(CONFIRMATION));
  time.advance(WINDOW_MS);
  expect(await result).toEqual({
    ok: true,
    raw: null,
    collectedAt: new Date(START + WINDOW_MS),
  });
  expect(source.state.closed).toBe(1);
});

test("строк рахується від старту, включно зі з'єднанням", async () => {
  const { time, source, result } = start();
  time.advance(WINDOW_MS - 1);
  source.emit().onOpen();
  time.advance(1);
  expect(await result).toMatchObject({ ok: true, raw: null });
});

test("помилка до відкриття - connect_failed одразу", async () => {
  const { time, source, result } = start();
  time.advance(500);
  source.emit().onError();
  expect(await result).toEqual({
    ok: false,
    code: "connect_failed",
    attemptedAt: new Date(START),
  });
  expect(source.state.closed).toBe(1);
  expect(time.activeTimers()).toBe(0);
});

test("строк минув без відкриття - connect_failed", async () => {
  const { time, source, result } = start();
  time.advance(WINDOW_MS);
  expect(await result).toMatchObject({ ok: false, code: "connect_failed" });
  expect(source.state.sent).toEqual([]);
  expect(source.state.closed).toBe(1);
});

test("виняток при створенні з'єднання - connect_failed", async () => {
  const { time, result } = start({
    openSource: () => {
      throw new Error("bad url");
    },
  });
  expect(await result).toMatchObject({ ok: false, code: "connect_failed" });
  expect(time.activeTimers()).toBe(0);
});

test("закриття після підписки - disconnected", async () => {
  const { time, source, result } = start();
  source.emit().onOpen();
  source.emit().onMessage(json(CONFIRMATION));
  source.emit().onClose();
  expect(await result).toMatchObject({ ok: false, code: "disconnected" });
  expect(time.activeTimers()).toBe(0);
});

test("повідомлення помилки джерела - provider_error, текст не в результаті", async () => {
  for (const frame of [{ error: "Api Key Is Not Valid" }, { Error: "x" }]) {
    const { source, result } = start();
    source.emit().onOpen();
    source.emit().onMessage(json(frame));
    const outcome = await result;
    expect(outcome).toMatchObject({ ok: false, code: "provider_error" });
    expect(json(outcome)).not.toContain("Api Key");
    expect(source.state.closed).toBe(1);
  }
});

test("нерозбірний кадр - provider_error", async () => {
  const { source, result } = start();
  source.emit().onOpen();
  source.emit().onMessage("not json");
  expect(await result).toMatchObject({ ok: false, code: "provider_error" });
});

test("скасування - cancelled, з'єднання й таймер закриті", async () => {
  const controller = new AbortController();
  const { time, source, result } = start({ signal: controller.signal });
  source.emit().onOpen();
  controller.abort();
  expect(await result).toMatchObject({ ok: false, code: "cancelled" });
  expect(source.state.closed).toBe(1);
  expect(time.activeTimers()).toBe(0);
});

test("уже скасований запит не відкриває з'єднання", async () => {
  const controller = new AbortController();
  controller.abort();
  const { source, result } = start({ signal: controller.signal });
  expect(await result).toMatchObject({ ok: false, code: "cancelled" });
  expect(source.state.handlers).toBeUndefined();
});

test("результат завершується один раз; пізні події його не змінюють", async () => {
  const { time, source, result } = start();
  source.emit().onOpen();
  source.emit().onMessage(json(POSITION));
  source.emit().onMessage(json({ ...POSITION, MetaData: { MMSI: 1 } }));
  source.emit().onError();
  source.emit().onClose();
  time.advance(WINDOW_MS);
  const outcome = await result;
  expect(outcome.ok && outcome.raw).toEqual(POSITION);
  expect(source.state.closed).toBe(1);
  expect(source.state.sent).toHaveLength(1);
});

test("open до повернення з openSource - підписка все одно надсилається", async () => {
  const sent: string[] = [];
  const time = fakeClock();
  const result = readFirstPositionReport({
    apiKey: KEY,
    bounds: BOUNDS,
    windowMs: WINDOW_MS,
    clock: time.clock,
    openSource: (_url, handlers) => {
      handlers.onOpen();
      handlers.onMessage(json(POSITION));
      return { send: (text) => void sent.push(text), close: () => {} };
    },
  });
  time.advance(WINDOW_MS);
  // Повідомлення до підписки не рахується; строк минув при живому з'єднанні.
  expect(sent).toHaveLength(1);
  expect(await result).toMatchObject({ ok: true, raw: null });
});

test("ключ не потрапляє в результат і консоль", async () => {
  const logged: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const original = methods.map((name) => console[name]);
  methods.forEach((name) => {
    console[name] = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  });
  try {
    const outcomes = [];
    for (const step of ["position", "error", "close"] as const) {
      const { source, result } = start();
      source.emit().onOpen();
      if (step === "position") source.emit().onMessage(json(POSITION));
      if (step === "error") source.emit().onMessage(json({ error: "x" }));
      if (step === "close") source.emit().onClose();
      outcomes.push(await result);
    }
    expect(json(outcomes)).not.toContain(KEY);
    expect(logged.join("\n")).not.toContain(KEY);
  } finally {
    methods.forEach((name, i) => {
      console[name] = original[i];
    });
  }
});
