import { test, expect } from "@playwright/test";

/**
 * Playwright E2E smoke spec for the web app.
 *
 * NOTE: this runs under Playwright (`playwright test`), NOT under Vitest — the
 * Vitest config only matches *.eval.ts. It is included here as the E2E artifact
 * and is typechecked by the package. To execute it, start the web app and run
 * Playwright against http://localhost:3000.
 */
const BASE_URL = process.env.WEB_BASE_URL ?? "http://localhost:3000";

test.describe("web smoke", () => {
  test("rep dashboard renders the ranked priority list", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await expect(page.getByRole("heading", { name: "Rep Dashboard" })).toBeVisible();
  });

  test("admin scoring page shows the deterministic config", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/scoring`);
    await expect(
      page.getByRole("heading", { name: "Admin · Scoring Configuration" }),
    ).toBeVisible();
  });
});
