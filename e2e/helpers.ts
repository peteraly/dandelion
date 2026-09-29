import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { SEED } from "../scripts/seed";
import { totpAt } from "../lib/auth/totp";

export const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron-secret";
export { SEED };

export async function sim(request: APIRequestContext, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await request.post("/dev/simulator/api", { headers: { authorization: `Bearer ${CRON_SECRET}` }, data: body });
  expect(r.ok(), `simulator ${JSON.stringify(body)} → ${r.status()}`).toBeTruthy();
  return (await r.json()) as Record<string, unknown>;
}

export async function lastSms(request: APIRequestContext, purpose: string): Promise<string> {
  const r = (await sim(request, { op: "lastSms", purpose })) as { body?: string } | null;
  expect(r?.body, `no SMS with purpose ${purpose}`).toBeTruthy();
  return r!.body!;
}

export function digits(body: string, n: number): string {
  const m = body.match(new RegExp(`\\b(\\d{${n}})\\b`));
  if (!m) throw new Error(`no ${n}-digit code in: ${body}`);
  return m[1]!;
}

export async function fieldLogin(browser: Browser, phone: string, pin: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel(/phone|simu/i).fill(phone);
  await page.getByLabel(/PIN/).fill(pin);
  await page.getByRole("button", { name: /sign in|ingia/i }).click();
  await expect(page).toHaveURL(/\/home/);
  return { ctx, page };
}

const adminStates = new Map<string, string>();
const lastTotpStep = new Map<string, number>();

/** TOTP codes are single-use per 30 s step; wait for a fresh step before re-using an admin's secret. */
async function freshTotpCode(admin: { phone: string; totp: string }): Promise<string> {
  const step = () => Math.floor(Date.now() / 1000 / 30);
  while (lastTotpStep.get(admin.phone) === step()) await new Promise((r) => setTimeout(r, 500));
  lastTotpStep.set(admin.phone, step());
  return totpAt(admin.totp, new Date());
}

/**
 * Admin login through passphrase + TOTP. The session's storage state is cached
 * per admin so later tests reuse it (sessions last hours; tests take minutes).
 */
export async function adminLogin(browser: Browser, admin: { phone: string; passphrase: string; totp: string }): Promise<{ ctx: BrowserContext; page: Page }> {
  const cached = adminStates.get(admin.phone);
  if (cached) {
    const ctx = await browser.newContext({ storageState: JSON.parse(cached) });
    const page = await ctx.newPage();
    await page.goto("/admin");
    if (/\/admin$/.test(new URL(page.url()).pathname)) return { ctx, page };
    await ctx.close();
    adminStates.delete(admin.phone);
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/admin/login");
  await page.getByLabel(/phone|simu/i).fill(admin.phone);
  await page.getByLabel(/passphrase|neno la siri/i).fill(admin.passphrase);
  await page.getByRole("button", { name: /continue|endelea/i }).click();
  await expect(page).toHaveURL(/\/admin\/login\/second-factor$/);
  await page.getByLabel(/6-digit|tarakimu 6/i).fill(await freshTotpCode(admin));
  await page.getByRole("button", { name: /second step|hatua ya pili/i }).click();
  await expect(page).toHaveURL(/\/admin(\/passkeys\?first=1)?$/);
  adminStates.set(admin.phone, JSON.stringify(await ctx.storageState()));
  return { ctx, page };
}

/** Switch the UI to English for stable selectors. */
export async function english(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: /Switch language to EN/ });
  if (await toggle.count()) {
    await toggle.first().click();
    // The toggle is a server action + redirect; wait until the page re-renders in English.
    await page.getByRole("button", { name: /Switch language to SW/ }).waitFor({ timeout: 15_000 });
  }
}

export function orderRefFrom(page: Page): Promise<string> {
  return page.locator("dd.font-medium span.font-mono, span.font-mono").first().innerText();
}
