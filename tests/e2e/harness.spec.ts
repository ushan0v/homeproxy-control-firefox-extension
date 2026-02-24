import { expect, test, type APIRequestContext } from "@playwright/test";

const API_BASE_URL = "http://127.0.0.1:7878";
const API_TOKEN = "playwright-token";

interface MockRequestLog {
  at: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

interface MockLogsResponse {
  logs?: MockRequestLog[];
}

async function resetMockLogs(request: APIRequestContext): Promise<void> {
  await request.post(`${API_BASE_URL}/__mock/reset`);
}

async function readMockLogs(request: APIRequestContext): Promise<MockRequestLog[]> {
  const response = await request.get(`${API_BASE_URL}/__mock/logs`);
  const payload = (await response.json()) as MockLogsResponse;
  return Array.isArray(payload.logs) ? payload.logs : [];
}

function countByPath(logs: MockRequestLog[], path: string): number {
  return logs.filter((entry) => entry.path === path).length;
}

test.beforeEach(async ({ request }) => {
  await resetMockLogs(request);
});

test("playwright harness: auth, dashboard flow and sniffer flow", async ({ page, request }) => {
  await page.goto("/?harness=1");
  await expect(page.getByText("Первичная настройка подключения к API")).toBeVisible();

  await page.getByTestId("api-url-input").fill(API_BASE_URL);
  await page.getByTestId("api-token-input").fill(API_TOKEN);
  await page.getByTestId("api-save-button").click();

  await expect(page.getByTestId("nav-dashboard")).toBeVisible();
  await expect(page.getByText("Быстрое добавление")).toBeVisible();

  await expect
    .poll(async () => {
      const logs = await readMockLogs(request);
      return countByPath(logs, "/healthz");
    })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const logs = await readMockLogs(request);
      return countByPath(logs, "/rules");
    })
    .toBeGreaterThan(0);

  const authLogs = await readMockLogs(request);
  const healthz = authLogs.find((entry) => entry.path === "/healthz");
  expect(healthz?.headers?.authorization).toBe(`Bearer ${API_TOKEN}`);
  expect(healthz?.headers?.["x-access-token"]).toBe(API_TOKEN);

  await page.getByTestId("nav-settings").click();
  await expect(page.getByText("Быстрые действия")).toBeVisible();

  await page.getByTestId("nav-dashboard").click();
  await page.getByTestId("dashboard-quick-input").fill("video.example.com");
  await page.getByTestId("dashboard-quick-submit").click();
  await page.getByTestId("dashboard-scope-root").click();
  await page.getByTestId("dashboard-rule-rule_1").click();

  await expect(page.getByTestId("workspace-apply-bar")).toBeVisible();

  await expect
    .poll(async () => {
      const logs = await readMockLogs(request);
      return countByPath(logs, "/rules/update");
    })
    .toBe(0);

  await page.getByTestId("workspace-apply").click();

  await expect
    .poll(async () => {
      const logs = await readMockLogs(request);
      return countByPath(logs, "/rules/update");
    })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const logs = await readMockLogs(request);
      return countByPath(logs, "/rules/hot-reload");
    })
    .toBeGreaterThan(0);

  await page.evaluate(() => {
    const harness = (
      window as typeof window & {
        __HOMEPROXY_HARNESS__?: {
          pushSnifferItem: (item: Record<string, unknown>) => void;
          setActiveTabUrl: (url: string) => void;
        };
      }
    ).__HOMEPROXY_HARNESS__;

    if (!harness) {
      throw new Error("Harness is not enabled");
    }

    const now = Date.now();
    harness.setActiveTabUrl("https://youtube.com/watch?v=playwright-harness");
    harness.pushSnifferItem({
      domain: "media.youtube.com",
      url: "https://media.youtube.com/watch?v=playwright-harness",
      method: "GET",
      type: "xmlhttprequest",
      status: "Error",
      statusCode: 0,
      durationMs: 15,
      timestamp: now - 1500,
      error: "NS_ERROR_NET_RESET",
    });
    harness.pushSnifferItem({
      domain: "media.youtube.com",
      url: "https://media.youtube.com/watch?v=playwright-harness",
      method: "GET",
      type: "xmlhttprequest",
      status: "Unknown",
      statusCode: 200,
      durationMs: 28,
      timestamp: now - 1000,
      error: "",
    });
    harness.pushSnifferItem({
      domain: "cdn.youtube.com",
      url: "https://cdn.youtube.com/v1/ping",
      method: "GET",
      type: "xmlhttprequest",
      status: "Error",
      statusCode: 0,
      durationMs: 42,
      timestamp: now - 500,
      error: "NS_ERROR_OFFLINE",
    });
  });

  await page.getByTestId("nav-sniffer").click();
  await expect(page.getByText("media.youtube.com")).toBeVisible();
  await expect(page.getByTestId("sniffer-error-toggle-media-youtube-com")).toHaveCount(0);

  const cdnErrorToggle = page.getByTestId("sniffer-error-toggle-cdn-youtube-com");
  await expect(cdnErrorToggle).toBeVisible();
  await cdnErrorToggle.click();
  await expect(page.getByTestId("sniffer-error-panel-cdn-youtube-com")).toContainText("NS_ERROR_OFFLINE");
  await cdnErrorToggle.click();
  await expect(page.getByTestId("sniffer-error-panel-cdn-youtube-com")).toHaveCount(0);

  await page.getByRole("button", { name: "Добавить правило" }).first().click();
  await page.getByTestId("sniffer-scope-root").click();
  await page.getByTestId("sniffer-rule-rule_1").click();

  await expect(page.getByTestId("workspace-apply-bar")).toBeVisible();
  await page.getByTestId("workspace-apply").click();

  await expect
    .poll(async () => {
      const logs = await readMockLogs(request);
      return countByPath(logs, "/rules/update");
    })
    .toBeGreaterThan(1);
});

test("rules tab supports drag-and-drop reordering by handle", async ({ page }) => {
  await page.goto("/?harness=1");

  await page.getByTestId("api-url-input").fill(API_BASE_URL);
  await page.getByTestId("api-token-input").fill(API_TOKEN);
  await page.getByTestId("api-save-button").click();
  await expect(page.getByTestId("nav-rules")).toBeVisible();

  await page.getByTestId("nav-rules").click();

  const ruleButtons = page.locator("button.min-w-0.flex-1.text-left");
  await expect(ruleButtons).toHaveCount(3);
  await expect(ruleButtons.nth(0)).toContainText("Proxy US");
  await expect(ruleButtons.nth(1)).toContainText("Direct Home");
  await expect(ruleButtons.nth(2)).toContainText("Block Ads");

  const handles = page.getByRole("button", { name: "Изменить порядок правила" });
  const source = handles.nth(2);
  const target = handles.nth(0);

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error("Unable to read drag handle bounds");
  }

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y - 120, { steps: 24 });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 24 });
  await page.mouse.up();

  await expect(ruleButtons.nth(0)).toContainText("Block Ads");
  await expect(ruleButtons.nth(1)).toContainText("Proxy US");
  await expect(ruleButtons.nth(2)).toContainText("Direct Home");
  await expect(page.getByTestId("workspace-apply-bar")).toBeVisible();
});

test("pending rule card can be reordered against existing rules", async ({ page }) => {
  await page.goto("/?harness=1");

  await page.getByTestId("api-url-input").fill(API_BASE_URL);
  await page.getByTestId("api-token-input").fill(API_TOKEN);
  await page.getByTestId("api-save-button").click();
  await expect(page.getByTestId("nav-rules")).toBeVisible();
  await page.getByTestId("nav-rules").click();

  const addRuleButton = page.locator("div.space-y-3.p-3.pb-3").getByRole("button", { name: "Добавить правило" });
  await addRuleButton.click();
  await page.getByPlaceholder("Имя нового правила").fill("Pending mixed");
  await page.locator("button").filter({ hasText: /^Добавить$/ }).last().click();

  const pendingCard = page.locator("div.group.overflow-hidden.rounded-xl").filter({ hasText: "Pending mixed" }).first();
  const existingCard = page.locator("div.group.overflow-hidden.rounded-xl").filter({ hasText: "Proxy US" }).first();
  const pendingHandle = pendingCard.getByRole("button", { name: "Изменить порядок правила" }).first();
  const existingHandle = existingCard.getByRole("button", { name: "Изменить порядок правила" }).first();

  const pendingBox = await pendingHandle.boundingBox();
  const existingBox = await existingHandle.boundingBox();
  if (!pendingBox || !existingBox) {
    throw new Error("Unable to read drag handles for pending-existing reorder");
  }

  await page.mouse.move(pendingBox.x + pendingBox.width / 2, pendingBox.y + pendingBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(existingBox.x + existingBox.width / 2, existingBox.y + existingBox.height * 1.8, { steps: 24 });
  await page.mouse.up();

  const pendingCardY = (await pendingCard.boundingBox())?.y;
  const existingCardY = (await existingCard.boundingBox())?.y;
  if (typeof pendingCardY !== "number" || typeof existingCardY !== "number") {
    throw new Error("Unable to verify pending-existing card positions after drag");
  }
  expect(pendingCardY).toBeGreaterThan(existingCardY);
  await expect(page.getByTestId("workspace-apply-bar")).toBeVisible();
});

test("service toggle shows loading state while API request is in flight", async ({ page, request }) => {
  await page.goto("/?harness=1");

  await page.getByTestId("api-url-input").fill(API_BASE_URL);
  await page.getByTestId("api-token-input").fill(API_TOKEN);
  await page.getByTestId("api-save-button").click();
  await expect(page.getByTestId("nav-dashboard")).toBeVisible();

  await page.route("**/homeproxy/stop", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1400));
    await route.continue();
  });

  const serviceToggleButton = page.getByTestId("service-toggle-button");
  await serviceToggleButton.click();

  await expect(serviceToggleButton).toHaveAttribute("aria-label", /Выключаем/);
  await expect(serviceToggleButton).toBeDisabled();

  await expect(serviceToggleButton).toHaveAttribute("aria-label", "Включить службу HomeProxy");
  await expect(serviceToggleButton).toBeEnabled();

  await expect
    .poll(async () => {
      const logs = await readMockLogs(request);
      return countByPath(logs, "/homeproxy/stop");
    })
    .toBeGreaterThan(0);
});
