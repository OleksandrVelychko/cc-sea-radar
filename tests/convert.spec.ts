import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { parseTimeUtc, toVessel } from "../app/api/snapshot/convert";

// Тести перетворювача на синтетичному зразку (data/samples/), без мережі.
const SAMPLE = JSON.parse(
  readFileSync("data/samples/position-report.sample.json", "utf8"),
);

type Patch = {
  meta?: Record<string, unknown>;
  report?: Record<string, unknown>;
  drop?: string[];
};

// Копія зразка зі зміненими або видаленими полями ("MetaData.x", "Report.x").
function sample({ meta = {}, report = {}, drop = [] }: Patch = {}) {
  const copy = structuredClone(SAMPLE);
  Object.assign(copy.MetaData, meta);
  Object.assign(copy.Message.PositionReport, report);
  for (const path of drop) {
    const [where, key] = path.split(".");
    delete (where === "MetaData" ? copy.MetaData : copy.Message.PositionReport)[key];
  }
  return copy;
}

test("зразок перетворюється за правилами спринту", () => {
  expect(toVessel(SAMPLE)).toEqual({
    id: "123456789",
    name: "SYNTHETIC SAMPLE",
    lat: 51.0,
    lon: 1.45,
    speedKnots: 12.4,
    courseDeg: 86.7,
    timestamp: "2026-01-01T12:00:00.123Z",
    source: "aisstream",
  });
});

test("координати - з Message.PositionReport, не з MetaData", () => {
  const vessel = toVessel(
    sample({ meta: { latitude: 10, longitude: 10 }, report: { Latitude: 51.1, Longitude: 1.5 } }),
  );
  expect(vessel).toMatchObject({ lat: 51.1, lon: 1.5 });
});

test.describe("time_utc", () => {
  for (const [input, expected] of [
    ["2024-01-01 12:00:00.123456789 +0000 UTC", "2024-01-01T12:00:00.123Z"],
    ["2024-01-01 12:00:00.12345678 +0000 UTC", "2024-01-01T12:00:00.123Z"],
    ["2024-01-01 12:00:00.9999 +0000 UTC", "2024-01-01T12:00:00.999Z"],
    ["2024-01-01 12:00:00.5 +0000 UTC", "2024-01-01T12:00:00.500Z"],
    ["2024-01-01 12:00:00 +0000 UTC", "2024-01-01T12:00:00.000Z"],
    ["2024-01-01 12:00:00.000 +0230 UTC", "2024-01-01T09:30:00.000Z"],
    ["2024-01-01 00:30:00 -0100 UTC", "2024-01-01T01:30:00.000Z"],
    ["2024-02-29 23:59:59 +0000 UTC", "2024-02-29T23:59:59.000Z"],
  ] as const) {
    test(`${input} -> ${expected}`, () => {
      const ms = parseTimeUtc(input);
      expect(ms === null ? null : new Date(ms).toISOString()).toBe(expected);
    });
  }

  for (const input of [
    "2026-02-30 00:00:00 +0000 UTC",
    "2025-02-29 00:00:00 +0000 UTC",
    "2026-13-01 00:00:00 +0000 UTC",
    "2026-01-01 24:00:00 +0000 UTC",
    "2026-01-01 12:60:00 +0000 UTC",
    "2026-01-01 12:00:60 +0000 UTC",
    "2026-01-01 12:00:00.1234567890 +0000 UTC",
    "2026-01-01T12:00:00Z",
    "2026-01-01 12:00:00 +0000",
    "",
    1767268800000,
    null,
  ]) {
    test(`не парситься: ${JSON.stringify(input)}`, () => {
      expect(parseTimeUtc(input)).toBeNull();
    });
  }
});

test("час не парситься або відсутній - позиція відкидається, час не підставляється", () => {
  expect(toVessel(sample({ meta: { time_utc: "2026-02-30 00:00:00 +0000 UTC" } }))).toBeNull();
  expect(toVessel(sample({ drop: ["MetaData.time_utc"] }))).toBeNull();
});

test("координати поза діапазоном, 91/181, нечислові чи відсутні - позиція відкидається", () => {
  const bad: Patch[] = [
    { report: { Latitude: 91 } },
    { report: { Longitude: 181 } },
    { report: { Latitude: -90.0001 } },
    { report: { Longitude: 180.0001 } },
    { report: { Latitude: "51.0" } },
    { report: { Longitude: null } },
    { drop: ["Report.Latitude"] },
    { drop: ["Report.Longitude"] },
  ];
  for (const patch of bad) expect(toVessel(sample(patch)), JSON.stringify(patch)).toBeNull();
});

test("межі координат приймаються", () => {
  expect(toVessel(sample({ report: { Latitude: -90, Longitude: 180 } }))).toMatchObject({ lat: -90, lon: 180 });
  expect(toVessel(sample({ report: { Latitude: 90, Longitude: -180 } }))).toMatchObject({ lat: 90, lon: -180 });
});

test("невалідна позиція не створює судно в 0,0", () => {
  for (const patch of [{ report: { Latitude: 91, Longitude: 181 } }, { drop: ["Report.Latitude", "Report.Longitude"] }]) {
    expect(toVessel(sample(patch))).toBeNull();
  }
  expect(toVessel(sample({ report: { Latitude: 0, Longitude: 0 } }))).toMatchObject({ lat: 0, lon: 0 });
});

test("MMSI порожній, відсутній чи нечисловий - позиція відкидається", () => {
  for (const mmsi of [null, "", "   ", 1.5, -1, true]) {
    expect(toVessel(sample({ meta: { MMSI: mmsi } })), String(mmsi)).toBeNull();
  }
  expect(toVessel(sample({ drop: ["MetaData.MMSI"] }))).toBeNull();
});

test("швидкість: 0 і межа 102.2 приймаються; 102.3, поза діапазоном, нечислова, відсутня - null", () => {
  expect(toVessel(sample({ report: { Sog: 0 } }))?.speedKnots).toBe(0);
  expect(toVessel(sample({ report: { Sog: 102.2 } }))?.speedKnots).toBe(102.2);
  for (const sog of [102.3, -0.1, 150, "12", null]) {
    const vessel = toVessel(sample({ report: { Sog: sog } }));
    expect(vessel, String(sog)).not.toBeNull();
    expect(vessel?.speedKnots, String(sog)).toBeNull();
  }
  expect(toVessel(sample({ drop: ["Report.Sog"] }))?.speedKnots).toBeNull();
});

test("курс: 0 і 359.9 приймаються; 360, поза діапазоном, нечисловий, відсутній - null", () => {
  expect(toVessel(sample({ report: { Cog: 0 } }))?.courseDeg).toBe(0);
  expect(toVessel(sample({ report: { Cog: 359.9 } }))?.courseDeg).toBe(359.9);
  for (const cog of [360, -1, 400, "90", null]) {
    const vessel = toVessel(sample({ report: { Cog: cog } }));
    expect(vessel, String(cog)).not.toBeNull();
    expect(vessel?.courseDeg, String(cog)).toBeNull();
  }
  expect(toVessel(sample({ drop: ["Report.Cog"] }))?.courseDeg).toBeNull();
});

test("назва: пробіли по краях обрізаються, порожня й відсутня - null, HTML лишається текстом", () => {
  expect(toVessel(sample({ meta: { ShipName: "  NORTH STAR   " } }))?.name).toBe("NORTH STAR");
  expect(toVessel(sample({ meta: { ShipName: "    " } }))?.name).toBeNull();
  expect(toVessel(sample({ meta: { ShipName: 42 } }))?.name).toBeNull();
  expect(toVessel(sample({ drop: ["MetaData.ShipName"] }))?.name).toBeNull();
  expect(toVessel(sample({ meta: { ShipName: "<b>Демо</b>" } }))?.name).toBe("<b>Демо</b>");
});

test("не PositionReport або зламана структура - null", () => {
  expect(toVessel({ ...SAMPLE, MessageType: "SubscriptionConfirmation" })).toBeNull();
  expect(toVessel({ MessageType: "PositionReport" })).toBeNull();
  expect(toVessel(null)).toBeNull();
  expect(toVessel("PositionReport")).toBeNull();
});
