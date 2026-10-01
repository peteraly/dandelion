/**
 * The direct sale paths of prompt §8.8 in the demo: riders keep stock and
 * sell it to organisations (a village pharmacy, a school), champions buy at
 * the factory gate, and organisations buy in bulk from suppliers, hubs and
 * riders. Riders and supplier staff never sell to customers (safeguarding,
 * lib/domain/sales.ts CLOSED_KINDS): every customer is a local seller's.
 * Every step goes through the same services the field app uses; anomalies
 * are deliberate and in the manifest.
 */
import { acceptPickup, adminCreatePickup, confirmBatchReady, confirmReceipt, confirmRelease, createOrgSale, deliverOrgSale, startHandover } from "@/lib/services/orders";
import { tzDay } from "@/lib/util/time";
import type { Hub, OrgBuyer, Person, Product, World } from "./world";
import { pay, type Plan } from "./supply";

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
  await confirmBatchReady(supplierUser.actor, orderId, `SEAL-${w.rng.int(10000, 99999)}`);
  w.tick(15, 45);
  await acceptPickup(rider.actor, orderId);
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
  await confirmBatchReady(supplierUser.actor, orderId, `SEAL-${w.rng.int(10000, 99999)}`);
  w.tick(15, 45);
  await acceptPickup(champion.actor, orderId);
  w.tick(5, 20);
  await pay(w, orderId, "success");
  w.tick(5, 20);
  await confirmRelease(supplierUser.actor, orderId);
  w.tick(3, 10);
  await confirmReceipt(champion.actor, orderId, CHECKS);
  return orderId;
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
    // The rider's own stock goes to organisations (a village pharmacy, a school), never to a customer.
    if (day >= 6 && (await w.sellerStock(rider, disposable.id)) >= 5 && (rng.chance(0.3) || w.once("orgSale.rider"))) {
      await attempt("orgSale.rider", async () => void (await orgSale(w, rider, rng.pick(orgs), disposable, 5)));
    }
    if (day >= totalDays - 5 && totalDays < 1000 && w.once("orgSale.unpaid")) {
      await attempt("orgSale.unpaid", async () => void (await orgSale(w, area0.suppliers[0]!.users[0]!, rng.pick(orgs), w.product(), rng.int(10, 30), "unpaid")));
    }
  }
  // A local seller's handover whose code was never confirmed (last days only).
  if (day >= totalDays - 2 && totalDays < 1000 && w.once("handover.codeUnconfirmed")) {
    await attempt("handover.codeUnconfirmed", async () => {
      let target: Plan | undefined;
      for (const p of plans) {
        const champion = p.customer.champion;
        if (p.handedOver || !p.installments.length || champion.actor.role !== "FIELD_CHAMPION" || w.busy.has(champion.actor.userId)) continue;
        if ((await w.sellerStock(champion, p.product.id)) >= 1) {
          target = p;
          break;
        }
      }
      if (!target) throw new Error("no open plan whose local seller holds the product");
      const seller = target.customer.champion;
      target.installments = [];
      await pay(w, target.orderId, "success");
      target.paidTzs = target.totalTzs;
      target.nextPaymentDay = null;
      w.tick(10, 40);
      await startHandover(seller.actor, target.orderId);
      target.handedOver = true; // frozen: the code is never entered
      w.manifest.anomaly("HANDOVER_CODE_UNCONFIRMED", "a local seller sent the handover code; the customer never confirmed", { orderRef: target.ref });
    });
  }
}
