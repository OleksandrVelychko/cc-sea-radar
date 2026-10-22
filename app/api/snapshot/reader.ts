// Reader B-09: відкриває з'єднання з AISStream, надсилає підписку й чекає
// перший PositionReport. Мережа й час - параметри (джерело подій і годинник),
// щоб тести подавали повідомлення й рухали час без мережі. Ключ сюди
// передається аргументом і нікуди не пишеться, крім повідомлення підписки.

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

export type ReaderErrorCode =
  | "connect_failed"
  | "provider_error"
  | "disconnected"
  | "cancelled";

export type ReaderResult =
  | { ok: true; raw: Record<string, unknown> | null; collectedAt: Date }
  | { ok: false; code: ReaderErrorCode; attemptedAt: Date };

export type ReaderOptions = {
  apiKey: string;
  bounds: Bounds;
  windowMs: number;
  openSource: OpenSource;
  clock: Clock;
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

// Сервер надсилає бінарні кадри з JSON у UTF-8; текстові теж приймаються.
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

export function readFirstPositionReport(
  options: ReaderOptions,
): Promise<ReaderResult> {
  const { apiKey, bounds, windowMs, openSource, clock, signal } = options;
  const attemptedAt = clock.now();

  return new Promise((resolve) => {
    let settled = false;
    let opened = false;
    let subscribed = false;
    let openPending = false;
    let source: Source | undefined;
    let cancelTimer: (() => void) | undefined;

    const onAbort = () => fail("cancelled");

    // Єдина точка завершення: результат фіксується один раз, ресурси
    // звільняються в усіх результатах, пізні події ігноруються.
    function finish(result: ReaderResult) {
      if (settled) return;
      settled = true;
      cancelTimer?.();
      signal?.removeEventListener("abort", onAbort);
      closeSource();
      resolve(result);
    }

    function fail(code: ReaderErrorCode) {
      finish({ ok: false, code, attemptedAt });
    }

    function closeSource() {
      try {
        source?.close();
      } catch {
        // Закриття вже закритого з'єднання не впливає на результат.
      }
    }

    if (signal?.aborted) {
      fail("cancelled");
      return;
    }
    signal?.addEventListener("abort", onAbort);

    cancelTimer = clock.setTimer(windowMs, () => {
      if (subscribed) {
        finish({ ok: true, raw: null, collectedAt: clock.now() });
      } else {
        fail("connect_failed");
      }
    });

    const handlers: SourceHandlers = {
      onOpen() {
        if (settled) return;
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
        if (settled || !subscribed) return;
        const message = decodeFrame(data);
        if (message === null || isProviderError(message)) {
          fail("provider_error");
          return;
        }
        // SubscriptionConfirmation та інші типи - службові, не позиція.
        if (message.MessageType === "PositionReport") {
          finish({ ok: true, raw: message, collectedAt: clock.now() });
        }
      },
      onError() {
        if (settled) return;
        fail(opened ? "disconnected" : "connect_failed");
      },
      onClose() {
        if (settled) return;
        fail(opened ? "disconnected" : "connect_failed");
      },
    };

    try {
      source = openSource(AISSTREAM_URL, handlers);
    } catch {
      fail("connect_failed");
      return;
    }
    // Джерело могло завершити результат ще до повернення з openSource.
    if (settled) closeSource();
    else if (openPending) handlers.onOpen();
  });
}
