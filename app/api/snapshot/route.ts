import { AREA_BOUNDS, SNAPSHOT_WINDOW_SECONDS } from "../../config";
import { readApiKey } from "./apiKey";
import {
  readFirstPositionReport,
  type Clock,
  type OpenSource,
  type ReaderErrorCode,
} from "./reader";

// WebSocket до AISStream - тільки з сервера, у Node.js.
export const runtime = "nodejs";
// Без цього GET без звернення до запиту Next може відрендерити під час збірки.
export const dynamic = "force-dynamic";

type ErrorCode = Exclude<ReaderErrorCode, "cancelled"> | "no_api_key" | "internal";

// Фіксовані тексти SPRINT-02; сирий текст помилки сюди не потрапляє.
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  no_api_key: "Ключ AISStream не налаштовано",
  connect_failed: "Не вдалося підключитися до джерела",
  provider_error: "Джерело повернуло помилку",
  disconnected: "З'єднання з джерелом розірвано",
  internal: "Внутрішня помилка сервера",
};

const systemClock: Clock = {
  now: () => new Date(),
  setTimer(ms, fire) {
    const timer = setTimeout(fire, ms);
    return () => clearTimeout(timer);
  },
};

// Вбудований WebSocket Node.js: permessage-deflate пропонується сам,
// бінарні кадри приходять як ArrayBuffer.
const openWebSocket: OpenSource = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => handlers.onOpen());
  socket.addEventListener("message", (event) => handlers.onMessage(event.data));
  socket.addEventListener("error", () => handlers.onError());
  socket.addEventListener("close", () => handlers.onClose());
  return {
    send: (text) => socket.send(text),
    close: () => socket.close(),
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

// Проміжна форма B-09: перший PositionReport як є або null.
export async function GET(request: Request): Promise<Response> {
  const startedAt = systemClock.now();
  try {
    const apiKey = readApiKey();
    if (apiKey === null) return errorResponse("no_api_key", startedAt);

    const result = await readFirstPositionReport({
      apiKey,
      bounds: AREA_BOUNDS,
      windowMs: SNAPSHOT_WINDOW_SECONDS * 1000,
      openSource: openWebSocket,
      clock: systemClock,
      signal: request.signal,
    });

    if (result.ok) {
      return Response.json({
        ok: true,
        raw: result.raw,
        collectedAt: result.collectedAt.toISOString(),
      });
    }
    // Скасування: клієнт уже пішов, відповідь його не досягне.
    const code = result.code === "cancelled" ? "internal" : result.code;
    return errorResponse(code, result.attemptedAt);
  } catch {
    return errorResponse("internal", startedAt);
  }
}
