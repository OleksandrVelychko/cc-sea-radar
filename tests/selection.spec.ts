import { expect, test, type Page } from "@playwright/test";

// Тести вибору: рух не перевіряють (керований час - реліз R3).
const VESSEL_IDS = ["demo-1", "demo-2", "demo-3"];

// Судна шукаються тільки за data-vessel-id.
function vessel(page: Page, id: string) {
  return page.locator(`[data-vessel-id="${id}"]`);
}

function cardId(page: Page) {
  return page.locator(".vessel-card dt:text-is('Ідентифікатор') + dd");
}

// Тайли тестам не потрібні: запити до OSM обриваються, тест не залежить від мережі.
test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.goto("/");
});

test("на сторінці рівно три судна", async ({ page }) => {
  const vessels = page.locator("[data-vessel-id]");
  await expect(vessels).toHaveCount(3);
  const ids = await vessels.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-vessel-id")),
  );
  expect(ids.sort()).toEqual(VESSEL_IDS);
});

for (const id of VESSEL_IDS) {
  test(`клік по ${id} відкриває картку з його id`, async ({ page }) => {
    await expect(page.locator(".vessel-card")).toHaveCount(0);
    await vessel(page, id).click();
    await expect(cardId(page)).toHaveText(id);
  });
}

test("повторний клік не закриває картку", async ({ page }) => {
  await vessel(page, "demo-2").click();
  await expect(cardId(page)).toHaveText("demo-2");
  await vessel(page, "demo-2").click();
  await expect(cardId(page)).toHaveText("demo-2");
});
