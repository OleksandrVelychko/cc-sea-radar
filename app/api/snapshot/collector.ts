// Збирач B-12: одне з'єднання з AISStream, збір позицій за правилами SPRINT-02.
// Мережа й час - параметри (джерело подій і годинник), щоб тести подавали
// повідомлення й рухали час без мережі. Ключ передається аргументом і
// потрапляє тільки в повідомлення підписки.
import type { Vessel } from "../../vessel";
import { toVessel } from "./convert";

export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";

export type Bounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type SourceHandlers = {
  onOpen(): void;
  onMessage(data: unknown): void;
  onError(): void;
  onClose(): void;
};

// close() спершу від'єднує обробники, потім закриває з'єднання:
// після close() джерело не викликає жодного з SourceHandlers.
export type Source = {
  send(text: string): void;
  close(): void;
};

export type OpenSource = (url: string, handlers: SourceHandlers) => Source;

export type Clock = {
  now(): Date;
  // Повертає функцію скасування таймера.
  setTimer(ms: number, fire: () => void): () => void;
};

export type CollectErrorCode = "connect_failed" | "provider_error" | "disconnected";

export type CollectResult =
  | {
      ok: true;
      vessels: Vessel[];
      collectedAt: Date;
      truncated: boolean;
      reason: "window_elapsed" | "limit_reached";
    }
  | { ok: false; code: CollectErrorCode; attemptedAt: Date };

export type CollectOptions = {
  apiKey: string;
  bounds: Bounds;
  windowMs: number;
  limit: number;
  openSource: OpenSource;
  clock: Clock;
  // Початок серверної обробки: від нього рахується строк. За замовчуванням - зараз.
  startedAt?: Date;
  signal?: AbortSignal;
};

export function subscriptionMessage(apiKey: string, bounds: Bounds): string {
  return JSON.stringify({
    APIKey: apiKey,
    BoundingBoxes: [
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
    ],
    FilterMessageTypes: ["PositionReport"],
  });
}

// Кадр джерела - JSON-об'єкт у UTF-8 (бінарний або текстовий).
// null - кадр не розбирається як JSON-об'єкт.
function decodeFrame(data: unknown): Record<string, unknown> | null {
  let text: string;
  if (typeof data === "string") {
    text = data;
  } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    text = new TextDecoder().decode(data);
  } else {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Помилка джерела: об'єкт з полем error/Error (модель Error в ais-message-models).
function isProviderError(message: Record<string, unknown>): boolean {
  return "error" in message || "Error" in message;
}

// Promise завершується рівно один раз: успіхом або помилкою за SPRINT-02.
// При скасуванні (signal) ресурси звільняються, а Promise не завершується.
export function collectSnapshot(options: CollectOptions): Promise<CollectResult> {
  const { apiKey, bounds, windowMs, limit, openSource, clock, signal } = options;
  const attemptedAt = options.startedAt ?? clock.now();

  return new Promise((resolve) => {
    // stopped - збір зупинено (результатом або скасуванням); далі події ігноруються.
    let stopped = false;
    let opened = false;
    let subscribed = false;
    let openPending = false;
    let source: Source | undefined;
    let cancelTimer: (() => void) | undefined;
    // Одна позиція на id: найновіша за time_utc, при рівному часі - перша прийнята.
    const latest = new Map<string, { vessel: Vessel; time: number }>();

    function closeSource() {
      try {
        source?.close();
      } catch {
        // Помилка закриття не впливає на результат.
      }
    }

    // Звільнення ресурсів: таймер, обробник abort, джерело з його обробниками.
    function stop() {
      if (stopped) return;
      stopped = true;
      cancelTimer?.();
      signal?.removeEventListener("abort", stop);
      closeSource();
    }

    function finish(result: CollectResult) {
      if (stopped) return;
      stop();
      resolve(result);
    }

    function fail(code: CollectErrorCode) {
      finish({ ok: false, code, attemptedAt });
    }

    function succeed(reason: "window_elapsed" | "limit_reached") {
      finish({
        ok: true,
        vessels: [...latest.values()].map((entry) => entry.vessel),
        collectedAt: clock.now(),
        truncated: reason === "limit_reached",
        reason,
      });
    }

    // Валідна позиція: нове судно або заміна цілим об'єктом, якщо час новіший.
    function accept(vessel: Vessel) {
      const time = Date.parse(vessel.timestamp);
      const known = latest.get(vessel.id);
      if (known) {
        if (time > known.time) latest.set(vessel.id, { vessel, time });
        return;
      }
      latest.set(vessel.id, { vessel, time });
      if (latest.size >= limit) succeed("limit_reached");
    }

    // Скасування: тільки звільнення ресурсів, без resolve.
    if (signal?.aborted) {
      stopped = true;
      return;
    }
    signal?.addEventListener("abort", stop, { once: true });

    const elapsed = clock.now().getTime() - attemptedAt.getTime();
    cancelTimer = clock.setTimer(Math.max(0, windowMs - elapsed), () => {
      if (subscribed) succeed("window_elapsed");
      else fail("connect_failed");
    });

    const handlers: SourceHandlers = {
      onOpen() {
        if (stopped) return;
        // Відкриття до повернення з openSource - надіслати одразу після нього.
        if (!source) {
          openPending = true;
          return;
        }
        opened = true;
        // Підписка - одразу після відкриття, інакше сервіс закриває з'єднання.
        try {
          source.send(subscriptionMessage(apiKey, bounds));
          subscribed = true;
        } catch {
          fail("connect_failed");
        }
      },
      onMessage(data) {
        // До надсилання підписки кадри не належать до нашої спроби.
        if (stopped || !subscribed) return;
        const message = decodeFrame(data);
        // Правило: кадр, що не розбирається як JSON-об'єкт, - порушення
        // протоколу джерела, як і явне повідомлення помилки.
        if (message === null || isProviderError(message)) {
          fail("provider_error");
          return;
        }
        // Службові повідомлення (SubscriptionConfirmation тощо) - не позиції.
        if (message.MessageType !== "PositionReport") return;
        // Валідний JSON з невалідною позицією пропускається, збір триває.
        const vessel = toVessel(message);
        if (vessel) accept(vessel);
      },
      onError() {
        if (stopped) return;
        fail(opened ? "disconnected" : "connect_failed");
      },
      onClose() {
        if (stopped) return;
        fail(opened ? "disconnected" : "connect_failed");
      },
    };

    try {
      source = openSource(AISSTREAM_URL, handlers);
    } catch {
      fail("connect_failed");
      return;
    }
    // Джерело могло завершити збір ще до повернення з openSource.
    if (stopped) closeSource();
    else if (openPending) handlers.onOpen();
  });
}
