import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:3000";

// Перевірки перетворювача й збирача - без браузера (SPRINT-03).
const NODE_TESTS = /(convert|collector|b14-.*|b15-.*)\.spec\.ts$/;

export default defineConfig({
  testDir: "./tests",
  reporter: "list",
  use: {
    baseURL: BASE_URL,
  },
  projects: [
    // Тести цього проєкту не використовують браузерних fixtures (page тощо).
    { name: "node", testMatch: NODE_TESTS },
    {
      name: "chromium",
      testIgnore: NODE_TESTS,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Dev-сервер запускає сам раннер. Next не дозволяє другий `next dev`
  // у тій самій теці, тому вже запущений сервер використовується повторно.
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Значення з оточення має перевагу над .env.local: сервер тестів без ключа
    // не відкриває живих з'єднань до AISStream.
    env: { AISSTREAM_API_KEY: " " },
  },
});
