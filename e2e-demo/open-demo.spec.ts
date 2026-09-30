/**
 * Prompt E: with DEMO_OPEN_ACCESS=true on a fictional dataset, anyone can
 * enter by role with one click; the guards hold (no reset, no export, no
 * passkey, test phone numbers only).
 */
import { expect, test } from "@playwright/test";
import { english } from "../e2e/helpers";

test("one click per role, and the open demo's limits", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await english(page);
  await page.getByTestId("try-demo").click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByTestId("open-demo-roles").locator("li")).toHaveCount(6);

  // Founder: straight into the demo guide; no reset, no export, no passkey.
  await page.getByTestId("enter-founder").click();
  await expect(page).toHaveURL(/\/admin\/demo/);
  await expect(page.getByTestId("open-demo-chip")).toBeVisible();
  await expect(page.getByTestId("demo-script")).toBeVisible();
  expect(await page.getByText("Wipe and rebuild").count()).toBe(0);
  expect((await page.request.get("/api/admin/export?dataset=orders")).status()).toBe(403);
  await page.goto("/admin/passkeys");
  await expect(page.getByTestId("passkey-open-demo")).toBeVisible();
  await page.goto("/admin/ecosystem");
  await expect(page.getByTestId("district-map")).toBeVisible();

  // Switch to a champion: a real phone number is refused, a test one works.
  await page.getByTestId("switch-role").click();
  await page.getByTestId("enter-champion").click();
  await expect(page).toHaveURL(/\/home/);
  await page.setViewportSize({ width: 393, height: 851 });
  await expect(page.getByTestId("switch-role")).toBeVisible();
  await page.goto("/customers/new");
  await page.getByLabel("Name or preferred name").fill("Visitor typed (TEST)");
  await page.getByLabel(/Phone number/).fill("+255712345678");
  await page.getByLabel(/consents to transaction messages/).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("use a test number")).toBeVisible();
  await ctx.close();
});
