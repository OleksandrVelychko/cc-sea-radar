import {
  AREA_BOUNDS,
  SNAPSHOT_VESSEL_LIMIT,
  SNAPSHOT_WINDOW_SECONDS,
} from "../../config";
import { readApiKey } from "./apiKey";
import {
  collectSnapshot,
  type Clock,
  type CollectErrorCode,
  type CollectResult,
  type OpenSource,
} from "./collector";

// WebSocket до AISStream - тільки з сервера, у Node.js.
export const runtime = "nodejs";
// Без цього GET без звернення до запиту Next може відрендерити під час збірки.
export const dynamic = "force-dynamic";

type ErrorCode = CollectErrorCode | "no_api_key" | "internal";

// Фіксовані тексти SPRINT-02; сирий текст помилки сюди не потрапляє.
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  no_api_key: "Ключ AISStream не налаштовано",
  connect_failed: "Не вдалося підключитися до джерела",
  provider_error: "Джерело повернуло помилку",
  disconnected: "З'єднання з джерелом розірвано",
  internal: "Внутрішня помилка сервера",
};

// Службова відповідь на перерваний клієнтом запит (Client Closed Request).
// Це не результат збору: тіла, ok і error.code немає.
const CLIENT_CLOSED_REQUEST = 499;

const systemClock: Clock = {
  now: () => new Date(),
  setTimer(ms, fire) {
    const timer = setTimeout(fire, ms);
    return () => clearTimeout(timer);
  },
};

// Вбудований WebSocket Node.js: permessage-deflate пропонується сам,
// бінарні кадри приходять як ArrayBuffer. close() спершу знімає обробники:
// закриття до open синхронно генерує error і close.
const openWebSocket: OpenSource = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const listeners = {
    open: () => handlers.onOpen(),
    message: (event: MessageEvent) => handlers.onMessage(event.data),
    error: () => handlers.onError(),
    close: () => handlers.onClose(),
  };
  socket.addEventListener("open", listeners.open);
  socket.addEventListener("message", listeners.message);
  socket.addEventListener("error", listeners.error);
  socket.addEventListener("close", listeners.close);
  return {
    send: (text) => socket.send(text),
    close() {
      socket.removeEventListener("open", listeners.open);
      socket.removeEventListener("message", listeners.message);
      socket.removeEventListener("error", listeners.error);
      socket.removeEventListener("close", listeners.close);
      socket.close();
    },
  };
};

function errorResponse(code: ErrorCode, attemptedAt: Date): Response {
  return Response.json(
    {
      ok: false,
      attemptedAt: attemptedAt.toISOString(),
      error: { code, message: ERROR_MESSAGES[code] },
    },
    { status: 502 },
  );
}

function resultResponse(result: CollectResult): Response {
  if (!result.ok) return errorResponse(result.code, result.attemptedAt);
  return Response.json({
    ok: true,
    vessels: result.vessels,
    collectedAt: result.collectedAt.toISOString(),
    windowSeconds: SNAPSHOT_WINDOW_SECONDS,
    count: result.vessels.length,
    truncated: result.truncated,
    reason: result.reason,
  });
}

// Promise, що виконується при перериванні запиту; dispose знімає обробник.
function whenAborted(signal: AbortSignal) {
  let onAbort = () => {};
  const promise = new Promise<"aborted">((resolve) => {
    onAbort = () => resolve("aborted");
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  return { promise, dispose: () => signal.removeEventListener("abort", onAbort) };
}

export async function GET(request: Request): Promise<Response> {
  const startedAt = systemClock.now();
  try {
    const apiKey = readApiKey();
    if (apiKey === null) return errorResponse("no_api_key", startedAt);

    // Життєвий цикл обробника окремо від результату збирача: при скасуванні
    // збирач звільняє ресурси й не завершується, а обробник перестає його
    // чекати й завершує HTTP-обмін службовою відповіддю.
    const aborted = whenAborted(request.signal);
    const outcome = await Promise.race([
      collectSnapshot({
        apiKey,
        bounds: AREA_BOUNDS,
        windowMs: SNAPSHOT_WINDOW_SECONDS * 1000,
        limit: SNAPSHOT_VESSEL_LIMIT,
        openSource: openWebSocket,
        clock: systemClock,
        startedAt,
        signal: request.signal,
      }),
      aborted.promise,
    ]);
    aborted.dispose();

    if (outcome === "aborted") {
      return new Response(null, { status: CLIENT_CLOSED_REQUEST });
    }
    return resultResponse(outcome);
  } catch {
    return errorResponse("internal", startedAt);
  }
}
