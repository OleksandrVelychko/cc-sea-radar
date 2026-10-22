// Перетворювач B-11: PositionReport AISStream -> судно за правилами валідації
// SPRINT-02. Поля - за зразком data/samples/position-report.sample.json і
// живою перевіркою (data/samples/PROVENANCE.md). Невалідна позиція - null.
import { toVesselName, type Vessel } from "../../vessel";

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const TIME_UTC =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))? ([+-])(\d{2})(\d{2}) UTC$/;

// "2024-01-01 12:00:00.123456789 +0000 UTC" -> мілісекунди з епохи.
// Дробова частина будь-якої довжини 1-9 обрізається до мілісекунд.
// Складові перевіряються явно: Date сам "прокручує" 30 лютого чи 24:00.
export function parseTimeUtc(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = TIME_UTC.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction = "", sign, oh, om] = match;
  const [year, month, day, hour, minute, second, offsetH, offsetM] = [
    y, mo, d, h, mi, s, oh, om,
  ].map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 || month > 12 ||
    day < 1 || day > daysInMonth ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetH > 23 || offsetM > 59
  ) {
    return null;
  }
  const ms = Number(fraction.padEnd(3, "0").slice(0, 3));
  const offset = (sign === "-" ? -1 : 1) * (offsetH * 60 + offsetM) * 60_000;
  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - offset;
}

// MMSI непорожній: ціле невід'ємне число або непорожній рядок.
function toId(mmsi: unknown): string | null {
  if (isNumber(mmsi) && Number.isInteger(mmsi) && mmsi >= 0) return String(mmsi);
  if (typeof mmsi === "string" && mmsi.trim() !== "") return mmsi.trim();
  return null;
}

// Пробіли по краях обрізаються, порожнє -> null.
function toName(shipName: unknown): string | null {
  return typeof shipName === "string" ? toVesselName(shipName.trim()) : null;
}

// 91/181 ("недоступно") теж поза діапазоном.
function isLatitude(value: unknown): value is number {
  return isNumber(value) && value >= -90 && value <= 90;
}

function isLongitude(value: unknown): value is number {
  return isNumber(value) && value >= -180 && value <= 180;
}

// 102.3 ("недоступно"), поза [0, 102.2], відсутня чи нечислова -> null.
function toSpeed(sog: unknown): number | null {
  return isNumber(sog) && sog >= 0 && sog <= 102.2 ? sog : null;
}

// 360 ("недоступно"), поза [0, 360), відсутній чи нечисловий -> null.
function toCourse(cog: unknown): number | null {
  return isNumber(cog) && cog >= 0 && cog < 360 ? cog : null;
}

export function toVessel(message: unknown): Vessel | null {
  const root = asObject(message);
  if (!root || root.MessageType !== "PositionReport") return null;
  const meta = asObject(root.MetaData);
  const report = asObject(asObject(root.Message)?.PositionReport);
  if (!meta || !report) return null;

  const id = toId(meta.MMSI);
  const time = parseTimeUtc(meta.time_utc);
  const lat = report.Latitude;
  const lon = report.Longitude;
  if (id === null || time === null || !isLatitude(lat) || !isLongitude(lon)) {
    return null;
  }

  return {
    id,
    name: toName(meta.ShipName),
    lat,
    lon,
    speedKnots: toSpeed(report.Sog),
    courseDeg: toCourse(report.Cog),
    timestamp: new Date(time).toISOString(),
    source: "aisstream",
  };
}
