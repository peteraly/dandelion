/**
 * Handbook §17 Day 8 dry run, end to end through the UI with MockProvider.
 * Tests run serially and share state (one pilot loop), like the real dry run.
 */
import AxeBuilder from "@axe-core/playwright";
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
  await expect(p.getByText("Local Seller")).toBeVisible();
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
  // The form offers only (supplier, product) pairs the supplier supplies (Prompt B §8.3).
  await admin.page.getByLabel("Supplier · product").selectOption({ label: `${SEED.supplier.name} · Standard kit (reusable)` });
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
  await expect(supplier.page.getByRole("heading", { name: "Batch ready for delivery partner payment and pickup" })).toBeVisible();

  const rider = await fieldLogin(browser, SEED.riders[0]!.phone, SEED.riders[0]!.pin);
  await english(rider.page);
  await expect(rider.page.getByRole("heading", { name: "Pickup available" })).toBeVisible();
  await rider.page.getByRole("link", { name: "Accept pickup" }).click();
  await rider.page.getByRole("button", { name: "Accept pickup" }).click();
  await expect(rider.page.getByRole("heading", { name: "Pay the supplier via mobile money" })).toBeVisible();
  // Founders' route (Prompt L §2.1): the rider pays Dandelion's collection account, not the supplier's number.
  await expect(rider.page.getByText(/TILL-DANDELION-001/)).toBeVisible();
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
  // The organisation view (Prompt B §8.2): this week's pickups and the money the provider confirmed.
  await expect(supplier.page.getByTestId("supplier-pickups")).toContainText(state.pickupRef);
  await expect(supplier.page.getByTestId("supplier-payments")).toContainText("75,000 TZS");
  // The admin directory shows the same confirmed payment on the supplier's page (§8.3).
  const admin2 = await adminLogin(browser, SEED.adminB);
  await english(admin2.page);
  await admin2.page.goto("/admin/suppliers");
  await expect(admin2.page.getByTestId("supplier-row")).toHaveCount(1);
  await admin2.page.getByRole("link", { name: SEED.supplier.name }).click();
  await expect(admin2.page.getByTestId("confirmed-week")).toContainText("75,000 TZS");
  await expect(admin2.page.getByTestId("supplier-pickups")).toContainText(state.pickupRef);
  await admin2.ctx.close();
  await supplier.page.getByRole("link", { name: "Confirm release" }).click();
  await supplier.page.getByLabel(/counted the units/).check();
  await supplier.page.getByRole("button", { name: "Confirm release" }).click();
  await expect(supplier.page.getByRole("heading", { name: "Waiting for the delivery partner's confirmation" })).toBeVisible();
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
  await expect(hub.page.getByRole("heading", { name: "Delivery partner arriving" })).toBeVisible();
  await hub.page.getByRole("link", { name: "Start inspection" }).click();
  await hub.page.getByLabel(/delivery code/).fill("000000");
  await hub.page.getByRole("button", { name: "Start inspection" }).click();
  await expect(hub.page.getByTestId("error")).toContainText(/delivery code is wrong/);
  await hub.page.getByLabel(/delivery code/).fill(code);
  await hub.page.getByRole("button", { name: "Start inspection" }).click();
  await expect(hub.page.getByRole("heading", { name: "Check seal, count units, inspect condition" })).toBeVisible();
  for (const label of ["Correct delivery partner", "Correct product category", "Correct unit count", "Correct batch ID", "Package seal intact", "Product condition good", "No water damage or tampering"]) {
    await hub.page.getByLabel(label).check();
  }
  await hub.page.getByRole("button", { name: "Accept stock" }).click();
  await expect(hub.page.getByRole("heading", { name: "Confirm payment to delivery partner via mobile money" })).toBeVisible();
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
  await expect(hub.page.getByRole("heading", { name: "Local seller stock request" })).toBeVisible();
  await hub.page.getByRole("link", { name: "Prepare local seller transfer" }).click();
  await hub.page.getByRole("button", { name: "Prepare local seller transfer" }).click();
  await expect(hub.page.getByRole("heading", { name: "Local seller payment being verified" })).toBeVisible();
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
  // The order's timeline (Prompt C §5.2): payments, then the handover; the other side appears by role, never by name.
  const timeline = champ.page.getByTestId("timeline").getByTestId("timeline-item");
  expect(await timeline.count()).toBeGreaterThanOrEqual(4);
  await expect(timeline.first()).toContainText("Payment confirmed");
  await expect(timeline.last()).toContainText("Handover completed");
  await expect(champ.page.getByTestId("timeline")).toContainText("Payment under review");
  await expect(champ.page.getByTestId("timeline")).not.toContainText("Customer F");
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
  await expect(a.page.getByTestId("need-paymentsReview-count")).not.toHaveText("0"); // payments needing review
  // The home answers first: what needs you (only what is above zero), what is happening, then every page as a card with one line.
  await expect(a.page.getByTestId("needs-you").locator('[data-testid$="-count"]').filter({ hasText: /^0$/ })).toHaveCount(0);
  await expect(a.page.getByTestId("live-now")).toBeVisible();
  await expect(a.page.getByTestId("open-live-map")).toHaveAttribute("href", "/admin/ecosystem");
  expect(await a.page.getByTestId("home-card").count()).toBeGreaterThanOrEqual(18);
  // Every other page says where you are and what it is for, and the sidebar marks it.
  await a.page.goto("/admin/approvals");
  await expect(a.page.getByTestId("page-guide")).toContainText("Approvals");
  await expect(a.page.getByTestId("page-guide")).toContainText("two admins");
  // On a phone the menu folds behind one button that names the current page.
  await expect(a.page.getByTestId("admin-menu-toggle")).toContainText("Approvals");
  await a.page.getByTestId("admin-menu-toggle").click();
  await expect(a.page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Approvals" })).toHaveAttribute("aria-current", "page");
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

test("the open demo does not exist unless switched on", async ({ request }) => {
  expect((await request.get("/demo")).status()).toBe(404);
  const landing = await (await request.get("/")).text();
  expect(landing).not.toContain('data-testid="try-demo"');
});

test("simulator is not reachable without the guard", async ({ request }) => {
  const r = await request.post("/dev/simulator/api", { data: { op: "poll" } });
  expect(r.status()).toBe(401);
  const page = await request.get("/dev/simulator", { maxRedirects: 0 });
  expect([302, 307, 404]).toContain(page.status());
});

test("ecosystem view: one screen, filters, feed, visibility-aware refresh, accessible", async ({ browser, request }) => {
  const admin = await adminLogin(browser, SEED.adminA);
  await english(admin.page);
  const { page } = admin;
  await page.goto("/admin/ecosystem?interval=1");
  await expect(page.getByRole("heading", { name: "Live district map", level: 1 })).toBeVisible();
  await expect(page.getByTestId("hubs-table")).toContainText("Test Hub (TEST)");
  await expect(page.getByText("development", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("attention-strip")).toBeVisible();
  await expect(page.getByTestId("seed-profile")).toHaveText("minimal");
  await expect(page.getByTestId("flow-table")).toContainText("Supplier Test Co. (TEST)");
  await expect(page.getByTestId("demo-banner")).toHaveCount(0);

  // At a glance: four numbers; the attention strip shows only what needs action, the rest folds into "all clear".
  await expect(page.getByTestId("kpis").locator('[data-testid^="kpi-"]')).toHaveCount(4);
  const chip = page.getByTestId("attention-strip").getByRole("link").first();
  await chip.focus();
  await expect(chip).toBeFocused(); // keyboard path: chips are focusable links with a count and a label

  // The refresh happens only while the tab is visible.
  let refreshes = 0;
  page.on("request", (r) => {
    if (r.url().includes("/admin/ecosystem") && r.headers()["rsc"] === "1") refreshes++;
  });
  await page.waitForTimeout(2_600);
  expect(refreshes).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
    Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("live-refresh")).toHaveAttribute("data-state", "hidden");
  const before = refreshes;
  await page.waitForTimeout(2_600);
  expect(refreshes).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
    Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("live-refresh")).toHaveAttribute("data-state", "live");
  await page.getByTestId("pause-refresh").click();
  await expect(page.getByTestId("live-refresh")).toHaveAttribute("data-state", "paused");

  // Window and filters live in the URL; the money panel follows the window.
  await page.getByTestId("window-7d").click();
  await expect(page).toHaveURL(/window=7d/);
  await expect(page.getByTestId("money-CHAMPION_TO_CUSTOMER")).toBeVisible();

  // Something the machine did shows up at the top of the feed after the next refresh.
  await sim(request, { op: "reconcile" });
  await page.reload();
  await expect(page.getByTestId("feed").getByTestId("feed-item").first()).toContainText("Daily reconciliation");

  // The district map (prompt §9): one tile per hub, the same nodes as the table twin, attention outlines follow the chip,
  // and no simulator controls on a dataset that is not the demo.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin/ecosystem?window=7d");
  await expect(page.getByTestId("district-map")).toBeVisible();
  expect(await page.locator('[data-testid="map-tile"][data-kind="HUB"]').count()).toBe(await page.getByTestId("hub-row").count());
  expect(await page.getByTestId("map-tile").count()).toBe(await page.getByTestId("flow-table").locator("tbody tr").count());
  expect(await page.getByTestId("map-speed").count()).toBe(0);
  // The active chip is always shown (even at zero) and outlines exactly the tiles it counts.
  await page.goto("/admin/ecosystem?window=7d&attention=hubsBelowMin");
  const below = Number((await page.getByTestId("attention-hubsBelowMin").locator("span").first().innerText()).trim());
  await expect(page.getByTestId("attention-hubsBelowMin")).toHaveAttribute("aria-current", "true");
  expect(await page.locator('[data-testid="map-tile"][data-attention="true"]').count()).toBe(below);
  // Tables sit behind tabs: one at a time.
  await page.getByTestId("tab-orders").click();
  await expect(page.getByTestId("orders-table")).toBeVisible();
  expect(await page.getByTestId("hubs-table").count()).toBe(0);
  await page.goto("/admin/ecosystem?window=7d");
  await expect(page.getByTestId("moving-now")).toBeVisible();
  // A marker holding one order opens it; one holding several opens the place they wait at.
  for (const [href, count] of await page.getByTestId("map-marker").evaluateAll((els) => els.map((e) => [e.getAttribute("href"), e.getAttribute("data-count")]))) expect(href).toMatch(count === "1" ? /^\/admin\/orders\/[0-9a-f-]+$/ : /focus=/);
  // Click a place: its details open, it is outlined, everyone it has no open order with goes faint; close brings the map back.
  await page.locator('[data-testid="map-tile"][data-kind="HUB"]').first().click();
  await expect(page).toHaveURL(/focus=hub%3A/);
  await expect(page.getByTestId("focus-panel")).toContainText("Test Hub");
  await expect(page.locator('[data-testid="map-tile"][data-focused="true"]')).toHaveCount(1);
  await expect(page.getByTestId("focus-profile")).toHaveAttribute("href", /\/admin\//);
  const axeFocus = await new AxeBuilder({ page }).analyze();
  const seriousFocus = axeFocus.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(seriousFocus, JSON.stringify(seriousFocus.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target) })), null, 1)).toEqual([]);
  await page.getByTestId("focus-close").click();
  await expect(page.getByTestId("focus-panel")).toHaveCount(0);
  const axeWide = await new AxeBuilder({ page }).analyze();
  const seriousWide = axeWide.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(seriousWide, JSON.stringify(seriousWide.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target) })), null, 1)).toEqual([]);
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto("/admin/ecosystem");

  // Clicking a hub opens its existing page.
  await page.getByTestId("hubs-table").getByRole("link", { name: "Test Hub (TEST)" }).click();
  await expect(page).toHaveURL(/\/admin\/inventory/);

  // Accessibility: no serious or critical violations.
  await page.goto("/admin/ecosystem");
  const axe = await new AxeBuilder({ page }).analyze();
  const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target) })), null, 1)).toEqual([]);
  await admin.ctx.close();
});


const KIT_EDUCATION = ["Wash with water and soap after use", "Dry fully before reuse", "Store safely", "When not to use it", "When to seek medical care"];

test("demo polish: the guide is demo-only, the presenter view drops the sidebar, names carry a chip, earnings show net", async ({ browser }) => {
  const admin = await adminLogin(browser, SEED.adminA);
  await english(admin.page);
  const { page } = admin;
  // Not the demo dataset: no guide, no guide link, no speed controls.
  expect((await page.goto("/admin/demo"))!.status()).toBe(404);
  await page.goto("/admin/ecosystem");
  expect(await page.getByTestId("demo-guide-link").count()).toBe(0);
  expect(await page.getByTestId("nav-demo-guide").count()).toBe(0);
  // Sidebar groups (behind the menu button on a phone) and the presenter view.
  await page.getByTestId("admin-menu-toggle").click();
  await expect(page.getByRole("navigation", { name: "Admin" })).toContainText("Today");
  await page.getByTestId("present-link").click();
  await expect(page).toHaveURL(/\/admin\/present/);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByTestId("presenter")).toBeVisible();
  expect(await page.getByRole("navigation", { name: "Admin" }).count()).toBe(0);
  await expect(page.getByTestId("district-map")).toBeVisible();
  await page.getByTestId("exit-presenter").click();
  await expect(page).toHaveURL(/\/admin\/ecosystem/);
  // Names: the suffix is in the data and in the accessible name, but never printed raw for sighted users.
  await page.goto("/admin/stakeholders");
  expect(await page.getByTestId("test-chip").count()).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "Rider One (TEST)" })).toBeVisible();
  const raw = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.includes("(TEST)")) continue;
      const parent = node.parentElement as HTMLElement | null;
      if (parent?.closest(".sr-only") || parent?.closest("script, style, noscript, template")) continue; // the RSC payload is data, not the page
      n++;
    }
    return n;
  });
  expect(raw).toBe(0);
  await admin.ctx.close();

  // Earnings show net, received and paid out — never a bare negative "earned".
  const rider = await fieldLogin(browser, SEED.riders[0]!.phone, SEED.riders[0]!.pin);
  await english(rider.page);
  await expect(rider.page.getByTestId("earned-week")).toContainText("net");
  await expect(rider.page.getByTestId("earnings")).toContainText("received");
  await rider.ctx.close();
});

test("sale paths: two admins switch on village drops; a rider keeps factory stock and sells it in a village", async ({ browser, request }) => {
  // Ladder-only until two admins decide otherwise (prompt §8.8.2).
  const a = await adminLogin(browser, SEED.adminA);
  await english(a.page);
  await a.page.goto("/admin/areas");
  const area = a.page.getByTestId("area-card").first();
  await expect(area.getByTestId("area-allowed")).toContainText("Ladder only");
  await area.getByLabel(/Delivery partners sell directly to customers/).check();
  await area.getByLabel(/Suppliers sell to organisations/).check();
  await area.getByRole("button", { name: "Request change" }).click();
  await expect(a.page).toHaveURL(/ok=requested/);
  await expect(a.page.getByTestId("area-card").first().getByText("Change pending")).toBeVisible();
  await a.ctx.close();

  const b = await adminLogin(browser, SEED.adminB);
  await english(b.page);
  await b.page.goto("/admin/approvals");
  const req = b.page.getByTestId("approval").filter({ hasText: "AREA SALES CHANGE" }).first();
  await req.getByRole("button", { name: "Approve" }).click();
  await expect(b.page).toHaveURL(/ok=decided/);
  await b.page.goto("/admin/areas");
  await expect(b.page.getByTestId("area-allowed").first()).toContainText("Delivery partner → customer (village drop)");

  // A pickup with no hub behind it: the rider keeps the stock (§8.8.1).
  await b.page.goto("/admin/orders/new");
  await b.page.getByLabel("Supplier · product").selectOption({ label: `${SEED.supplier.name} · Standard kit (reusable)` });
  await b.page.getByLabel(/Destination hub/).selectOption({ label: "— delivery partner keeps the stock —" });
  await b.page.getByLabel("Quantity").fill("4");
  await b.page.getByRole("button", { name: "Assign a factory pickup" }).click();
  await expect(b.page).toHaveURL(/ok=created/);
  // A second pickup for the same rider, so the home screen has a "my day" list (Prompt C §5.1).
  await b.page.goto("/admin/orders/new");
  await b.page.getByLabel("Supplier · product").selectOption({ label: `${SEED.supplier.name} · Standard kit (reusable)` });
  await b.page.getByLabel(/Destination hub/).selectOption({ label: "— delivery partner keeps the stock —" });
  await b.page.getByLabel("Quantity").fill("3");
  await b.page.getByRole("button", { name: "Assign a factory pickup" }).click();
  await expect(b.page).toHaveURL(/ok=created/);
  await b.ctx.close();

  const supplier = await fieldLogin(browser, SEED.supplier.phone, SEED.supplier.pin);
  await english(supplier.page);
  const readyRefs: string[] = [];
  for (const seal of ["SEAL-VD1", "SEAL-VD2"]) {
    await supplier.page.goto("/home");
    await expect(supplier.page.getByRole("heading", { name: "Pickup assigned" })).toBeVisible();
    await supplier.page.getByRole("link", { name: "Confirm batch ready", exact: true }).click();
    readyRefs.push(await currentOrderRef(supplier.page));
    await supplier.page.getByLabel(/Seal/).fill(seal);
    await supplier.page.getByRole("button", { name: "Confirm batch ready" }).click();
    await expect(supplier.page.getByRole("heading", { name: "Batch ready for delivery partner payment and pickup" })).toBeVisible();
  }

  const rider = await fieldLogin(browser, SEED.riders[0]!.phone, SEED.riders[0]!.pin);
  await english(rider.page);
  // One primary action; the other pickup waits in "my day" with its own verb.
  expect(await rider.page.locator("a.btn-primary, button.btn-primary").count()).toBe(1);
  await expect(rider.page.getByTestId("my-day-row")).toHaveCount(1);
  await expect(rider.page.getByTestId("my-day")).toContainText("Accept pickup");
  await rider.page.getByRole("link", { name: "Accept pickup", exact: true }).click();
  await rider.page.getByRole("button", { name: "Accept pickup" }).click();
  await expect(rider.page.getByRole("heading", { name: "Pay the supplier via mobile money" })).toBeVisible();
  const pickupRef = await currentOrderRef(rider.page);
  expect(readyRefs).toContain(pickupRef);
  const paid = (await sim(request, { op: "simulate", scenario: "success", orderRef: pickupRef })) as { outcomes: string[] };
  expect(paid.outcomes).toContain("CONFIRMED");
  await supplier.page.goto("/home");
  await supplier.page.getByRole("link", { name: "Confirm release", exact: true }).click();
  await supplier.page.getByLabel(/counted the units/).check();
  await supplier.page.getByRole("button", { name: "Confirm release" }).click();
  await expect(supplier.page.getByRole("heading", { name: "Waiting for the delivery partner's confirmation" })).toBeVisible();
  await rider.page.goto("/home");
  await rider.page.getByRole("link", { name: "Confirm receipt", exact: true }).click();
  await rider.page.getByLabel(/counted the units/).check();
  await rider.page.getByLabel(/seal and batch ID/).check();
  await rider.page.getByRole("button", { name: "Confirm receipt" }).click();
  await expect(rider.page.getByRole("heading", { name: "Stock has left the factory" })).toBeVisible();
  await supplier.ctx.close();

  // The village drop: the rider enrols the customer and sells like a champion would. The stock on hand shows on the home screen.
  await rider.page.goto("/home");
  await expect(rider.page.getByTestId("customers-link")).toBeVisible();
  await expect(rider.page.getByTestId("rider-stock")).toContainText("4 units");
  await rider.page.goto("/customers/new");
  await rider.page.getByLabel("Name or preferred name").fill("Village customer (TEST)");
  await rider.page.getByLabel(/Phone number/).fill("+255700000057");
  await rider.page.getByLabel(/consents to transaction messages/).check();
  await rider.page.getByRole("button", { name: "Continue" }).click();
  await expect(rider.page).toHaveURL(/\/customers\/[0-9a-f-]+\?challenge=/);
  await rider.page.getByLabel("Enter the code").fill(digits(await lastSms(request, "OTP"), 6));
  await rider.page.getByRole("button", { name: "Confirm" }).click();
  await rider.page.getByRole("radio").first().check();
  await rider.page.getByRole("button", { name: "Start purchase plan" }).click();
  await expect(rider.page.getByRole("heading", { name: "Installment plan active" })).toBeVisible();
  const saleRef = await currentOrderRef(rider.page);
  const saleId = rider.page.url().match(/orders\/([0-9a-f-]+)/)![1]!;
  const full = (await sim(request, { op: "simulate", scenario: "success", orderRef: saleRef })) as { outcomes: string[] };
  expect(full.outcomes).toContain("CONFIRMED");
  await rider.page.goto(`/orders/${saleId}`);
  await rider.page.getByRole("button", { name: "Start handover" }).click();
  await expect(rider.page.getByRole("heading", { name: "Handover required" })).toBeVisible();
  const code = digits(await lastSms(request, "HANDOVER_CODE"), 6);
  for (const label of KIT_EDUCATION) await rider.page.getByLabel(label).check();
  await rider.page.getByLabel("Customer's code").fill(code);
  await rider.page.getByRole("button", { name: "Confirm handover" }).click();
  await expect(rider.page.getByText(/Receipt RC-/)).toBeVisible();
  // What the rider earned, confirmed by the provider, sits on the home screen.
  await rider.page.goto("/home");
  await expect(rider.page.getByTestId("earnings")).toBeVisible();
  // The customer's verify link shows the village drop like any other purchase (§8.8.7).
  const receiptLink = (await lastSms(request, "RECEIPT")).match(/https?:\/\/\S+\/verify\/[A-Za-z0-9_-]+\?t=[A-Za-z0-9_-]+/)![0];
  await rider.page.goto(receiptLink);
  await english(rider.page);
  await expect(rider.page.getByText("Handover completed")).toBeVisible();
  await expect(rider.page.getByTestId("receipt")).toContainText("11,400 TZS");
  await rider.ctx.close();
});

test("organisation sale: added and activated by two admins; the supplier sells, the organisation pays in full, delivery sends the receipt; the ecosystem view shows it", async ({ browser, request }) => {
  const a = await adminLogin(browser, SEED.adminA);
  await english(a.page);
  await a.page.goto("/admin/organisations");
  await a.page.getByLabel("Name", { exact: true }).fill("Tumaini Primary School (TEST)");
  await a.page.getByLabel("Type").selectOption("SCHOOL");
  await a.page.getByLabel("Contact name").fill("Head teacher (TEST)");
  await a.page.getByLabel(/Contact phone/).fill("+255700000058");
  await a.page.getByRole("button", { name: "Add organisation" }).click();
  await expect(a.page).toHaveURL(/\/admin\/organisations\/[0-9a-f-]+\?ok=created/);
  await a.page.getByTestId("request-activation").click();
  await expect(a.page.getByTestId("activation-pending")).toBeVisible();
  await a.ctx.close();

  const b = await adminLogin(browser, SEED.adminB);
  await english(b.page);
  await b.page.goto("/admin/approvals");
  const req = b.page.getByTestId("approval").filter({ hasText: "STAKEHOLDER ACTIVATE" }).filter({ hasText: "Tumaini" }).first();
  await req.getByRole("button", { name: "Approve" }).click();
  await expect(b.page).toHaveURL(/ok=decided/);
  await b.page.goto("/admin/organisations");
  await expect(b.page.getByTestId("organisation-row").filter({ hasText: "Tumaini" })).toContainText("Active");
  // What an organisation pays is a price-list decision (§8.8.6): a new list with an organisation price, dual-approved.
  await b.page.setViewportSize({ width: 1280, height: 900 }); // price lists are laptop work
  await b.page.goto("/admin/prices/new");
  const prices: Record<string, [number, number, number, number, number]> = { "Standard kit (reusable)": [7500, 8000, 9000, 11400, 9500], "Disposable pack": [3000, 3300, 3800, 4500, 4000] };
  for (const [name, row] of Object.entries(prices)) {
    const cols = ["supplierPriceTzs", "hubPriceTzs", "championPriceTzs", "customerPriceTzs", "organisationPriceTzs"] as const;
    for (let i = 0; i < cols.length; i++) await b.page.getByLabel(`${name} ${cols[i]}`).fill(String(row[i]));
  }
  await b.page.getByRole("button", { name: "Draft a new price list" }).click();
  await expect(b.page).toHaveURL(/\/admin\/prices\?ok=submitted/);
  await b.ctx.close();
  const a2 = await adminLogin(browser, SEED.adminA);
  await english(a2.page);
  await a2.page.goto("/admin/approvals");
  await a2.page.getByTestId("approval").filter({ hasText: "PRICE LIST ACTIVATE" }).first().getByRole("button", { name: "Approve" }).click();
  await expect(a2.page).toHaveURL(/ok=decided/);
  await a2.page.goto("/admin/prices");
  await expect(a2.page.getByText("9,500 TZS").first()).toBeVisible();
  await a2.ctx.close();

  // The supplier sells; nothing moves before the provider confirms the full amount (§8.8.3).
  const supplier = await fieldLogin(browser, SEED.supplier.phone, SEED.supplier.pin);
  await english(supplier.page);
  await supplier.page.getByTestId("org-sale-link").click();
  await supplier.page.getByLabel("Organisation").selectOption({ label: "Tumaini Primary School (TEST) · School" });
  await supplier.page.getByLabel("Product").selectOption({ label: "Standard kit (reusable)" });
  await supplier.page.getByLabel("Units").fill("10");
  await supplier.page.getByRole("button", { name: "Create order" }).click();
  await expect(supplier.page).toHaveURL(/\/orders\/[0-9a-f-]+\?ok=created/);
  const ref = await currentOrderRef(supplier.page);
  // The organisation gets the payee, a payment reference and the record's link — and the organisation price, never the customer price.
  const orgSms = await lastSms(request, "ORG_SALE");
  expect(orgSms).toContain("95,000 TZS");
  expect(orgSms).toContain("TILL-DANDELION-001"); // Dandelion collects (Prompt L §2.1)
  expect(orgSms).toMatch(/\/verify\//);
  void ref;
  expect(await supplier.page.getByRole("button", { name: "Confirm delivery" }).count()).toBe(0);
  // While it is in flight, the ecosystem graph draws the direct path as a dashed edge (§8.8.7).
  const g = await adminLogin(browser, SEED.adminB);
  await g.page.setViewportSize({ width: 1280, height: 900 });
  await g.page.goto("/admin/ecosystem");
  await expect(g.page.locator('[data-testid="flow-edge"][data-kind="SUPPLIER_TO_ORG"]').first()).toHaveAttribute("stroke-dasharray", "6 4");
  await g.ctx.close();
  const paid = (await sim(request, { op: "simulate", scenario: "success", orderRef: ref })) as { outcomes: string[] };
  expect(paid.outcomes).toContain("CONFIRMED");
  await supplier.page.reload();
  await supplier.page.getByRole("button", { name: "Confirm delivery" }).click();
  await expect(supplier.page.getByTestId("receipt-sent")).toBeVisible();
  expect(await lastSms(request, "RECEIPT")).toMatch(/RC-\d{8}-[A-Z0-9]+/); // the receipt number, whatever the language
  await supplier.ctx.close();

  // The organisation is a node of the ecosystem, listed by name and never by the people it serves.
  const c = await adminLogin(browser, SEED.adminA);
  await english(c.page);
  await c.page.goto("/admin/ecosystem?window=7d");
  await expect(c.page.getByTestId("flow-table")).toContainText("Tumaini Primary School (TEST)");
  await expect(c.page.getByTestId("money-SUPPLIER_TO_ORG")).toBeVisible();
  await c.ctx.close();
});

test("roads and rains: an admin records a far dirt road; restocking plans for it and the Stock page says so", async ({ browser }) => {
  // Prompt I §2.1: planning data, one admin, logged — never pay.
  const a = await adminLogin(browser, SEED.adminA);
  await english(a.page);
  await a.page.goto("/admin/areas");
  const area = a.page.getByTestId("area-card").first();
  const roads = area.getByTestId("area-roads");
  await expect(roads).toContainText("Roads and rains");
  const hub = roads.getByTestId("hub-road").first();
  await expect(hub.getByTestId("hub-lead")).toContainText(/Restocking plans for \d+ days? from pickup to shelf/);
  const before = Number((await hub.getByTestId("hub-lead").innerText()).match(/plans for (\d+)/)![1]);
  await hub.getByLabel("Km from town").fill("95");
  await hub.getByLabel("Worst stretch of road").selectOption("DIRT");
  await hub.getByLabel("The rains slow this road").check();
  await hub.getByRole("button", { name: "Save road" }).click();
  await expect(a.page).toHaveURL(/ok=roadSaved/);
  const after = a.page.getByTestId("area-card").first().getByTestId("hub-road").first().getByTestId("hub-lead");
  // Dirt (2 days) + far (1 day) instead of a day on an unknown road: two days more.
  await expect(after).toContainText(`Restocking plans for ${before + 2} days`);
  await a.page.goto("/admin/inventory");
  await expect(a.page.getByTestId("restock-road").first()).toContainText("Dirt · 95 km");
  await a.ctx.close();
});

test("payouts: a supplier asks to withdraw from the wallet; one admin approves, a different admin sends; the supplier sees it sent", async ({ browser }) => {
  // Prompt L §2: buyers paid Dandelion's account in the earlier flows; the supplier's share is in their balance.
  const supplier = await fieldLogin(browser, SEED.supplier.phone, SEED.supplier.pin);
  await english(supplier.page);
  await supplier.page.goto("/home");
  await expect(supplier.page.getByTestId("wallet-card")).toBeVisible();
  await supplier.page.getByTestId("wallet-link").click();
  await expect(supplier.page.getByRole("heading", { name: "My wallet" })).toBeVisible();
  await supplier.page.getByLabel("Amount (TZS)").fill("1000");
  await supplier.page.getByRole("button", { name: "Ask to withdraw" }).click();
  await expect(supplier.page).toHaveURL(/ok=withdrawalRequested/);
  await expect(supplier.page.getByTestId("withdrawal-row").first()).toHaveAttribute("data-state", "REQUESTED");
  await expect(supplier.page.getByTestId("wallet-waiting")).toBeVisible();

  const a = await adminLogin(browser, SEED.adminA);
  await english(a.page);
  await a.page.goto("/admin");
  await expect(a.page.getByTestId("need-payoutsToApprove")).toBeVisible();
  await a.page.goto("/admin/payouts");
  const row = a.page.getByTestId("payout-row").filter({ hasText: "1,000" }).first();
  await row.getByTestId("payout-approve").click();
  await expect(a.page).toHaveURL(/ok=approved/);
  // The approver cannot also send it.
  await expect(a.page.getByTestId("payout-row").first().getByTestId("payout-needs-other")).toBeVisible();
  await a.ctx.close();

  const b = await adminLogin(browser, SEED.adminB);
  await english(b.page);
  await b.page.goto("/admin/payouts");
  await b.page.getByTestId("payout-row").first().getByTestId("payout-simulate").click();
  await expect(b.page).toHaveURL(/ok=sent/);
  await expect(b.page.getByTestId("payouts-none")).toBeVisible();
  await b.ctx.close();

  await supplier.page.goto("/wallet");
  await expect(supplier.page.getByTestId("withdrawal-row").first()).toHaveAttribute("data-state", "SENT");
  await supplier.ctx.close();
});

test("shop: a customer joins with her phone, orders to a public meeting point, a delivery partner accepts, she pays and receives it", async ({ browser, request }) => {
  // Prompt L §3. The area allows delivery partners to sell to customers (switched on above) and has two meeting points.
  const c = await browser.newContext();
  const page = await c.newPage();
  await page.goto("/");
  await english(page);
  await page.getByTestId("shop-cta").click();
  await expect(page.getByTestId("shop-catalogue")).toContainText("Test Village (TEST)");
  await page.getByTestId("shop-join").click();
  await page.getByLabel("Your name").fill("Shop customer (TEST)");
  await page.getByLabel("Phone number").fill("+255700000071");
  await page.getByLabel("Meeting point").selectOption({ label: "Market gate (TEST)" });
  await page.getByLabel(/receive SMS about my orders/).check();
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page).toHaveURL(/\/shop\/verify\?c=/);
  await page.getByLabel("Code from the SMS").fill(digits(await lastSms(request, "OTP"), 6));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/shop\?ok=signedIn/);
  await expect(page.getByRole("heading", { name: "Habari Shop customer (TEST)" })).toBeVisible();
  await page.getByRole("radio", { name: /Standard kit/ }).check();
  await page.getByRole("button", { name: "Send my order" }).click();
  await expect(page).toHaveURL(/ok=requested/);
  await expect(page.getByTestId("shop-order-row").first()).toHaveAttribute("data-state", "OPEN");
  await expect(page.getByTestId("shop-order")).toHaveCount(0); // one order at a time

  // The delivery partner who holds kits sees her request on his home screen and accepts it.
  const rider = await fieldLogin(browser, SEED.riders[0]!.phone, SEED.riders[0]!.pin);
  await english(rider.page);
  // Requests are grouped by meeting point, with the place's usual time, so one trip serves several.
  const here = rider.page.getByTestId("shop-request-place").filter({ hasText: "Market gate (TEST)" });
  await expect(here).toBeVisible();
  await here.getByTestId("shop-request-row").first().getByTestId("shop-request-accept").click();
  await expect(rider.page).toHaveURL(/\/orders\/[0-9a-f-]+\?ok=requestAccepted/);
  await expect(rider.page.getByTestId("shop-meeting")).toContainText("Market gate (TEST)");
  const saleRef = await currentOrderRef(rider.page);
  const saleId = rider.page.url().match(/orders\/([0-9a-f-]+)/)![1]!;

  // She sees who accepted, and how to pay Dandelion's account with her reference.
  await page.goto("/shop");
  await expect(page.getByTestId("shop-pay")).toContainText("TILL-DANDELION-001");
  expect(await lastSms(request, "SHOP_REQUEST")).toContain("Market gate (TEST)");
  const paid = (await sim(request, { op: "simulate", scenario: "success", orderRef: saleRef })) as { outcomes: string[] };
  expect(paid.outcomes).toContain("CONFIRMED");
  await page.goto("/shop");
  await expect(page.getByTestId("shop-meet")).toBeVisible();

  // Hand-over at the meeting point with her code.
  await rider.page.goto(`/orders/${saleId}`);
  await rider.page.getByRole("button", { name: "Start handover" }).click();
  await expect(rider.page.getByRole("heading", { name: "Handover required" })).toBeVisible();
  const code = digits(await lastSms(request, "HANDOVER_CODE"), 6);
  for (const label of KIT_EDUCATION) await rider.page.getByLabel(label).check();
  await rider.page.getByLabel("Customer's code").fill(code);
  await rider.page.getByRole("button", { name: "Confirm handover" }).click();
  await expect(rider.page.getByText(/Receipt RC-/)).toBeVisible();
  await rider.ctx.close();

  await page.goto("/shop");
  await expect(page.getByTestId("shop-order-row").first()).toHaveAttribute("data-order-state", "COMPLETED");
  await expect(page.getByTestId("shop-order")).toBeVisible(); // she can order again
  // The private "report a problem" is on her order; the seller never sees who reported.
  await page.getByTestId("shop-report").first().locator("summary").click();
  await page.getByLabel(/asked for more money/).check();
  await page.getByRole("button", { name: "Send to Dandelion" }).click();
  await expect(page).toHaveURL(/ok=reported/);
  await page.getByTestId("shop-sign-out").click();
  await expect(page).toHaveURL(/ok=signedOut/);
  await expect(page.getByTestId("shop-join")).toBeVisible();

  // The public impact page: totals only.
  await page.goto("/");
  await page.getByTestId("impact-link").click();
  await expect(page.getByTestId("impact-money")).toBeVisible();
  await expect(page.getByTestId("impact-handovers")).toBeVisible();
  await c.close();

  // The admins: shop health per area, and the to-do list sends them there.
  const a = await adminLogin(browser, SEED.adminA);
  await english(a.page);
  await a.page.goto("/admin/shop");
  await expect(a.page.getByTestId("shop-area").first()).toContainText("Test Village (TEST)");
  await expect(a.page.getByTestId("shop-accepted").first()).toContainText("%");
  await a.ctx.close();
});
