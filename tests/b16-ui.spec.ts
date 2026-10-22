import { expect, test, type Page } from "@playwright/test";

// B-16 (SPRINT-03): рух демо-суден і стани інтерфейсу R2, браузерний проєкт.
// Рух - браузерний годинник page.clock (без waitForTimeout); він керує лише
// таймерами й часом сторінки. Стани R2 - підміною відповіді власного
// GET /api/snapshot: серверний збирач у цих тестах не задіяний, і page.clock
// ним не керує. Очікування - літерали із затвердженої таблиці B-16.

const T0 = new Date("2026-10-23T12:00:00.000Z");

test.beforeEach(async ({ page }) => {
  // Тайли тестам не потрібні; тест не залежить від мережі.
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  // Запобіжник: непідмінений запит знімка обривається, живого запиту немає.
  await page.route("**/api/snapshot", (route) => route.abort());
});

const vessels = (page: Page) => page.locator("[data-vessel-id]");
const vessel = (page: Page, id: string) => page.locator(`[data-vessel-id="${id}"]`);
const caption = (page: Page) => page.locator(".panel__source");
const note = (page: Page) => page.locator(".panel__message");
const card = (page: Page) => page.locator(".vessel-card");
const field = (page: Page, label: string) =>
  card(page).locator(`dt:text-is("${label}") + dd`);

// Картка демо-судна: координати, швидкість, курс, час.
async function expectCard(
  page: Page,
  expected: { coords: string; speed: string; course: string; time: string },
) {
  await expect(field(page, "Ідентифікатор")).toHaveText("demo-1");
  await expect(field(page, "Координати")).toHaveText(expected.coords);
  await expect(field(page, "Швидкість")).toHaveText(expected.speed);
  await expect(field(page, "Курс")).toHaveText(expected.course);
  await expect(field(page, "Час повідомлення")).toHaveText(expected.time);
}

// Положення значка на екрані й поворот за курсом.
async function iconState(page: Page, id: string) {
  const icon = vessel(page, id);
  const box = await icon.boundingBox();
  return {
    x: box ? Math.round(box.x) : null,
    y: box ? Math.round(box.y) : null,
    transform: await icon.evaluate((element) => (element as HTMLElement).style.transform),
  };
}

test.describe("рух демо-суден (page.clock)", () => {
  test.beforeEach(async ({ page }) => {
    // Годинник сторінки зупинений на T0 до завантаження: демотаймер стартує о T0.
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T0);
    await page.goto("/");
    await expect(vessels(page)).toHaveCount(3);
    await vessel(page, "demo-1").click();
  });

  test("16.1 старт: перша точка, курс до другої точки, час запуску", async ({ page }) => {
    await expectCard(page, {
      coords: "50.80000, 1.20000",
      speed: "12.3 kn",
      course: "52°",
      time: "12:00:00 UTC",
    });
  });

  test("16.2 три тіки: позиція змінилась, картка показує нові координати", async ({ page }) => {
    const before = await iconState(page, "demo-1");
    await page.clock.runFor(6_000);
    await expectCard(page, {
      coords: "50.89000, 1.38000",
      speed: "12.3 kn",
      course: "52°",
      time: "12:00:06 UTC",
    });
    const after = await iconState(page, "demo-1");
    expect({ x: after.x, y: after.y }).not.toEqual({ x: before.x, y: before.y });
  });

  test("16.3-16.4 кінець маршруту: 0 kn тим самим тіком, далі нічого не змінюється", async ({ page }) => {
    await page.clock.runFor(18_000);
    const atEnd = {
      coords: "51.07000, 1.74000",
      speed: "0 kn",
      course: "51°",
      time: "12:00:18 UTC",
    };
    await expectCard(page, atEnd);
    const iconAtEnd = await iconState(page, "demo-1");

    await page.clock.runFor(12_000);
    await expectCard(page, atEnd);
    expect(await iconState(page, "demo-1")).toEqual(iconAtEnd);
  });
});

test.describe("стани R2 (підміна GET /api/snapshot)", () => {
  async function loadWith(page: Page, status: number, body: unknown) {
    await page.route("**/api/snapshot", (route) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
    );
    await page.goto("/");
    // Перед спробою на карті демонстрація.
    await expect(vessels(page)).toHaveCount(3);
    await page.getByRole("button", { name: "Завантажити справжні позиції" }).click();
  }

  test("16.5 помилка -> суден немає, підпис і повідомлення помилки", async ({ page }) => {
    await loadWith(page, 502, {
      ok: false,
      attemptedAt: "2026-10-23T09:00:00.000Z",
      error: { code: "provider_error", message: "Джерело повернуло помилку" },
    });
    await expect(caption(page)).toHaveText("Даних на карті немає");
    await expect(note(page)).toHaveText("Не вдалося отримати дані: Джерело повернуло помилку");
    await expect(vessels(page)).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
  });

  test("16.6 порожня відповідь -> суден: 0 і повідомлення, суден немає", async ({ page }) => {
    await loadWith(page, 200, {
      ok: true,
      vessels: [],
      collectedAt: "2026-10-23T09:08:07.654Z",
      windowSeconds: 15,
      count: 0,
      truncated: false,
      reason: "window_elapsed",
    });
    await expect(caption(page)).toHaveText(
      "AISStream · знімок за 15 с · отримано 09:08:07 UTC · суден: 0 · вибірка неповна",
    );
    await expect(note(page)).toHaveText("За час збору позицій не отримано");
    await expect(vessels(page)).toHaveCount(0);
  });

  test("16.7 судно без швидкості й курсу -> «Немає даних», data-icon=neutral", async ({ page }) => {
    await loadWith(page, 200, {
      ok: true,
      vessels: [
        {
          id: "200000001",
          name: null,
          lat: 51.0,
          lon: 1.45,
          speedKnots: null,
          courseDeg: null,
          timestamp: "2026-10-23T09:08:00.000Z",
          source: "aisstream",
        },
      ],
      collectedAt: "2026-10-23T09:08:07.654Z",
      windowSeconds: 15,
      count: 1,
      truncated: false,
      reason: "window_elapsed",
    });
    await expect(caption(page)).toHaveText(
      "AISStream · знімок за 15 с · отримано 09:08:07 UTC · суден: 1 · вибірка неповна",
    );
    await expect(vessels(page)).toHaveCount(1);
    await expect(vessel(page, "200000001")).toHaveAttribute("data-icon", "neutral");
    await vessel(page, "200000001").click();
    await expect(field(page, "Ідентифікатор")).toHaveText("200000001");
    await expect(field(page, "Назва")).toHaveText("Немає даних");
    await expect(field(page, "Координати")).toHaveText("51.00000, 1.45000");
    await expect(field(page, "Швидкість")).toHaveText("Немає даних");
    await expect(field(page, "Курс")).toHaveText("Немає даних");
    await expect(field(page, "Час повідомлення")).toHaveText("09:08:00 UTC");
    await expect(field(page, "Джерело")).toHaveText("AISStream");
  });
});
