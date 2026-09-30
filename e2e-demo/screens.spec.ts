/**
 * The seven beats of the demo script (docs/PROMPT_DEMO_POLISH.md §4) as
 * screenshots: the deck's backup and its illustrations. Runs on the demo
 * dataset only (playwright.demo.config.ts).
 */
import { mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { SEED, adminLogin, english, fieldLogin } from "../e2e/helpers";

const OUT = "docs/demo-screens";
const CRON_SECRET = process.env.CRON_SECRET ?? "demo-cron-secret";

async function lastSms(request: APIRequestContext, purpose: string): Promise<string | null> {
  const r = await request.post("/dev/simulator/api", { headers: { authorization: `Bearer ${CRON_SECRET}` }, data: { op: "lastSms", purpose } });
  if (!r.ok()) return null;
  const body = (await r.json()) as { body?: string } | null;
  return body?.body ?? null;
}

/** Wait for hydration before the shot and leave the caret alone: Playwright's caret hiding mutates inputs and trips React's hydration check in dev. */
async function shot(target: Page | Locator, path: string, fullPage = false): Promise<void> {
  const page = "page" in target ? target.page() : target;
  await page.waitForLoadState("networkidle");
  if ("page" in target) await target.screenshot({ path, caret: "initial" });
  else await target.screenshot({ path, fullPage, caret: "initial" });
}

test("seven beats", async ({ browser, request }) => {
  mkdirSync(OUT, { recursive: true });
  const admin = await adminLogin(browser, SEED.adminA);
  await english(admin.page);
  const { page } = admin;

  await page.goto("/");
  await shot(page, `${OUT}/1-landing.png`, true);

  await page.goto("/admin/present?window=7d");
  await expect(page.getByTestId("district-map")).toBeVisible();
  await shot(page, `${OUT}/2-district-map.png`, true);

  await page.getByTestId("map-tick-hour").click();
  await expect(page.getByTestId("map-ticked")).toBeVisible();
  await page.getByTestId("district-map").scrollIntoViewIfNeeded();
  await shot(page.getByTestId("district-map"), `${OUT}/3-one-hour-later.png`);

  await page.goto("/admin/approvals");
  await shot(page, `${OUT}/7-approvals.png`, false);
  await page.goto("/admin/messages");
  await shot(page, `${OUT}/4b-messages.png`, false);

  const receipt = await lastSms(request, "RECEIPT");
  const link = receipt?.match(/https?:\/\/\S+\/verify\/[A-Za-z0-9_-]+(\?t=[A-Za-z0-9_-]+)?/)?.[0];
  if (link) {
    await page.goto(new URL(link).pathname + new URL(link).search);
    await shot(page, `${OUT}/6-verify.png`, true);
  }
  await admin.ctx.close();

  const champ = await fieldLogin(browser, SEED.champions[0]!.phone, SEED.champions[0]!.pin);
  await champ.page.setViewportSize({ width: 393, height: 851 });
  await english(champ.page);
  await shot(champ.page, `${OUT}/4-champion-home.png`, true);
  await champ.page.goto("/customers");
  await shot(champ.page, `${OUT}/5-customers.png`, true);
  await champ.ctx.close();
});
