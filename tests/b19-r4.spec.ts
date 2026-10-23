import { expect, test, type Page, type Route } from "@playwright/test";

// B-19 (SPRINT-03b): контракт інтерфейсу R4 - показаний набір і результат
// останньої спроби як окремі стани. Відповіді GET /api/snapshot підмінені:
// це доводить поведінку інтерфейсу, не доступність AISStream. Очікування -
// літерали; часи спроб і знімків - з тіл відповідей. Годинник сторінки
// навмисно стоїть на іншій даті: час із браузера дав би інший текст.
// Демо-рух і анімація карти просуваються тільки page.clock.runFor.

const BROWSER_TIME = new Date("2030-05-05T08:00:00.000Z");

// Синтетичні справжні судна.
const A = {
  id: "300000001", name: "СИНТЕТИЧНЕ A", lat: 51.0, lon: 1.45, speedKnots: 10.5,
  courseDeg: 90, timestamp: "2026-10-23T11:59:50.000Z", source: "aisstream",
};
const B = {
  id: "300000002", name: "СИНТЕТИЧНЕ B", lat: 51.1, lon: 1.3, speedKnots: 8,
  courseDeg: 180, timestamp: "2026-10-23T11:59:40.000Z", source: "aisstream",
};
const C = {
  id: "300000003", name: "СИНТЕТИЧНЕ C", lat: 50.9, lon: 1.6, speedKnots: 12,
  courseDeg: 45, timestamp: "2026-10-23T12:00:55.000Z", source: "aisstream",
};
// A у наступному знімку: нова позиція й час.
const A_MOVED = { ...A, lat: 51.05, lon: 1.5, timestamp: "2026-10-23T12:00:58.000Z" };

const success = (collectedAt: string, vessels: object[], truncated = false) => ({
  ok: true, vessels, collectedAt, windowSeconds: 15, count: vessels.length, truncated,
  reason: truncated ? "limit_reached" : "window_elapsed",
});
const failure = (attemptedAt: string, code: string, message: string) => ({
  ok: false, attemptedAt, error: { code, message },
});

type Reply = { status?: number; body?: unknown; raw?: string; networkError?: boolean; gate?: Promise<void> };

// Черга відповідей для /api/snapshot; запит без відповіді в черзі обривається.
async function stubSnapshot(page: Page) {
  const replies: Reply[] = [];
  await page.route("**/api/snapshot", async (route: Route) => {
    const reply = replies.shift();
    if (!reply) return route.abort();
    if (reply.gate) await reply.gate;
    if (reply.networkError) return route.abort("failed");
    return route.fulfill({
      status: reply.status ?? 200,
      contentType: "application/json",
      body: reply.raw ?? JSON.stringify(reply.body),
    });
  });
  return { reply: (next: Reply) => void replies.push(next) };
}

// Керована затримка відповіді: відповідь піде після release().
function hold() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

const vessels = (page: Page) => page.locator("[data-vessel-id]");
const vessel = (page: Page, id: string) => page.locator(`[data-vessel-id="${id}"]`);
const button = (page: Page) => page.getByRole("button", { name: "Завантажити справжні позиції" });
const caption = (page: Page) => page.locator(".panel__source");
const attempt = (page: Page) => page.locator(".panel__attempt");
const hint = (page: Page) => page.locator(".panel__hint");
const card = (page: Page) => page.locator(".vessel-card");
const field = (page: Page, label: string) => card(page).locator(`dt:text-is("${label}") + dd`);

const ids = (page: Page) =>
  vessels(page).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-vessel-id")).sort());

async function iconCenter(page: Page, id: string) {
  const box = await vessel(page, id).boundingBox();
  if (!box) throw new Error(`немає значка ${id}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function mapCenter(page: Page) {
  const box = await page.locator(".sea-map").boundingBox();
  if (!box) throw new Error("немає карти");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const CAPTION_1200 = "AISStream · знімок за 15 с · отримано 12:00:00 UTC · суден: 2 · вибірка неповна";

test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  // Запобіжник: непідмінений запит знімка обривається.
  await page.route("**/api/snapshot", (route) => route.abort());
  await page.clock.install({ time: BROWSER_TIME });
  await page.clock.pauseAt(BROWSER_TIME);
});

async function open(page: Page) {
  const stub = await stubSnapshot(page);
  await page.goto("/");
  await expect(vessels(page)).toHaveCount(3);
  return stub;
}

// Непорожній успіх A+B о 12:00:00 і очікування його стану.
async function loadFirstSuccess(page: Page, stub: Awaited<ReturnType<typeof stubSnapshot>>) {
  stub.reply({ body: success("2026-10-23T12:00:00.000Z", [A, B]) });
  await button(page).click();
  await expect(attempt(page)).toHaveText("Спроба 12:00:00 UTC: отримано суден: 2");
  await expect(caption(page)).toHaveText(CAPTION_1200);
}

test("19.1 до першого натискання рядка спроби немає; підказка є; порядок панелі", async ({ page }) => {
  const stub = await open(page);
  await expect(caption(page)).toHaveText("Демонстраційні дані");
  await expect(attempt(page)).toHaveCount(0);
  await expect(hint(page)).toHaveText("Після оновлення сторінки знову показуються демонстраційні дані");
  await vessel(page, "demo-1").click();
  stub.reply({ body: failure("2026-10-23T12:01:00.000Z", "provider_error", "Джерело повернуло помилку") });
  await button(page).click();
  await expect(attempt(page)).toHaveCount(1);
  const order = await page.locator(".panel > *").evaluateAll((elements) => elements.map((element) => element.className));
  expect(order).toEqual(["panel__load", "panel__source", "panel__attempt", "panel__hint", "vessel-card"]);
});

test("19.2 непорожній успіх: набір замінений, підпис і рядок спроби з часом відповіді, демо зупинене", async ({ page }) => {
  const stub = await open(page);
  await loadFirstSuccess(page, stub);
  expect(await ids(page)).toEqual(["300000001", "300000002"]);
  await expect(page.locator('[data-vessel-id^="demo-"]')).toHaveCount(0);
  await expect(hint(page)).toHaveText("Після оновлення сторінки знову показуються демонстраційні дані");
});

test("19.3 повторне очікування: набір, підпис і картка лишаються, кнопка заблокована, «Завантаження…»", async ({ page }) => {
  const stub = await open(page);
  await loadFirstSuccess(page, stub);
  await vessel(page, "300000001").click();
  const pending = hold();
  stub.reply({ body: success("2026-10-23T12:01:00.000Z", [C]), gate: pending.gate });
  await button(page).click();
  await expect(attempt(page)).toHaveText("Завантаження…");
  await expect(button(page)).toBeDisabled();
  expect(await ids(page)).toEqual(["300000001", "300000002"]);
  await expect(caption(page)).toHaveText(CAPTION_1200);
  await expect(field(page, "Ідентифікатор")).toHaveText("300000001");
  pending.release();
  await expect(attempt(page)).toHaveText("Спроба 12:01:00 UTC: отримано суден: 1");
  await expect(button(page)).toBeEnabled();
});

test("19.4 порожня відповідь 12:01:00 після успіху 12:00:00: підпис і набір збережені", async ({ page }) => {
  const stub = await open(page);
  await loadFirstSuccess(page, stub);
  stub.reply({ body: success("2026-10-23T12:01:00.000Z", []) });
  await button(page).click();
  await expect(attempt(page)).toHaveText("Спроба 12:01:00 UTC: за час збору позицій не отримано");
  await expect(caption(page)).toHaveText(CAPTION_1200);
  expect(await ids(page)).toEqual(["300000001", "300000002"]);
});

test("19.5 помилка 12:01:00 після успіху 12:00:00: набір і підпис збережені", async ({ page }) => {
  const stub = await open(page);
  await loadFirstSuccess(page, stub);
  stub.reply({ status: 502, body: failure("2026-10-23T12:01:00.000Z", "provider_error", "Джерело повернуло помилку") });
  await button(page).click();
  await expect(attempt(page)).toHaveText("Спроба 12:01:00 UTC: не вдалося отримати дані: Джерело повернуло помилку");
  await expect(caption(page)).toHaveText(CAPTION_1200);
  expect(await ids(page)).toEqual(["300000001", "300000002"]);
});

test("19.6 помилка під час демонстрації: демо рухається під час очікування й після невдачі", async ({ page }) => {
  const stub = await open(page);
  await vessel(page, "demo-1").click();
  await expect(field(page, "Координати")).toHaveText("50.80000, 1.20000");
  const pending = hold();
  stub.reply({
    status: 502,
    body: failure("2026-10-23T12:01:00.000Z", "no_api_key", "Ключ AISStream не налаштовано"),
    gate: pending.gate,
  });
  await button(page).click();
  await expect(attempt(page)).toHaveText("Завантаження…");
  await page.clock.runFor(4_000);
  await expect(field(page, "Координати")).toHaveText("50.86000, 1.32000");
  pending.release();
  await expect(attempt(page)).toHaveText("Спроба 12:01:00 UTC: не вдалося отримати дані: Ключ AISStream не налаштовано");
  await expect(caption(page)).toHaveText("Демонстраційні дані");
  await expect(vessels(page)).toHaveCount(3);
  await page.clock.runFor(2_000);
  await expect(field(page, "Координати")).toHaveText("50.89000, 1.38000");
});

test.describe("19.7 вибір після нового непорожнього успіху", () => {
  test("обране судно є в новому наборі - картка показує нові координати й час", async ({ page }) => {
    const stub = await open(page);
    await loadFirstSuccess(page, stub);
    await vessel(page, "300000001").click();
    await expect(field(page, "Координати")).toHaveText("51.00000, 1.45000");
    stub.reply({ body: success("2026-10-23T12:01:00.000Z", [A_MOVED, C]) });
    await button(page).click();
    await expect(attempt(page)).toHaveText("Спроба 12:01:00 UTC: отримано суден: 2");
    await expect(field(page, "Ідентифікатор")).toHaveText("300000001");
    await expect(field(page, "Координати")).toHaveText("51.05000, 1.50000");
    await expect(field(page, "Час повідомлення")).toHaveText("12:00:58 UTC");
    expect(await ids(page)).toEqual(["300000001", "300000003"]);
  });

  test("обраного судна немає в новому наборі - картка закрита", async ({ page }) => {
    const stub = await open(page);
    await loadFirstSuccess(page, stub);
    await vessel(page, "300000002").click();
    await expect(field(page, "Ідентифікатор")).toHaveText("300000002");
    stub.reply({ body: success("2026-10-23T12:01:00.000Z", [A_MOVED, C]) });
    await button(page).click();
    await expect(attempt(page)).toHaveText("Спроба 12:01:00 UTC: отримано суден: 2");
    await expect(card(page)).toHaveCount(0);
    expect(await ids(page)).toEqual(["300000001", "300000003"]);
  });
});

test("19.8 судно без швидкості й курсу - «Немає даних», нейтральний значок", async ({ page }) => {
  const stub = await open(page);
  stub.reply({
    body: success("2026-10-23T12:00:00.000Z", [{ ...A, speedKnots: null, courseDeg: null }]),
  });
  await button(page).click();
  await expect(vessel(page, "300000001")).toHaveAttribute("data-icon", "neutral");
  await vessel(page, "300000001").click();
  await expect(field(page, "Швидкість")).toHaveText("Немає даних");
  await expect(field(page, "Курс")).toHaveText("Немає даних");
});

test("19.9 truncated - підпис закінчується на « · зупинено на ліміті 100»", async ({ page }) => {
  const stub = await open(page);
  stub.reply({ body: success("2026-10-23T12:00:00.000Z", [A, B], true) });
  await button(page).click();
  await expect(caption(page)).toHaveText(
    "AISStream · знімок за 15 с · отримано 12:00:00 UTC · суден: 2 · вибірка неповна · зупинено на ліміті 100",
  );
});

test("19.10 перший непорожній успіх повертає початковий вид; другий після зсуву - центр і масштаб без змін", async ({ page }) => {
  const stub = await open(page);
  await loadFirstSuccess(page, stub);
  await page.clock.runFor(1_000);
  // A (51.0, 1.45) - центр початкового виду.
  expect(distance(await iconCenter(page, "300000001"), await mapCenter(page))).toBeLessThan(2);

  await page.locator(".sea-map").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.clock.runFor(1_000);
  const shiftedA = await iconCenter(page, "300000001");
  const shiftedB = await iconCenter(page, "300000002");
  expect(distance(shiftedA, await mapCenter(page))).toBeGreaterThan(50);

  // Ті самі A і B в новому знімку: однакові екранні позиції - той самий центр і масштаб.
  stub.reply({ body: success("2026-10-23T12:01:00.000Z", [A, B, C]) });
  await button(page).click();
  await expect(attempt(page)).toHaveText("Спроба 12:01:00 UTC: отримано суден: 3");
  await page.clock.runFor(1_000);
  expect(distance(await iconCenter(page, "300000001"), shiftedA)).toBeLessThan(1);
  expect(distance(await iconCenter(page, "300000002"), shiftedB)).toBeLessThan(1);
});

test("19.11 справжні судна нерухомі: кілька тіків page.clock не змінюють координат", async ({ page }) => {
  const stub = await open(page);
  await loadFirstSuccess(page, stub);
  await vessel(page, "300000001").click();
  await page.clock.runFor(1_000);
  const before = { a: await iconCenter(page, "300000001"), b: await iconCenter(page, "300000002") };
  await page.clock.runFor(10_000);
  await expect(field(page, "Координати")).toHaveText("51.00000, 1.45000");
  await expect(field(page, "Час повідомлення")).toHaveText("11:59:50 UTC");
  expect(await iconCenter(page, "300000001")).toEqual(before.a);
  expect(await iconCenter(page, "300000002")).toEqual(before.b);
});

test.describe("19.12 немає відповіді сервера - рядок без часу, набір збережений", () => {
  const cases: [string, Reply][] = [
    ["відповідь без тіла", { status: 200, raw: "" }],
    ["нерозбірне тіло", { status: 200, raw: "<html>not json</html>" }],
    ["мережева помилка", { networkError: true }],
    ["тіло без потрібних полів", { status: 502, body: { ok: false, error: { code: "internal" } } }],
  ];
  for (const [name, reply] of cases) {
    test(name, async ({ page }) => {
      const stub = await open(page);
      await loadFirstSuccess(page, stub);
      stub.reply(reply);
      await button(page).click();
      await expect(attempt(page)).toHaveText("Спроба: не вдалося отримати дані: Немає відповіді сервера");
      await expect(caption(page)).toHaveText(CAPTION_1200);
      expect(await ids(page)).toEqual(["300000001", "300000002"]);
      await expect(button(page)).toBeEnabled();
    });
  }
});

test("19.13 підказка постійна: до натискання, після успіху й після помилки", async ({ page }) => {
  const stub = await open(page);
  const text = "Після оновлення сторінки знову показуються демонстраційні дані";
  await expect(hint(page)).toHaveText(text);
  await loadFirstSuccess(page, stub);
  await expect(hint(page)).toHaveText(text);
  stub.reply({ status: 502, body: failure("2026-10-23T12:01:00.000Z", "disconnected", "З'єднання з джерелом розірвано") });
  await button(page).click();
  await expect(attempt(page)).toHaveText("Спроба 12:01:00 UTC: не вдалося отримати дані: З'єднання з джерелом розірвано");
  await expect(hint(page)).toHaveText(text);
});
