/** @file Browser regressions for the shipped arbitrary-log workflow. */

import { expect, test, type Page } from "@playwright/test";

test.setTimeout(180_000);

/** Keeps browser regressions deterministic while route tests cover live adapters. */
async function installTestRankingBackend(page: Page) {
  await page.route("**/api/queue", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/rank", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as Record<string, unknown>;
    const response = await route.fetch({
      postData: JSON.stringify({ ...body, provider: "demo" }),
    });
    await route.fulfill({ response });
  });
}

/** Imports one canonical JSON log through the same controls a reviewer uses. */
async function analyzeLog(page: Page, log: unknown) {
  await page.getByRole("button", { name: "Analyze a log" }).click();
  await page.getByRole("textbox", { name: "Paste conversation log" }).fill(JSON.stringify(log));
  await page.getByRole("button", { name: "Preview conversation" }).click();
  await page.getByRole("button", { name: /Analyze \d+ messages/ }).click();
  const conversationId = (log as { conversationId?: string }).conversationId;
  if (conversationId) {
    await expect(page.getByRole("heading", { name: conversationId })).toBeVisible({ timeout: 120_000 });
  }
  await expect(page.getByRole("heading", { name: "Plausible readings" })).toBeVisible();
}

test("grounds every generated candidate in the dentist, flights, and apology tasks", async ({ page }) => {
  await installTestRankingBackend(page);
  await page.goto("/");
  await analyzeLog(page, {
    conversationId: "open-set-browser",
    userId: "reviewer",
    messages: [
      { id: "M1", text: "Book a dentist appointment for next Tuesday.", timestamp: "2026-08-14T09:00:00Z" },
      { id: "M2", text: "Compare flights from London to Lisbon.", timestamp: "2026-08-14T09:01:00Z" },
      { id: "M3", text: "No CSV, no slides, no dashboard. Write the apology email.", timestamp: "2026-08-14T09:02:00Z" },
    ],
  });

  await expect(page.getByRole("heading", { level: 3, name: /dentist appointment/i })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: /compare flights/i })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: /write the apology email/i })).toBeVisible();
  await expect(page.getByText("Deliver structured data", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Prepare a visual presentation", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Publish an interactive dashboard", { exact: true })).toHaveCount(0);
});

test("keeps the resumed rate-limiting proposal in scope after deferred MCP questions", async ({ page }) => {
  await installTestRankingBackend(page);
  await page.goto("/");
  await analyzeLog(page, {
    conversationId: "finance-follow-up-browser",
    userId: "finance-user",
    domain: { name: "finance" },
    messages: [
      "We eventually need a finance monitoring dashboard.",
      "First assess rate limiting for the ingestion service.",
      "Write one concise implementation proposal for rate limiting.",
      "No dashboard yet; defer that work until the proposal is approved.",
      "Include rollout, retry budgets, and ownership in the proposal.",
      "For the deferred dashboard, could MCP help later?",
      "No MCP now, just get the proposal done.",
    ].map((text, index) => ({
      id: `M${index + 1}`,
      text,
      timestamp: `2026-08-14T09:0${index}:00Z`,
    })),
  });

  const proposal = page.getByRole("button").filter({
    hasText: "Write one concise implementation proposal for rate limiting",
  });
  await expect(proposal).toContainText("1");
  await expect(page.getByText("Decision ready")).toBeVisible();
  await expect(page.getByText(/Should I proceed/)).toHaveCount(0);
});
