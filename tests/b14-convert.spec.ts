import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { toVessel } from "../app/api/snapshot/convert";

// B-14 (SPRINT-03): приймальні тести перетворювача, node-проєкт без браузера.
// Вхід - збережений зразок і синтетичні варіанти на його основі (позначка
// «синтетичний» у назві тесту). Очікування - літерали з частини A SPRINT-02
// і затвердженої таблиці B-14; функцією, яку перевіряємо, вони не обчислюються.

const SAMPLE = JSON.parse(
  readFileSync("data/samples/position-report.sample.json", "utf8"),
);

// Очікуване судно для зразка - літерал.
const SAMPLE_VESSEL = {
  id: "123456789",
  name: "SYNTHETIC SAMPLE",
  lat: 51,
  lon: 1.45,
  speedKnots: 12.4,
  courseDeg: 86.7,
  timestamp: "2026-01-01T12:00:00.123Z",
  source: "aisstream",
};

const DELETE = Symbol("delete");
type Value = unknown | typeof DELETE;

// Синтетичний варіант зразка: змінені або видалені поля MetaData / PositionReport.
function synthetic(
  meta: Record<string, Value> = {},
  report: Record<string, Value> = {},
) {
  const message = structuredClone(SAMPLE);
  const apply = (target: Record<string, unknown>, changes: Record<string, Value>) => {
    for (const [key, value] of Object.entries(changes)) {
      if (value === DELETE) delete target[key];
      else target[key] = value;
    }
  };
  apply(message.MetaData, meta);
  apply(message.Message.PositionReport, report);
  return message;
}

test("14.1 зразок -> судно з id, координатами, швидкістю, курсом, часом", () => {
  expect(toVessel(SAMPLE)).toEqual({
    id: "123456789",
    name: "SYNTHETIC SAMPLE",
    lat: 51,
    lon: 1.45,
    speedKnots: 12.4,
    courseDeg: 86.7,
    timestamp: "2026-01-01T12:00:00.123Z",
    source: "aisstream",
  });
});

test.describe("назва", () => {
  test("14.2 синтетичний: ShipName відсутній -> name null", () => {
    expect(toVessel(synthetic({ ShipName: DELETE }))).toEqual({ ...SAMPLE_VESSEL, name: null });
  });

  test("14.3 синтетичний: ShipName з пробілів -> name null", () => {
    expect(toVessel(synthetic({ ShipName: "   " }))).toEqual({ ...SAMPLE_VESSEL, name: null });
  });
});

test.describe("швидкість", () => {
  test("14.4 синтетичний: Sog 0 -> speedKnots 0", () => {
    expect(toVessel(synthetic({}, { Sog: 0 }))).toEqual({ ...SAMPLE_VESSEL, speedKnots: 0 });
  });

  test("14.5a синтетичний: Sog 102.3 -> speedKnots null, судно є", () => {
    expect(toVessel(synthetic({}, { Sog: 102.3 }))).toEqual({ ...SAMPLE_VESSEL, speedKnots: null });
  });

  test("14.5b синтетичний: Sog -1 -> speedKnots null, судно є", () => {
    expect(toVessel(synthetic({}, { Sog: -1 }))).toEqual({ ...SAMPLE_VESSEL, speedKnots: null });
  });

  test("14.5c синтетичний: Sog відсутній -> speedKnots null, судно є", () => {
    expect(toVessel(synthetic({}, { Sog: DELETE }))).toEqual({ ...SAMPLE_VESSEL, speedKnots: null });
  });
});

test("14.6 синтетичний: Cog 360 -> courseDeg null, судно є", () => {
  expect(toVessel(synthetic({}, { Cog: 360 }))).toEqual({ ...SAMPLE_VESSEL, courseDeg: null });
});

test.describe("координати", () => {
  test("14.7a синтетичний: Latitude 91 (недоступно) -> позиція відкинута", () => {
    expect(toVessel(synthetic({}, { Latitude: 91 }))).toBeNull();
  });

  test("14.7b синтетичний: Longitude 181 (недоступно) -> позиція відкинута", () => {
    expect(toVessel(synthetic({}, { Longitude: 181 }))).toBeNull();
  });

  test("14.7c синтетичний: Latitude 95 (поза діапазоном) -> позиція відкинута", () => {
    expect(toVessel(synthetic({}, { Latitude: 95 }))).toBeNull();
  });

  test("14.7d синтетичний: Longitude -200 (поза діапазоном) -> позиція відкинута", () => {
    expect(toVessel(synthetic({}, { Longitude: -200 }))).toBeNull();
  });

  test("14.8 синтетичний: 91/181 разом -> null, а не судно в 0,0", () => {
    // null - немає жодного судна, отже й судна з координатами 0,0.
    expect(toVessel(synthetic({}, { Latitude: 91, Longitude: 181 }))).toBeNull();
  });

  test("14.9a синтетичний: Latitude рядком -> позиція відкинута", () => {
    expect(toVessel(synthetic({}, { Latitude: "51.0" }))).toBeNull();
  });

  test("14.9b синтетичний: Longitude рядком -> позиція відкинута", () => {
    expect(toVessel(synthetic({}, { Longitude: "1.45" }))).toBeNull();
  });
});

test.describe("MMSI", () => {
  test("14.10a синтетичний: MMSI відсутній -> позиція відкинута", () => {
    expect(toVessel(synthetic({ MMSI: DELETE }))).toBeNull();
  });

  test("14.10b синтетичний: MMSI порожній -> позиція відкинута", () => {
    expect(toVessel(synthetic({ MMSI: "" }))).toBeNull();
  });
});

test.describe("час", () => {
  test("14.11a синтетичний: time_utc \"not a time\" -> позиція відкинута", () => {
    expect(toVessel(synthetic({ time_utc: "not a time" }))).toBeNull();
  });

  test("14.11b синтетичний: time_utc 30 лютого -> позиція відкинута", () => {
    expect(toVessel(synthetic({ time_utc: "2026-02-30 00:00:00 +0000 UTC" }))).toBeNull();
  });
});
