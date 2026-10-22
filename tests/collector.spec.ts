import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  AISSTREAM_URL,
  collectSnapshot,
  type Clock,
  type CollectOptions,
  type OpenSource,
  type SourceHandlers,
} from "../app/api/snapshot/collector";

// Тести збирача без мережі й браузера: джерело подій і годинник - підставні.
// Повідомлення - синтетичні варіанти зразка data/samples/.
const KEY = "test-key-not-real";
const BOUNDS = { south: 50.75, west: 0.95, north: 51.25, east: 1.95 };
const WINDOW_MS = 15_000;
const LIMIT = 100;
const START = Date.parse("2026-10-23T12:00:00.000Z");

const SAMPLE = JSON.parse(
  readFileSync("data/samples/position-report.sample.json", "utf8"),
);
const CONFIRMATION = {
  MessageType: "SubscriptionConfirmation",
  Message: { CompressionEnabled: true },
};

// Синтетичний PositionReport: MMSI, time_utc, координати й назва.
function position(
  mmsi: number,
  time = "2026-01-01 12:00:00 +0000 UTC",
  // name: null - поле ShipName відсутнє.
  { lat = 51.0, lon = 1.45, name = "SYNTHETIC" as string | null } = {},
) {
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

// Тестове джерело фіксує надіслане й закриття. Обробники лишаються доступними
// й після close(), щоб подавати "пізні" події.
function fakeSource(onClose?: (handlers: SourceHandlers) => void) {
  const state = {
    opened: 0,
    sent: [] as string[],
    closed: 0,
    handlers: undefined as SourceHandlers | undefined,
  };
  const openSource: OpenSource = (url, handlers) => {
    expect(url).toBe(AISSTREAM_URL);
    state.opened++;
    state.handlers = handlers;
    return {
      send: (text) => void state.sent.push(text),
      close: () => {
        state.closed++;
        onClose?.(handlers);
      },
    };
  };
  const emit = () => {
    if (!state.handlers) throw new Error("джерело не відкрито");
    return state.handlers;
  };
  return { state, openSource, emit };
}

function start(overrides: Partial<CollectOptions> = {}, source = fakeSource()) {
  const time = fakeClock();
  let settled = false;
  const result = collectSnapshot({
    apiKey: KEY,
    bounds: BOUNDS,
    windowMs: WINDOW_MS,
    limit: LIMIT,
    openSource: source.openSource,
    clock: time.clock,
    ...overrides,
  });
  void result.then(() => {
    settled = true;
  });
  // Відкрите з'єднання з надісланою підпискою.
  const subscribe = () => {
    source.emit().onOpen();
    source.emit().onMessage(JSON.stringify(CONFIRMATION));
  };
  const isSettled = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return settled;
  };
  return { time, source, result, subscribe, isSettled };
}

// Фіксує типи подій, для яких знято обробники з signal.
function spyRemovedListeners(signal: AbortSignal): string[] {
  const removed: string[] = [];
  const remove = signal.removeEventListener.bind(signal);
  signal.removeEventListener = ((type: string, listener: EventListener, options?: EventListenerOptions) => {
    removed.push(type);
    remove(type, listener, options);
  }) as typeof signal.removeEventListener;
  return removed;
}

const ids = (vessels: { id: string }[]) => vessels.map((vessel) => vessel.id);

test("підписка надсилається одразу після open, одна, у форматі спринту", async () => {
  const { source } = start();
  expect(source.state.sent).toEqual([]);
  source.emit().onOpen();
  expect(source.state.sent.map((text) => JSON.parse(text))).toEqual([
    {
      APIKey: KEY,
      BoundingBoxes: [
        [
          [50.75, 0.95],
          [51.25, 1.95],
        ],
      ],
      FilterMessageTypes: ["PositionReport"],
    },
  ]);
});

test.describe("вікно минуло", () => {
  test("при живому з'єднанні без позицій - порожній успіх", async () => {
    const { time, source, result, subscribe } = start();
    subscribe();
    time.advance(WINDOW_MS);
    expect(await result).toEqual({
      ok: true,
      vessels: [],
      collectedAt: new Date("2026-10-23T12:00:15.000Z"),
      truncated: false,
      reason: "window_elapsed",
    });
    expect(source.state.closed).toBe(1);
    expect(time.activeTimers()).toBe(0);
  });

  test("строк рахується від початку обробки (startedAt), включно зі з'єднанням", async () => {
    const { time, result, subscribe } = start({
      startedAt: new Date("2026-10-23T11:59:55.000Z"),
    });
    subscribe();
    time.advance(9_999);
    time.advance(1);
    expect(await result).toMatchObject({
      ok: true,
      reason: "window_elapsed",
      collectedAt: new Date("2026-10-23T12:00:10.000Z"),
    });
  });

  test("без відкриття - connect_failed", async () => {
    const { time, source, result } = start();
    time.advance(WINDOW_MS);
    expect(await result).toEqual({
      ok: false,
      code: "connect_failed",
      attemptedAt: new Date("2026-10-23T12:00:00.000Z"),
    });
    expect(source.state.sent).toEqual([]);
    expect(source.state.closed).toBe(1);
  });
});

test.describe("одна позиція на id", () => {
  test("два однакові повідомлення - одне судно", async () => {
    const { time, source, result, subscribe } = start();
    subscribe();
    source.emit().onMessage(position(111111111));
    source.emit().onMessage(position(111111111));
    time.advance(WINDOW_MS);
    const outcome = await result;
    expect(outcome.ok && ids(outcome.vessels)).toEqual(["111111111"]);
  });

  test("старіше повідомлення після новішого не замінює (лишається P2)", async () => {
    const { time, source, result, subscribe } = start();
    subscribe();
    source.emit().onMessage(position(111111111, "2026-01-01 12:01:00 +0000 UTC", { lat: 51.2, lon: 1.9 }));
    source.emit().onMessage(position(111111111, "2026-01-01 12:00:00 +0000 UTC", { lat: 50.8, lon: 1.0 }));
    time.advance(WINDOW_MS);
    const outcome = await result;
    expect(outcome.ok && outcome.vessels).toEqual([
      expect.objectContaining({ id: "111111111", lat: 51.2, lon: 1.9, timestamp: "2026-01-01T12:01:00.000Z" }),
    ]);
  });

  test("новіше повідомлення замінює (точність - мілісекунда)", async () => {
    const { time, source, result, subscribe } = start();
    subscribe();
    source.emit().onMessage(position(111111111, "2026-01-01 12:00:00.100 +0000 UTC", { lat: 50.8 }));
    source.emit().onMessage(position(111111111, "2026-01-01 12:00:00.101 +0000 UTC", { lat: 51.2 }));
    time.advance(WINDOW_MS);
    const outcome = await result;
    expect(outcome.ok && outcome.vessels[0].lat).toBe(51.2);
  });

  test("однаковий час з точністю до мс - лишається перша прийнята", async () => {
    const { time, source, result, subscribe } = start();
    subscribe();
    source.emit().onMessage(position(111111111, "2026-01-01 12:00:00.1234 +0000 UTC", { lat: 50.8 }));
    source.emit().onMessage(position(111111111, "2026-01-01 12:00:00.1239 +0000 UTC", { lat: 51.2 }));
    time.advance(WINDOW_MS);
    const outcome = await result;
    expect(outcome.ok && outcome.vessels[0].lat).toBe(50.8);
  });

  test("заміна об'єкта цілком: друге повідомлення без назви - name null", async () => {
    const { time, source, result, subscribe } = start();
    subscribe();
    source.emit().onMessage(position(111111111, "2026-01-01 12:00:00 +0000 UTC", { name: "FIRST" }));
    source.emit().onMessage(position(111111111, "2026-01-01 12:00:01 +0000 UTC", { name: null }));
    time.advance(WINDOW_MS);
    const outcome = await result;
    expect(outcome.ok && outcome.vessels[0].name).toBeNull();
  });
});

test.describe("пропуск без завершення", () => {
  test("валідний JSON з невалідною позицією пропускається, збір триває", async () => {
    const { time, source, result, subscribe, isSettled } = start();
    subscribe();
    source.emit().onMessage(position(111111111, undefined, { lat: 91 }));
    source.emit().onMessage(position(222222222, "not a time"));
    source.emit().onMessage(JSON.stringify({ MessageType: "PositionReport" }));
    expect(await isSettled()).toBe(false);
    source.emit().onMessage(position(333333333));
    time.advance(WINDOW_MS);
    const outcome = await result;
    expect(outcome.ok && ids(outcome.vessels)).toEqual(["333333333"]);
  });

  test("службові й інші типи повідомлень пропускаються", async () => {
    const { time, source, result, subscribe } = start();
    subscribe();
    source.emit().onMessage(JSON.stringify(CONFIRMATION));
    source.emit().onMessage(JSON.stringify({ MessageType: "ShipStaticData", Message: {} }));
    time.advance(WINDOW_MS);
    expect(await result).toMatchObject({ ok: true, vessels: [] });
  });

  test("бінарний кадр (UTF-8 JSON) декодується", async () => {
    const { time, source, result, subscribe } = start();
    subscribe();
    source.emit().onMessage(new TextEncoder().encode(position(111111111)).buffer);
    time.advance(WINDOW_MS);
    const outcome = await result;
    expect(outcome.ok && ids(outcome.vessels)).toEqual(["111111111"]);
  });
});

test.describe("ліміт", () => {
  test("100 унікальних суден - негайне завершення, 101-е не прийняте", async () => {
    const { time, source, result, subscribe } = start();
    subscribe();
    for (let i = 1; i <= 101; i++) source.emit().onMessage(position(100_000_000 + i));
    const outcome = await result;
    expect(outcome).toMatchObject({
      ok: true,
      truncated: true,
      reason: "limit_reached",
      collectedAt: new Date("2026-10-23T12:00:00.000Z"),
    });
    expect(outcome.ok && outcome.vessels).toHaveLength(100);
    expect(outcome.ok && ids(outcome.vessels)).not.toContain("100000101");
    expect(source.state.closed).toBe(1);
    expect(time.activeTimers()).toBe(0);
  });

  test("100 повідомлень про одне судно - одне судно, збір до кінця вікна", async () => {
    const { time, source, result, subscribe, isSettled } = start();
    subscribe();
    for (let i = 0; i < 100; i++) {
      source.emit().onMessage(position(111111111, `2026-01-01 12:00:${String(i % 60).padStart(2, "0")} +0000 UTC`));
    }
    expect(await isSettled()).toBe(false);
    time.advance(WINDOW_MS);
    expect(await result).toMatchObject({ ok: true, reason: "window_elapsed", truncated: false });
    const outcome = await result;
    expect(outcome.ok && outcome.vessels).toHaveLength(1);
  });

  test("помилка провайдера після завершення за лімітом - результат лишається успіхом", async () => {
    const { source, result, subscribe } = start({ limit: 2 });
    subscribe();
    source.emit().onMessage(position(111111111));
    source.emit().onMessage(position(222222222));
    source.emit().onMessage(JSON.stringify({ error: "late" }));
    source.emit().onClose();
    expect(await result).toMatchObject({ ok: true, reason: "limit_reached" });
    expect(source.state.closed).toBe(1);
  });
});

test.describe("помилки: частковий набір не повертається", () => {
  test("помилка сокета до open - connect_failed негайно", async () => {
    const { time, source, result } = start();
    time.advance(500);
    source.emit().onError();
    expect(await result).toEqual({
      ok: false,
      code: "connect_failed",
      attemptedAt: new Date("2026-10-23T12:00:00.000Z"),
    });
    expect(source.state.closed).toBe(1);
    expect(time.activeTimers()).toBe(0);
  });

  test("закриття до open - connect_failed", async () => {
    const { source, result } = start();
    source.emit().onClose();
    expect(await result).toMatchObject({ ok: false, code: "connect_failed" });
  });

  test("виняток при створенні з'єднання - connect_failed", async () => {
    const time = fakeClock();
    const result = collectSnapshot({
      apiKey: KEY, bounds: BOUNDS, windowMs: WINDOW_MS, limit: LIMIT, clock: time.clock,
      openSource: () => {
        throw new Error("bad url");
      },
    });
    expect(await result).toMatchObject({ ok: false, code: "connect_failed" });
    expect(time.activeTimers()).toBe(0);
  });

  test("помилка провайдера після трьох позицій - provider_error без позицій", async () => {
    for (const frame of [{ error: "Api Key Is Not Valid" }, { Error: "x" }]) {
      const { time, source, result, subscribe } = start();
      subscribe();
      for (const mmsi of [111111111, 222222222, 333333333]) source.emit().onMessage(position(mmsi));
      source.emit().onMessage(JSON.stringify(frame));
      const outcome = await result;
      expect(outcome).toEqual({
        ok: false,
        code: "provider_error",
        attemptedAt: new Date("2026-10-23T12:00:00.000Z"),
      });
      expect(JSON.stringify(outcome)).not.toContain("Api Key");
      expect(source.state.closed).toBe(1);
      expect(time.activeTimers()).toBe(0);
    }
  });

  test("розрив після трьох позицій - disconnected без позицій", async () => {
    for (const event of ["onClose", "onError"] as const) {
      const { source, result, subscribe } = start();
      subscribe();
      for (const mmsi of [111111111, 222222222, 333333333]) source.emit().onMessage(position(mmsi));
      source.emit()[event]();
      expect(await result).toEqual({
        ok: false,
        code: "disconnected",
        attemptedAt: new Date("2026-10-23T12:00:00.000Z"),
      });
    }
  });

  test("кадр, що не є JSON-об'єктом, - provider_error (зафіксоване правило)", async () => {
    for (const frame of ["not json", "[1,2]", "42", "null"]) {
      const { source, result, subscribe } = start();
      subscribe();
      source.emit().onMessage(position(111111111));
      source.emit().onMessage(frame);
      expect(await result, frame).toMatchObject({ ok: false, code: "provider_error" });
    }
  });
});

test.describe("скасування", () => {
  test("до кінця вікна - Promise не завершується, ресурси звільнені, пізні події без ефекту", async () => {
    const controller = new AbortController();
    const removed = spyRemovedListeners(controller.signal);
    const { time, source, subscribe, isSettled } = start({ signal: controller.signal });
    subscribe();
    source.emit().onMessage(position(111111111));
    controller.abort();
    expect(source.state.closed).toBe(1);
    expect(time.activeTimers()).toBe(0);
    expect(removed).toEqual(["abort"]);
    source.emit().onMessage(position(222222222));
    source.emit().onError();
    source.emit().onClose();
    time.advance(WINDOW_MS);
    expect(await isSettled()).toBe(false);
    expect(source.state.closed).toBe(1);
  });

  test("уже скасований signal - з'єднання не відкривається, таймера немає", async () => {
    const controller = new AbortController();
    controller.abort();
    const { time, source, isSettled } = start({ signal: controller.signal });
    expect(source.state.opened).toBe(0);
    expect(time.activeTimers()).toBe(0);
    expect(await isSettled()).toBe(false);
  });

  test("abort після завершення нічого не змінює; обробник abort знято", async () => {
    const controller = new AbortController();
    const removed = spyRemovedListeners(controller.signal);
    const { time, source, result, subscribe } = start({ signal: controller.signal });
    subscribe();
    time.advance(WINDOW_MS);
    controller.abort();
    expect(await result).toMatchObject({ ok: true, reason: "window_elapsed" });
    expect(removed).toEqual(["abort"]);
    expect(source.state.closed).toBe(1);
  });
});

test("власне закриття, що синхронно генерує error і close, не дає другого завершення", async () => {
  // Так поводиться вбудований WebSocket при close() до open.
  const source = fakeSource((handlers) => {
    handlers.onError();
    handlers.onClose();
  });
  const { time, result } = start({}, source);
  time.advance(WINDOW_MS);
  expect(await result).toMatchObject({ ok: false, code: "connect_failed" });
  expect(source.state.closed).toBe(1);
});

test("open до повернення з openSource - підписка все одно надсилається", async () => {
  const sent: string[] = [];
  const time = fakeClock();
  const result = collectSnapshot({
    apiKey: KEY, bounds: BOUNDS, windowMs: WINDOW_MS, limit: LIMIT, clock: time.clock,
    openSource: (_url, handlers) => {
      handlers.onOpen();
      handlers.onMessage(position(111111111));
      return { send: (text) => void sent.push(text), close: () => {} };
    },
  });
  time.advance(WINDOW_MS);
  expect(sent).toHaveLength(1);
  // Кадр до підписки не належить спробі.
  expect(await result).toMatchObject({ ok: true, vessels: [] });
});

test("після кожного результату немає відкритих з'єднань і таймерів", async () => {
  const scenarios: [string, (s: ReturnType<typeof start>) => void][] = [
    ["window", (s) => { s.subscribe(); s.time.advance(WINDOW_MS); }],
    ["limit", (s) => { s.subscribe(); for (let i = 1; i <= LIMIT; i++) s.source.emit().onMessage(position(100_000_000 + i)); }],
    ["connect_failed", (s) => s.source.emit().onError()],
    ["provider_error", (s) => { s.subscribe(); s.source.emit().onMessage("{\"error\":\"x\"}"); }],
    ["disconnected", (s) => { s.subscribe(); s.source.emit().onClose(); }],
  ];
  for (const [name, run] of scenarios) {
    const s = start();
    run(s);
    await s.result;
    expect(s.source.state.closed, name).toBe(1);
    expect(s.time.activeTimers(), name).toBe(0);
  }
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
    for (const step of ["window", "error", "close"] as const) {
      const { time, source, result, subscribe } = start();
      subscribe();
      source.emit().onMessage(position(111111111));
      if (step === "window") time.advance(WINDOW_MS);
      if (step === "error") source.emit().onMessage("{\"error\":\"x\"}");
      if (step === "close") source.emit().onClose();
      outcomes.push(await result);
    }
    expect(JSON.stringify(outcomes)).not.toContain(KEY);
    expect(logged.join("\n")).not.toContain(KEY);
  } finally {
    methods.forEach((name, i) => {
      console[name] = original[i];
    });
  }
});

// Регресія (додатковий review після R3): час і доставка обробника таймера
// керуються окремо - setNow рухає час, fireDue виконує прострочені таймери.
// Так відтворюється затриманий callback вікна під навантаженням.
test.describe("межа вікна при затриманому таймері", () => {
  function delayedClock() {
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
      setNow: (iso: string) => {
        now = Date.parse(iso);
      },
      fireDue() {
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

  function run(overrides: Partial<CollectOptions> = {}) {
    const time = delayedClock();
    const source = fakeSource();
    const result = collectSnapshot({
      apiKey: KEY, bounds: BOUNDS, windowMs: WINDOW_MS, limit: LIMIT,
      openSource: source.openSource, clock: time.clock, ...overrides,
    });
    return { time, source, result };
  }

  test("позиція на +16000 мс до виконання обробника вікна не приймається", async () => {
    const { time, source, result } = run();
    source.emit().onOpen();
    source.emit().onMessage(JSON.stringify(CONFIRMATION));
    time.setNow("2026-10-23T12:00:01.000Z");
    source.emit().onMessage(position(111111111));
    time.setNow("2026-10-23T12:00:16.000Z");
    source.emit().onMessage(position(222222222));
    time.fireDue();
    expect(await result).toEqual({
      ok: true,
      vessels: [expect.objectContaining({ id: "111111111" })],
      collectedAt: new Date("2026-10-23T12:00:16.000Z"),
      truncated: false,
      reason: "window_elapsed",
    });
    expect(source.state.closed).toBe(1);
    expect(time.pendingTimers()).toBe(0);
  });

  test("позиція рівно на межі 15000 мс уже поза вікном", async () => {
    const { time, source, result } = run();
    source.emit().onOpen();
    time.setNow("2026-10-23T12:00:15.000Z");
    source.emit().onMessage(position(111111111));
    time.fireDue();
    expect(await result).toMatchObject({ ok: true, vessels: [], reason: "window_elapsed" });
  });

  test("open після кінця вікна - без підписки, connect_failed", async () => {
    const { time, source, result } = run();
    time.setNow("2026-10-23T12:00:16.000Z");
    source.emit().onOpen();
    time.fireDue();
    expect(await result).toEqual({
      ok: false,
      code: "connect_failed",
      attemptedAt: new Date("2026-10-23T12:00:00.000Z"),
    });
    expect(source.state.sent).toEqual([]);
    expect(source.state.closed).toBe(1);
    expect(time.pendingTimers()).toBe(0);
  });

  test("закриття після кінця вікна до обробника - штатний успіх, не disconnected", async () => {
    const { time, source, result } = run();
    source.emit().onOpen();
    source.emit().onMessage(position(111111111));
    time.setNow("2026-10-23T12:00:16.000Z");
    source.emit().onClose();
    time.fireDue();
    expect(await result).toMatchObject({
      ok: true,
      reason: "window_elapsed",
      vessels: [expect.objectContaining({ id: "111111111" })],
    });
  });

  test("startedAt уже прострочений - connect_failed одразу, з'єднання не відкривається", async () => {
    const { time, source, result } = run({ startedAt: new Date("2026-10-23T11:59:40.000Z") });
    expect(await result).toEqual({
      ok: false,
      code: "connect_failed",
      attemptedAt: new Date("2026-10-23T11:59:40.000Z"),
    });
    expect(source.state.opened).toBe(0);
    expect(time.pendingTimers()).toBe(0);
  });
});
