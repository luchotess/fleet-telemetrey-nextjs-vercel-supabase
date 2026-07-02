import { expect, test } from "@playwright/test";

test("dashboard renders core operations surfaces", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Operations Dashboard" })).toBeVisible();
  await expect(page.getByText("Moving").first()).toBeVisible();
  await expect(page.getByText("Fleet Status")).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();

  await page.getByLabel("Search").fill("v-1");
  await expect(page.getByText("v-1").first()).toBeVisible();
});
