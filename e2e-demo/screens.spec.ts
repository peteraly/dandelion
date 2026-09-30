/**
 * The demo script (docs/PROMPT_DEMO_POLISH.md §4) as screenshots: the deck's
 * backup and a walkthrough for anyone who cannot sign in. Runs on a
 * throwaway demo dataset only (playwright.demo.config.ts).
 */
import { mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { SEED, adminLogin, english, fieldLogin } from "../e2e/helpers";

const OUT = "docs/demo-screens";
const CRON_SECRET = process.env.CRON_SECRET ?? "demo-cron-secret";
const PHONE = { width: 393, height: 851 };

async function sim(request: APIRequestContext, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const r = await request.post("/dev/simulator/api", { headers: { authorization: `Bearer ${CRON_SECRET}` }, data: body });
  return r.ok() ? ((await r.json()) as Record<string, unknown> | null) : null;
}
async function lastSms(request: APIRequestContext, purpose: string): Promise<string> {
  return ((await sim(request, { op: "lastSms", purpose })) as { body?: string } | null)?.body ?? "";
}
const code = (body: string) => body.match(/\b(\d{6})\b/)?.[1] ?? "";

/** Wait for hydration and keep the caret: Playwright's caret hiding mutates inputs and trips React's hydration check in dev. */
async function shot(target: Page | Locator, name: string, fullPage = false): Promise<void> {
  const page = "page" in target ? target.page() : target;
  await page.waitForLoadState("networkidle");
  if ("page" in target) await target.screenshot({ path: `${OUT}/${name}.png`, caret: "initial" });
  else await target.screenshot({ path: `${OUT}/${name}.png`, fullPage, caret: "initial" });
}

test("the whole demo, beat by beat", async ({ browser, request }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });

  // 1 — the promise
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const home = await visitor.newPage();
  await home.goto("/");
  await english(home);
  await shot(home, "01-landing", true);
  await visitor.close();

  // 2–4 — the founders' view
  const admin = await adminLogin(browser, SEED.adminA);
  await english(admin.page);
  const a = admin.page;
  await a.goto("/admin/demo");
  await shot(a, "02-demo-guide", true);
  await a.goto("/admin/ecosystem?window=7d");
  await shot(a, "03-ecosystem", false);
  await a.goto("/admin/present?window=7d");
  await expect(a.getByTestId("district-map")).toBeVisible();
  await shot(a.getByTestId("district-map"), "04-district-map");
  await a.getByTestId("map-tick-hour").click();
  await expect(a.getByTestId("map-ticked")).toBeVisible();
  await shot(a.getByTestId("district-map"), "05-one-hour-later");
  await a.goto("/admin/ecosystem?window=7d&attention=lockedBatches");
  await shot(a.getByTestId("district-map"), "06-attention-locked-batches");
  // The admin home answers first; a click on any place opens its details on the map.
  await a.goto("/admin");
  await expect(a.getByTestId("needs-you")).toBeVisible();
  await shot(a, "06b-admin-home", true);
  await a.setViewportSize({ width: 1440, height: 1000 });
  await a.goto("/admin/ecosystem?window=7d");
  await a.locator('[data-testid="map-tile"][data-kind="HUB"]').first().click();
  await expect(a.getByTestId("focus-panel")).toBeVisible();
  await shot(a, "06c-map-focus", false);

  // 7–11 — a champion's phone: consent, plan, the provider's confirmation, handover, receipt
  const champ = await fieldLogin(browser, SEED.champions[0]!.phone, SEED.champions[0]!.pin);
  const c = champ.page;
  await c.setViewportSize(PHONE);
  await english(c);
  await shot(c, "07-champion-home", true);
  await c.goto("/customers/new");
  await c.getByLabel("Name or preferred name").fill("Neema (TEST)");
  await c.getByLabel(/Phone number/).fill("+255700009990");
  await c.getByLabel(/consents to transaction messages/).check();
  await shot(c, "08-enrol-with-consent", true);
  await c.getByRole("button", { name: "Continue" }).click();
  await expect(c).toHaveURL(/challenge=/);
  await c.getByLabel("Enter the code").fill(code(await lastSms(request, "OTP")));
  await c.getByRole("button", { name: "Confirm" }).click();
  await c.getByRole("radio").first().check();
  await c.getByRole("button", { name: "Start purchase plan" }).click();
  await expect(c.getByRole("heading", { name: "Installment plan active" })).toBeVisible();
  await shot(c, "09-plan-started", true);
  const ref = (await c.locator("span.font-mono").first().innerText()).trim();
  const orderUrl = c.url();
  await sim(request, { op: "simulate", scenario: "success", orderRef: ref });
  await c.goto(orderUrl);
  await shot(c, "10-paid-in-full", true);
  const start = c.getByRole("button", { name: "Start handover" });
  if (await start.count()) {
    await start.click();
    await expect(c.getByRole("heading", { name: "Handover required" })).toBeVisible();
    for (const box of await c.locator('input[type="checkbox"]').all()) await box.check();
    await c.getByLabel("Customer's code").fill(code(await lastSms(request, "HANDOVER_CODE")));
    await c.getByRole("button", { name: "Confirm handover" }).click();
    await expect(c.getByText(/RC-/).first()).toBeVisible();
    await shot(c, "11-receipt-and-timeline", true);
  }
  await champ.ctx.close();

  // 12 — the public record, as the customer's SMS link opens it
  const link = (await lastSms(request, "RECEIPT")).match(/https?:\/\/\S+\/verify\/[A-Za-z0-9_-]+(\?t=[A-Za-z0-9_-]+)?/)?.[0];
  if (link) {
    const pub = await browser.newContext({ viewport: PHONE });
    const v = await pub.newPage();
    await v.goto(new URL(link).pathname + new URL(link).search);
    await english(v);
    await shot(v, "12-public-verify-page", true);
    await pub.close();
  }

  // 13–14 — the other people who earn: a rider and the supplier
  const rider = await fieldLogin(browser, SEED.riders[0]!.phone, SEED.riders[0]!.pin);
  await rider.page.setViewportSize(PHONE);
  await english(rider.page);
  await shot(rider.page, "13-rider-home-my-day", true);
  await rider.ctx.close();
  const supplier = await fieldLogin(browser, SEED.supplier.phone, SEED.supplier.pin);
  await supplier.page.setViewportSize(PHONE);
  await english(supplier.page);
  await shot(supplier.page, "14-supplier-home", true);
  await supplier.ctx.close();

  // 15–16 — nothing important on one admin's word; who may sell to whom
  await a.goto("/admin/approvals");
  await shot(a, "15-approvals", false);
  await a.goto("/admin/areas");
  await shot(a, "16-sale-paths", false);
  await admin.ctx.close();
});
