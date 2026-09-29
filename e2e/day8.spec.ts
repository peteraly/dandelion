/**
 * Handbook §17 Day 8 dry run, end to end through the UI with MockProvider.
 * Tests run serially and share state (one pilot loop), like the real dry run.
 */
import { expect, test, type Page } from "@playwright/test";
import { SEED, adminLogin, digits, english, fieldLogin, lastSms, sim } from "./helpers";

test.describe.configure({ mode: "serial" });

const state: { pickupRef?: string; saleOrderId?: string; verifyUrl?: string; receiptLink?: string; newChampionPhone: string; newChampionPin: string } = {
  newChampionPhone: "+255700000088",
  newChampionPin: "7391",
};

async function currentOrderRef(page: Page): Promise<string> {
  const ref = await page.locator("span.font-mono").first().innerText();
  expect(ref).toMatch(/^OR-/);
  return ref;
}

test("security headers are present on every response", async ({ request }) => {
  for (const path of ["/", "/login", "/verify/AAAAAAAAAAAAAAAAAAAAAA"]) {
    const r = await request.get(path);
    const h = r.headers();
    expect(h["content-security-policy"], path).toMatch(/default-src 'self'/);
    expect(h["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
    expect(h["content-security-policy"]).toMatch(/'nonce-/);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("same-origin");
    expect(h["permissions-policy"]).toMatch(/camera=\(\)/);
    expect(h["permissions-policy"]).toMatch(/geolocation=\(\)/);
    expect(h["permissions-policy"]).toMatch(/microphone=\(\)/);
    expect(h["access-control-allow-origin"]).toBeUndefined();
  }
});

test("microphone is allowed only on the problem-report screen", async ({ browser }) => {
  const { page, ctx } = await fieldLogin(browser, SEED.champions[2]!.phone, SEED.champions[2]!.pin);
  const r = await page.request.get("/problem");
  expect(r.headers()["permissions-policy"]).toMatch(/microphone=\(self\)/);
  await ctx.close();
});

test("activation: admin creates a champion; SMS link + OTP + PIN activates in a few steps", async ({ browser, request }) => {
  const { page, ctx } = await adminLogin(browser, SEED.adminA);
  await english(page);
  await page.goto("/admin/stakeholders/new");
  await page.getByLabel("Full name").fill("Champion Four (TEST)");
  await page.getByLabel("Verified phone number").fill(state.newChampionPhone);
  await page.getByLabel("Role").selectOption("FIELD_CHAMPION");
  await page.getByLabel("Hub").selectOption({ index: 1 });
  await page.getByLabel(/Payee account/).fill("TILL-CHA-004");
  await page.getByRole("button", { name: "Add stakeholder" }).click();
  await expect(page).toHaveURL(/\/admin\/stakeholders\/[0-9a-f-]+/);
  await ctx.close();

  const link = (await lastSms(request, "ENROLL_LINK")).match(/https?:\/\/\S+\/enroll\/[A-Za-z0-9_-]+/)![0];
  const ctx2 = await browser.newContext();
  const p = await ctx2.newPage();
  await p.goto(link);
  await english(p);
  await p.getByLabel(/Phone number/).fill(state.newChampionPhone);
  await p.getByRole("button", { name: "Send code" }).click();
  await expect(p.getByText("We sent a 6-digit code")).toBeVisible();
  const code = digits(await lastSms(request, "OTP"), 6);
  await p.getByLabel("Enter the code").fill(code);
  await p.getByLabel("Choose a 4-digit PIN").fill(state.newChampionPin);
  await p.getByLabel("Repeat the PIN").fill(state.newChampionPin);
  await p.getByRole("button", { name: "Activate my account" }).click();
  await expect(p).toHaveURL(/\/home/);
  await english(p);
  await expect(p.getByText("Field Champion")).toBeVisible();
  // One Screen Rule: exactly one primary action.
  expect(await p.locator("a.btn-primary, button.btn-primary").count()).toBe(1);
  await ctx2.close();
});

test("PIN reset requires an admin: an OTP alone never resets; admin re-enroll sends a new link", async ({ browser, request }) => {
  const r = await request.get("/enroll/not-a-real-token");
  expect(await r.text()).toMatch(/not valid|si sahihi/);
  const { page, ctx } = await adminLogin(browser, SEED.adminB);
  await english(page);
  await page.goto("/admin/stakeholders");
  await page.getByRole("link", { name: "Champion Four (TEST)" }).click();
  await page.getByTestId("reenroll").click();
  await expect(page.getByText("Invited")).toBeVisible();
  await ctx.close();
  const link = (await lastSms(request, "ENROLL_LINK")).match(/https?:\/\/\S+\/enroll\/[A-Za-z0-9_-]+/)![0];
  const ctx2 = await browser.newContext();
  const p = await ctx2.newPage();
  await p.goto(link);
  await english(p);
  await p.getByLabel(/Phone number/).fill(state.newChampionPhone);
  await p.getByRole("button", { name: "Send code" }).click();
  await expect(p).toHaveURL(/challenge=/);
  const code = digits(await lastSms(request, "OTP"), 6);
  await p.getByLabel("Enter the code").fill(code);
  await p.getByLabel("Choose a 4-digit PIN").fill("8462");
  await p.getByLabel("Repeat the PIN").fill("8462");
  await p.getByRole("button", { name: "Activate my account" }).click();
  await expect(p).toHaveURL(/\/home/);
  state.newChampionPin = "8462";
  await ctx2.close();
});

test("factory pickup: assigned → batch ready → accept → pending → confirmed → both confirm → in transit", async ({ browser, request }) => {
  const admin = await adminLogin(browser, SEED.adminA);
  await english(admin.page);
  await admin.page.goto("/admin/orders/new");
  await admin.page.getByLabel("Quantity").fill("10");
  await admin.page.getByRole("button", { name: "Assign a factory pickup" }).click();
  await expect(admin.page).toHaveURL(/\/admin\/orders\?ok=created/);
  await admin.ctx.close();
  expect(await lastSms(request, "PICKUP")).toContain("75,000 TZS");

  const supplier = await fieldLogin(browser, SEED.supplier.phone, SEED.supplier.pin);
  await english(supplier.page);
  await expect(supplier.page.getByRole("heading", { name: "Pickup assigned" })).toBeVisible();
  await supplier.page.getByRole("link", { name: "Confirm batch ready" }).click();
  state.pickupRef = await currentOrderRef(supplier.page);
  await supplier.page.getByLabel(/Seal/).fill("SEAL-001");
  await supplier.page.getByRole("button", { name: "Confirm batch ready" }).click();
  await expect(supplier.page.getByRole("heading", { name: "Batch ready for rider payment and pickup" })).toBeVisible();

  const rider = await fieldLogin(browser, SEED.riders[0]!.phone, SEED.riders[0]!.pin);
  await english(rider.page);
  await expect(rider.page.getByRole("heading", { name: "Pickup available" })).toBeVisible();
  await rider.page.getByRole("link", { name: "Accept pickup" }).click();
  await rider.page.getByRole("button", { name: "Accept pickup" }).click();
  await expect(rider.page.getByRole("heading", { name: "Pay the supplier via mobile money" })).toBeVisible();
  await expect(rider.page.getByText(/TILL-SUP-001/)).toBeVisible();
  await rider.page.getByRole("button", { name: "I have paid" }).click();
  await expect(rider.page.getByRole("heading", { name: "Payment being verified with provider" })).toBeVisible();
  // "I have paid" did not confirm anything: the supplier still waits.
  await supplier.page.goto("/home");
  await expect(supplier.page.getByRole("heading", { name: "Payment being verified with provider" })).toBeVisible();

  // Spoofed, wrong-amount, duplicate and replay callbacks never confirm.
  const spoof = (await sim(request, { op: "simulate", scenario: "spoofed", orderRef: state.pickupRef })) as { outcomes: string[] };
  expect(spoof.outcomes).toContain("NOT_FOUND");
  const wrong = (await sim(request, { op: "simulate", scenario: "wrong_amount", orderRef: state.pickupRef })) as { outcomes: string[] };
  expect(wrong.outcomes).toContain("WRONG_AMOUNT");
  await rider.page.goto("/home");
  await expect(rider.page.getByText("Payment failed or under review")).toBeVisible();
  await rider.page.getByRole("link", { name: "I have paid" }).click();
  await rider.page.getByRole("button", { name: "I have paid" }).click();
  const dup = (await sim(request, { op: "simulate", scenario: "duplicate", orderRef: state.pickupRef })) as { outcomes: string[] };
  expect(dup.outcomes.filter((o) => o === "CONFIRMED")).toHaveLength(1);
  expect(dup.outcomes).toContain("DUPLICATE");
  const replay = (await sim(request, { op: "simulate", scenario: "replay", orderRef: state.pickupRef })) as { outcomes: string[] };
  expect(replay.outcomes).not.toContain("CONFIRMED");

  await rider.page.goto("/home");
  await expect(rider.page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await supplier.page.goto("/home");
  await expect(supplier.page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await supplier.page.getByRole("link", { name: "Confirm release" }).click();
  await supplier.page.getByLabel(/counted the units/).check();
  await supplier.page.getByRole("button", { name: "Confirm release" }).click();
  await expect(supplier.page.getByRole("heading", { name: "Waiting for the rider's confirmation" })).toBeVisible();
  await rider.page.goto("/home");
  await rider.page.getByRole("link", { name: "Confirm receipt" }).click();
  await rider.page.getByLabel(/counted the units/).check();
  await rider.page.getByLabel(/seal and batch ID/).check();
  await rider.page.getByRole("button", { name: "Confirm receipt" }).click();
  await expect(rider.page.getByRole("heading", { name: "Stock has left the factory" })).toBeVisible();
  await rider.page.goto("/home");
  await expect(rider.page.getByRole("heading", { name: "In transit" })).toBeVisible();
  await supplier.page.goto("/home");
  await expect(supplier.page.getByRole("heading", { name: "Stock has left the factory" })).toBeVisible();
  await supplier.ctx.close();
  await rider.ctx.close();
});

test("hub inspection and transfer: delivery code → checklist → pay → both confirm → stock at hub, margin shown", async ({ browser, request }) => {
  const rider = await fieldLogin(browser, SEED.riders[0]!.phone, SEED.riders[0]!.pin);
  await english(rider.page);
  await rider.page.getByRole("link", { name: "Open delivery code" }).click();
  const code = await rider.page.getByTestId("delivery-code").innerText();
  expect(code).toMatch(/^\d{6}$/);
  const deliveryRef = await currentOrderRef(rider.page);

  const hub = await fieldLogin(browser, SEED.hub.phone, SEED.hub.pin);
  await english(hub.page);
  await expect(hub.page.getByRole("heading", { name: "Rider arriving" })).toBeVisible();
  await hub.page.getByRole("link", { name: "Start inspection" }).click();
  await hub.page.getByLabel(/delivery code/).fill("000000");
  await hub.page.getByRole("button", { name: "Start inspection" }).click();
  await expect(hub.page.getByTestId("error")).toContainText(/delivery code is wrong/);
  await hub.page.getByLabel(/delivery code/).fill(code);
  await hub.page.getByRole("button", { name: "Start inspection" }).click();
  await expect(hub.page.getByRole("heading", { name: "Check seal, count units, inspect condition" })).toBeVisible();
  for (const label of ["Correct rider", "Correct product category", "Correct unit count", "Correct batch ID", "Package seal intact", "Product condition good", "No water damage or tampering"]) {
    await hub.page.getByLabel(label).check();
  }
  await hub.page.getByRole("button", { name: "Accept stock" }).click();
  await expect(hub.page.getByRole("heading", { name: "Confirm payment to rider via mobile money" })).toBeVisible();
  await hub.page.getByRole("button", { name: "I have paid" }).click();
  const ok = (await sim(request, { op: "simulate", scenario: "success", orderRef: deliveryRef })) as { outcomes: string[] };
  expect(ok.outcomes).toContain("CONFIRMED");
  await rider.page.goto("/home");
  await expect(rider.page.getByRole("heading", { name: "Hub accepted stock" })).toBeVisible();
  await rider.page.getByRole("link", { name: "Confirm handover to hub" }).click();
  await rider.page.getByLabel(/counted the units/).check();
  await rider.page.getByRole("button", { name: "Confirm handover to hub" }).click();
  await expect(rider.page.getByRole("heading", { name: "Sale complete" })).toBeVisible();
  await expect(rider.page.getByText(/Your margin:/)).toBeVisible();
  await expect(rider.page.getByText("5,000 TZS")).toBeVisible();
  await rider.page.goto("/home");
  await expect(rider.page.getByRole("heading", { name: "Sale complete" })).toBeVisible();
  await hub.page.goto("/home");
  await expect(hub.page.getByRole("heading", { name: "Stock recorded at your hub" })).toBeVisible();
  await hub.page.goto("/inventory");
  await expect(hub.page.getByText("10 units")).toBeVisible();
  await rider.ctx.close();
  await hub.ctx.close();
});

test("champion stock transfer: request → hub prepares → pay → both confirm", async ({ browser, request }) => {
  const champ = await fieldLogin(browser, SEED.champions[0]!.phone, SEED.champions[0]!.pin);
  await english(champ.page);
  await champ.page.goto("/stock/request");
  await champ.page.getByRole("radio").first().check();
  await champ.page.getByLabel("Units").fill("3");
  await champ.page.getByRole("button", { name: "Request stock" }).click();
  await expect(champ.page.getByRole("heading", { name: "Stock requested from hub" })).toBeVisible();
  const transferRef = await currentOrderRef(champ.page);

  const hub = await fieldLogin(browser, SEED.hub.phone, SEED.hub.pin);
  await english(hub.page);
  await expect(hub.page.getByRole("heading", { name: "Champion stock request" })).toBeVisible();
  await hub.page.getByRole("link", { name: "Prepare champion transfer" }).click();
  await hub.page.getByRole("button", { name: "Prepare champion transfer" }).click();
  await expect(hub.page.getByRole("heading", { name: "Champion payment being verified" })).toBeVisible();
  await champ.page.goto("/home");
  await champ.page.getByRole("link", { name: "I have paid" }).click();
  await champ.page.getByRole("button", { name: "I have paid" }).click();
  const ok = (await sim(request, { op: "simulate", scenario: "success", orderRef: transferRef })) as { outcomes: string[] };
  expect(ok.outcomes).toContain("CONFIRMED");
  await hub.page.goto("/home");
  await hub.page.getByRole("link", { name: "Confirm release" }).click();
  await hub.page.getByLabel(/counted the units/).check();
  await hub.page.getByRole("button", { name: "Confirm release" }).click();
  await expect(hub.page).toHaveURL(/ok=done/);
  await champ.page.goto("/home");
  await champ.page.getByRole("link", { name: "Confirm receipt" }).click();
  await champ.page.getByLabel(/counted the units/).check();
  await champ.page.getByLabel(/seal and batch ID/).check();
  await champ.page.getByRole("button", { name: "Confirm receipt" }).click();
  await expect(champ.page.getByRole("heading", { name: "Completed" })).toBeVisible();
  await champ.page.goto("/home");
  await expect(champ.page.getByRole("heading", { name: /Enroll a customer|Customer enrolled/ })).toBeVisible();
  await champ.ctx.close();
  await hub.ctx.close();
});

test("customer: enrol with OTP, installments to full payment, overpayment to review, handover, receipt, verify page", async ({ browser, request }) => {
  const champ = await fieldLogin(browser, SEED.champions[0]!.phone, SEED.champions[0]!.pin);
  await english(champ.page);
  await champ.page.goto("/customers/new");
  await champ.page.getByLabel("Name or preferred name").fill("Customer F (TEST)");
  await champ.page.getByLabel(/Phone number/).fill("+255700000056");
  await champ.page.getByLabel(/consents to transaction messages/).check();
  await champ.page.getByRole("button", { name: "Continue" }).click();
  await expect(champ.page).toHaveURL(/\/customers\/[0-9a-f-]+\?challenge=/);
  const otp = digits(await lastSms(request, "OTP"), 6);
  await champ.page.getByLabel("Enter the code").fill(otp);
  await champ.page.getByRole("button", { name: "Confirm" }).click();
  await expect(champ.page.getByText("Choose the product with the customer")).toBeVisible();
  await champ.page.getByRole("radio").first().check();
  await champ.page.getByRole("button", { name: "Start purchase plan" }).click();
  await expect(champ.page.getByRole("heading", { name: "Installment plan active" })).toBeVisible();
  await expect(champ.page.getByText("No automatic deductions. No late fees. No debt.")).toBeVisible();
  const saleRef = await currentOrderRef(champ.page);
  state.saleOrderId = champ.page.url().match(/orders\/([0-9a-f-]+)/)![1];
  expect(await lastSms(request, "CUSTOMER_PLAN")).toContain("11,400 TZS");

  // handover impossible before full payment
  await champ.page.goto(`/orders/${state.saleOrderId}`);
  expect(await champ.page.getByRole("button", { name: "Start handover" }).count()).toBe(0);

  await sim(request, { op: "simulate", scenario: "success", orderRef: saleRef, amountTzs: 5000 });
  await sim(request, { op: "simulate", scenario: "success", orderRef: saleRef, amountTzs: 4000 });
  await champ.page.goto(`/orders/${state.saleOrderId}`);
  await expect(champ.page.getByText("9,000 TZS / 11,400 TZS")).toBeVisible();
  const over = (await sim(request, { op: "simulate", scenario: "overpayment", orderRef: saleRef })) as { outcomes: string[] };
  expect(over.outcomes).toContain("OVERPAYMENT");
  await champ.page.goto(`/orders/${state.saleOrderId}`);
  await expect(champ.page.getByText("9,000 TZS / 11,400 TZS")).toBeVisible(); // overpayment did not count
  const fin = (await sim(request, { op: "simulate", scenario: "success", orderRef: saleRef, amountTzs: 2400 })) as { outcomes: string[] };
  expect(fin.outcomes).toContain("CONFIRMED");
  await champ.page.goto("/home");
  await expect(champ.page.getByRole("heading", { name: "Customer has paid in full" })).toBeVisible();
  await champ.page.getByRole("link", { name: "Start handover" }).click();
  await champ.page.getByRole("button", { name: "Start handover" }).click();
  await expect(champ.page.getByRole("heading", { name: "Handover required" })).toBeVisible();
  const code = digits(await lastSms(request, "HANDOVER_CODE"), 6);
  for (const label of ["Wash with water and soap after use", "Dry fully before reuse", "Store safely", "When not to use it", "When to seek medical care"]) {
    await champ.page.getByLabel(label).check();
  }
  await champ.page.getByLabel("Customer's code").fill("000000");
  await champ.page.getByRole("button", { name: "Confirm handover" }).click();
  await expect(champ.page.getByTestId("error")).toContainText(/customer's code is wrong/);
  for (const label of ["Wash with water and soap after use", "Dry fully before reuse", "Store safely", "When not to use it", "When to seek medical care"]) {
    await champ.page.getByLabel(label).check();
  }
  await champ.page.getByLabel("Customer's code").fill(code);
  await champ.page.getByRole("button", { name: "Confirm handover" }).click();
  await expect(champ.page.getByText(/Receipt RC-/)).toBeVisible();
  await expect(champ.page.getByText(/Your margin:/)).toBeVisible();
  await champ.ctx.close();

  const receiptSms = await lastSms(request, "RECEIPT");
  state.receiptLink = receiptSms.match(/https?:\/\/\S+\/verify\/[A-Za-z0-9_-]+\?t=[A-Za-z0-9_-]+/)![0];
  state.verifyUrl = state.receiptLink.split("?")[0]!;
});

test("verify page: public view shows only event types and dates; receipt token shows the customer's receipt", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(state.verifyUrl!);
  await english(page);
  await expect(page.getByTestId("verify-statement")).toContainText("has not been changed since");
  const events = page.getByTestId("ledger-event");
  expect(await events.count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByText("Payment confirmed").first()).toBeVisible();
  await expect(page.getByText("Handover completed")).toBeVisible();
  const html = await page.content();
  expect(html).not.toMatch(/TILL-|BOSS_RIDER|FIELD_CHAMPION|Customer F/);
  expect(html).not.toMatch(/11,400 TZS/); // amount hidden without the token
  expect(await page.getByTestId("receipt").count()).toBe(0);
  await page.goto(state.receiptLink!);
  await expect(page.getByTestId("receipt")).toContainText("11,400 TZS");
  await ctx.close();
});

test("damaged stock locks the batch; self-approval is rejected; a second admin resolves", async ({ browser }) => {
  const champ = await fieldLogin(browser, SEED.champions[0]!.phone, SEED.champions[0]!.pin);
  await english(champ.page);
  await champ.page.goto("/problem");
  await champ.page.getByRole("radio", { name: /Product damaged or wet/ }).check();
  await champ.page.getByLabel(/Which stock/).selectOption({ index: 1 });
  await champ.page.getByLabel(/Details/).fill("Two boxes got wet on the way");
  await champ.page.getByRole("button", { name: "Submit" }).click();
  await expect(champ.page.getByTestId("problem-ref")).toContainText("EX-");
  await expect(champ.page.getByText(/now locked/)).toBeVisible();
  await champ.ctx.close();

  const a = await adminLogin(browser, SEED.adminA);
  await english(a.page);
  await a.page.goto("/admin/exceptions");
  const card = a.page.getByTestId("exception").filter({ hasText: "DAMAGED OR WET" }).first();
  await card.getByLabel("Resolution note").fill("Only packaging affected; dried and inspected");
  await card.getByRole("button", { name: "Propose resolution" }).click();
  await expect(a.page).toHaveURL(/ok=proposed/);
  await a.page.goto("/admin/approvals");
  const own = a.page.getByTestId("approval").filter({ hasText: "EXCEPTION RESOLVE" }).first();
  await expect(own.getByTestId("own-request")).toBeVisible();
  expect(await own.getByRole("button", { name: "Approve" }).count()).toBe(0);
  await a.ctx.close();

  const b = await adminLogin(browser, SEED.adminB);
  await english(b.page);
  await b.page.goto("/admin/approvals");
  const req = b.page.getByTestId("approval").filter({ hasText: "EXCEPTION RESOLVE" }).first();
  await req.getByRole("button", { name: "Approve" }).click();
  await expect(b.page).toHaveURL(/ok=decided/);
  await b.page.goto("/admin/inventory");
  expect(await b.page.getByText("DAMAGED OR QUARANTINED").count()).toBe(0);
  await b.ctx.close();
});

test("donor-funded order is rejected without evidence and highlighted when approved", async ({ browser, request }) => {
  // A fresh customer plan for champion two.
  const champ = await fieldLogin(browser, SEED.champions[1]!.phone, SEED.champions[1]!.pin);
  await english(champ.page);
  await champ.page.goto("/customers");
  await champ.page.getByRole("link", { name: /Customer B/ }).click();
  await champ.page.getByRole("radio").first().check();
  await champ.page.getByRole("button", { name: "Start purchase plan" }).click();
  await expect(champ.page).toHaveURL(/orders\/[0-9a-f-]+/);
  const orderId = champ.page.url().match(/orders\/([0-9a-f-]+)/)![1];
  await champ.ctx.close();

  const a = await adminLogin(browser, SEED.adminA);
  await english(a.page);
  await a.page.goto(`/admin/orders/${orderId}/donor`);
  await a.page.getByLabel("Donor / subsidy reference").fill("NGO-2026-01");
  await a.page.getByRole("button", { name: "Submit" }).click();
  await expect(a.page.getByTestId("error")).toContainText(/Attach an evidence file/);
  await a.page.getByLabel("Donor / subsidy reference").fill("NGO-2026-01");
  await a.page.getByLabel(/Evidence file/).setInputFiles({ name: "letter.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test letter") });
  await a.page.getByRole("button", { name: "Submit" }).click();
  await expect(a.page).toHaveURL(/\/admin\/approvals/);
  await expect(a.page.getByText("DONOR-FUNDED").first()).toBeVisible();
  await a.ctx.close();

  const b = await adminLogin(browser, SEED.adminB);
  await english(b.page);
  await b.page.goto("/admin/approvals");
  await b.page.getByTestId("approval").filter({ hasText: "DONOR-FUNDED" }).first().getByRole("button", { name: "Approve" }).click();
  await expect(b.page).toHaveURL(/ok=decided/);
  await b.page.goto("/admin/logs");
  await expect(b.page.getByTestId("highlighted-log").first()).toContainText("donor_funding.approved");
  await b.ctx.close();
  void request;
});

test("offline note is saved locally and synced; it never touches money", async ({ browser }) => {
  const { page, ctx } = await fieldLogin(browser, SEED.hub.phone, SEED.hub.pin);
  await english(page);
  await page.goto("/notes");
  await ctx.setOffline(true);
  await page.getByLabel(/Note/).fill("Inspection area cleaned, shelf 2 dry");
  await page.getByTestId("save-note").click();
  await expect(page.getByTestId("local-note").first()).toContainText("Waiting to sync");
  await ctx.setOffline(false);
  await page.reload();
  await expect(page.getByTestId("local-note").first()).toContainText("Synced", { timeout: 15_000 });
  await ctx.close();
});

test("lost phone: lock from another device with phone + PIN; login then fails as locked", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/lock");
  await english(page);
  await page.getByLabel(/Phone number/).fill(SEED.riders[1]!.phone);
  await page.getByLabel(/PIN/).fill(SEED.riders[1]!.pin);
  await page.getByRole("button", { name: "Lock my account" }).click();
  await expect(page.getByTestId("locked-ok")).toBeVisible();
  await page.goto("/login");
  await page.getByLabel(/Phone number/).fill(SEED.riders[1]!.phone);
  await page.getByLabel(/PIN/).fill(SEED.riders[1]!.pin);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("error")).toContainText(/locked/);
  await ctx.close();
});

test("AI-off path: no AI intake on the problem screen, brief renders deterministically", async ({ browser }) => {
  const champ = await fieldLogin(browser, SEED.champions[2]!.phone, SEED.champions[2]!.pin);
  await champ.page.goto("/problem");
  expect(await champ.page.getByText(/we will suggest the category|tutapendekeza/).count()).toBe(0);
  await champ.ctx.close();
  const a = await adminLogin(browser, SEED.adminA);
  await english(a.page);
  await a.page.goto("/admin/brief");
  await expect(a.page.getByText("AI is off")).toBeVisible();
  await a.ctx.close();
});

test("dashboard priorities and reconciliation flag the review items", async ({ browser, request }) => {
  await sim(request, { op: "reconcile" });
  const a = await adminLogin(browser, SEED.adminA);
  await english(a.page);
  await a.page.goto("/admin");
  await expect(a.page.getByTestId("priority-0")).not.toHaveText("0"); // payments needing review
  await a.page.goto("/admin/reconciliation");
  await expect(a.page.getByText("PAYMENT IN REVIEW").first()).toBeVisible();
  await a.ctx.close();
});

test("provider statement import shows matched, amount-differs, missing-in-statement and missing-in-app rows", async ({ browser, request }) => {
  const confirmed = (await sim(request, { op: "confirmedPayments" })) as unknown as { providerTxRef: string; amountTzs: number; payeeAccount: string }[];
  expect(confirmed.length).toBeGreaterThanOrEqual(3);
  const [a, b] = confirmed;
  // The statement's date range (yesterday..tomorrow, East Africa Time) decides which confirmations are expected in it; all of ours happened just now.
  const eat = (offsetDays: number) => new Date(Date.now() + (offsetDays * 24 + 3) * 3600_000).toISOString().slice(0, 10);
  const csv = ["reference,amount,payee,date", `${a!.providerTxRef},${a!.amountTzs},${a!.payeeAccount},${eat(-1)}`, `${b!.providerTxRef},${b!.amountTzs + 500},${b!.payeeAccount},${eat(0)}`, `MPUNKNOWN01,1234,TILL-X,${eat(1)}`].join("\n");
  const admin = await adminLogin(browser, SEED.adminA);
  await english(admin.page);
  await admin.page.goto("/admin/statements");
  await admin.page.getByLabel("CSV").setInputFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await admin.page.getByRole("button", { name: "Import CSV" }).click();
  await expect(admin.page).toHaveURL(/\/admin\/statements\/[0-9a-f-]+/);
  await expect(admin.page.getByTestId("matched")).toHaveCount(1);
  await expect(admin.page.getByTestId("amount-differs")).toHaveCount(1);
  await expect(admin.page.getByText(/statement .* vs app/)).toBeVisible();
  await expect(admin.page.getByTestId("missing-in-app")).toHaveCount(1);
  // Every other confirmation in the window is expected in the statement and reported as missing from it.
  expect(await admin.page.getByTestId("missing-in-statement").count()).toBeGreaterThanOrEqual(confirmed.length - 2);
  await admin.ctx.close();
});

test("simulator is not reachable without the guard", async ({ request }) => {
  const r = await request.post("/dev/simulator/api", { data: { op: "poll" } });
  expect(r.status()).toBe(401);
  const page = await request.get("/dev/simulator", { maxRedirects: 0 });
  expect([302, 307, 404]).toContain(page.status());
});
