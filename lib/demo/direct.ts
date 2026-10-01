/**
 * The direct sale paths of prompt §8.8 in the demo: riders keep stock and
 * sell in villages, customers and champions buy at the factory gate, and
 * organisations buy in bulk from suppliers, hubs and riders. Every step goes
 * through the same services the field app uses; anomalies are deliberate and
 * in the manifest.
 */
import { acceptPickup, adminCreatePickup, confirmBatchReady, confirmReceipt, confirmRelease, createOrgSale, deliverOrgSale, startHandover } from "@/lib/services/orders";
import { tzDay } from "@/lib/util/time";
import type { Hub, OrgBuyer, Person, Product, World } from "./world";
import { enrolCustomer, pay, startCustomerPlan, type Plan } from "./supply";
import { shopOrder } from "./shop";

const CHECKS = { quantityOk: true, sealOk: true };

/** A pickup the rider keeps as own stock (no hub behind it): supplier → rider, custody ends WITH_RIDER. */
export async function riderStockPickup(w: World, rider: Person, product: Product, quantity: number): Promise<string> {
  const area = w.areas[0]!; // riders are not bound to an area; the demo buys rider stock in the first one
  const org = w.pickSupplier(area);
  const supplierUser = w.rng.pick(org.users);
  const { orderId } = await adminCreatePickup(w.adminA, { supplierId: org.id, productId: product.id, buyerUserId: rider.actor.userId, quantity, pickupDate: tzDay() });
  w.manifest.count("orders.SUPPLIER_TO_RIDER");
  w.manifest.count("paths.rider_stock_pickups");
  w.tick(30, 90);
  await confirmBatchReady(supplierUser.actor, orderId, `SEAL-${w.rng.int(10000, 99999)}`, { packedWaterproof: true });
  w.tick(15, 45);
  await acceptPickup(rider.actor, orderId, { rainCover: true });
  w.tick(5, 20);
  await pay(w, orderId, "success");
  w.tick(5, 20);
  await confirmRelease(supplierUser.actor, orderId);
  w.tick(3, 10);
  await confirmReceipt(rider.actor, orderId, CHECKS);
  return orderId;
}

/** A champion collects her own stock at the factory gate (SUPPLIER_TO_CHAMPION). */
export async function championCollects(w: World, hub: Hub, champion: Person, product: Product, quantity: number): Promise<string> {
  const area = w.areas.find((a) => a.id === hub.areaId)!;
  const org = area.suppliers[0]!;
  const supplierUser = w.rng.pick(org.users);
  const { orderId } = await adminCreatePickup(w.adminA, { supplierId: org.id, productId: product.id, buyerUserId: champion.actor.userId, quantity, pickupDate: tzDay() });
  w.manifest.count("orders.SUPPLIER_TO_CHAMPION");
  w.tick(30, 90);
  await confirmBatchReady(supplierUser.actor, orderId, `SEAL-${w.rng.int(10000, 99999)}`, { packedWaterproof: true });
  w.tick(15, 45);
  await acceptPickup(champion.actor, orderId, { rainCover: true });
  w.tick(5, 20);
  await pay(w, orderId, "success");
  w.tick(5, 20);
  await confirmRelease(supplierUser.actor, orderId);
  w.tick(3, 10);
  await confirmReceipt(champion.actor, orderId, CHECKS);
  return orderId;
}

/** A customer enrolled and served by a rider (village drop) or by a supplier user (factory gate): a plan like any other. */
export async function directPlan(w: World, seller: Person, product: Product, day: number): Promise<Plan> {
  const c = await enrolCustomer(w, seller);
  w.tick(5, 30);
  const plan = await startCustomerPlan(w, c, product, day);
  w.manifest.count(seller.actor.role === "BOSS_RIDER" ? "paths.village_drops" : "paths.factory_gate_customers");
  return plan;
}

/** Bulk sale to an organisation, paid in full then delivered; or left unpaid on purpose. */
export async function orgSale(w: World, seller: Person, org: OrgBuyer, product: Product, quantity: number, outcome: "delivered" | "unpaid" = "delivered"): Promise<string> {
  const { orderId } = await createOrgSale(seller.actor, { organisationId: org.id, productId: product.id, quantity });
  const o = await w.order(orderId);
  w.manifest.count(`orders.${o.kind}`);
  w.manifest.count("paths.organisation_sales");
  if (outcome === "unpaid") {
    w.manifest.anomaly("ORG_ORDER_UNPAID", `${org.name} has not paid order ${o.ref}; nothing was delivered`, { orderRef: o.ref });
    return orderId;
  }
  w.tick(60, 600);
  await pay(w, orderId, "success");
  w.tick(30, 240);
  await deliverOrgSale(seller.actor, orderId);
  w.manifest.count("paths.organisation_deliveries");
  return orderId;
}

/**
 * A working day's direct activity. Guaranteed pieces happen once, on the first
 * day they can (`w.once`); the rest is probabilistic so the dataset varies by
 * seed but every path appears in every run.
 */
export async function directDay(w: World, plans: Plan[], day: number, totalDays: number): Promise<void> {
  const rng = w.rng;
  const attempt = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      w.manifest.skip(`direct/${name}`, e);
    }
    w.tick(5, 30);
  };
  const rider = w.riders[w.riders.length - 1]!; // the last rider is the one who works the villages
  const disposable = w.product("DISPOSABLE");
  const area0 = w.areas[0]!;
  const orgs = w.organisations.filter((o) => o.areaId === area0.id);
  const hub = w.hubs[0]!;

  // Rider stock: top up when the village rider runs low.
  if ((await w.sellerStock(rider, disposable.id)) < 6 && (day >= 2 || totalDays > 1000)) {
    await attempt("riderStockPickup", async () => void (await riderStockPickup(w, rider, disposable, rng.int(20, 40))));
  }
  // Village drops: one every other working day once the rider holds stock.
  if ((await w.sellerStock(rider, disposable.id)) >= 1 && (rng.chance(0.5) || w.once("villageDrop.first"))) {
    await attempt("villageDrop", async () => void plans.push(await directPlan(w, rider, disposable, day)));
  }
  // The shop (Prompt L §3): a girl or woman joins with her phone and orders; the village delivery partner accepts.
  if ((await w.sellerStock(rider, disposable.id)) >= 1 && (rng.chance(0.35) || w.once("shop.first"))) {
    await attempt("shopOrder", async () => {
      const plan = await shopOrder(w, rider, disposable, day);
      if (plan) plans.push(plan);
    });
  }
  // Some ask for a woman local seller; one of the first hub's local sellers who holds the product takes it.
  const localSeller = hub.champions.find((c) => !w.busy.has(c.actor.userId));
  if (localSeller && day >= 3 && (await w.sellerStock(localSeller, disposable.id)) >= 1 && (rng.chance(0.2) || w.once("shop.womenOnly.first"))) {
    await attempt("shopOrderWomenOnly", async () => {
      const plan = await shopOrder(w, localSeller, disposable, day, { womenOnly: true });
      if (plan) plans.push(plan);
    });
  }
  // One seller does not come in time (Prompt M §3.1): she pays in full, he never hands over, and the next night the
  // order passes to the next seller with stock, her payment with it; a local seller takes it the day after.
  if (day >= 4 && day < totalDays - 3 && totalDays < 1000 && (await w.sellerStock(rider, disposable.id)) >= 1 && w.once("shop.late")) {
    await attempt("shopLate", async () => {
      const plan = await shopOrder(w, rider, disposable, day);
      if (!plan) return;
      plan.late = true;
      plan.installments = [plan.totalTzs];
      plan.nextPaymentDay = day;
      plans.push(plan);
    });
  }
  // On the last day one shop request is left waiting for a seller.
  if (day >= totalDays - 1 && totalDays < 1000 && w.once("shop.waiting")) {
    await attempt("shopWaiting", async () => void (await shopOrder(w, rider, disposable, day, { accept: false })));
  }
  // Factory-gate customers: a couple over the run.
  if (rng.chance(0.25) || w.once("factoryGate.first")) {
    const supplierUser = area0.suppliers[0]!.users[0]!;
    await attempt("factoryGateCustomer", async () => void plans.push(await directPlan(w, supplierUser, disposable, day)));
  }
  // A champion collects her own stock once.
  if (day >= 3 && w.once("championCollects")) {
    await attempt("championCollects", async () => void (await championCollects(w, hub, hub.champions[hub.champions.length - 1]!, disposable, rng.int(8, 15))));
  }
  // Organisations: the supplier sells to one, the hub to another; one order is left unpaid near the end.
  if (orgs.length) {
    if (day >= 4 && (rng.chance(0.15) || w.once("orgSale.supplier"))) {
      await attempt("orgSale.supplier", async () => void (await orgSale(w, area0.suppliers[0]!.users[0]!, rng.pick(orgs), w.product(), rng.int(20, 60))));
    }
    if (day >= 5 && (rng.chance(0.12) || w.once("orgSale.hub"))) {
      if ((await w.hubStock(hub, disposable.id)) >= 10) await attempt("orgSale.hub", async () => void (await orgSale(w, hub.manager, rng.pick(orgs), disposable, rng.int(5, 10))));
    }
    if (day >= 6 && (await w.sellerStock(rider, disposable.id)) >= 5 && w.once("orgSale.rider")) {
      await attempt("orgSale.rider", async () => void (await orgSale(w, rider, rng.pick(orgs), disposable, 5)));
    }
    if (day >= totalDays - 5 && totalDays < 1000 && w.once("orgSale.unpaid")) {
      await attempt("orgSale.unpaid", async () => void (await orgSale(w, area0.suppliers[0]!.users[0]!, rng.pick(orgs), w.product(), rng.int(10, 30), "unpaid")));
    }
  }
  // A village-drop handover whose code was never confirmed (last days only).
  if (day >= totalDays - 2 && totalDays < 1000 && w.once("villageDrop.codeUnconfirmed")) {
    await attempt("villageDrop.codeUnconfirmed", async () => {
      const target = plans.find((p) => !p.handedOver && p.customer.champion === rider && p.installments.length > 0);
      if (!target) throw new Error("no open village-drop plan");
      if ((await w.sellerStock(rider, target.product.id)) < 1) throw new Error("rider holds no stock for the handover");
      target.installments = [];
      await pay(w, target.orderId, "success");
      target.paidTzs = target.totalTzs;
      target.nextPaymentDay = null;
      w.tick(10, 40);
      await startHandover(rider.actor, target.orderId);
      target.handedOver = true; // frozen: the code is never entered
      w.manifest.anomaly("VILLAGE_DROP_CODE_UNCONFIRMED", "rider sent the handover code on a village drop; the customer never confirmed", { orderRef: target.ref });
    });
  }
}
