/**
 * The guided walkthrough's steps and saved progress (Prompt H), with no
 * database or service imports, so the demo loader can read which orders the
 * walkthrough is driving without importing the walkthrough itself.
 */
export type JourneyRole = "customer" | "seller" | "hub" | "rider" | "supplier" | "founder";

/** The walkthrough, in order: who acts, and which phones light up. */
export const JOURNEY_STEPS = [
  { key: "enrol", who: "seller", phones: ["seller", "customer"] },
  { key: "verify", who: "customer", phones: ["customer", "seller"] },
  { key: "plan", who: "seller", phones: ["seller", "customer"] },
  { key: "payPart", who: "customer", phones: ["customer", "seller"] },
  { key: "payRest", who: "customer", phones: ["customer", "seller"] },
  { key: "handoverStart", who: "seller", phones: ["seller", "customer"] },
  { key: "handoverDone", who: "customer", phones: ["customer", "seller"] },
  { key: "restockRequest", who: "seller", phones: ["seller", "hub"] },
  { key: "restockPrepare", who: "hub", phones: ["hub", "seller"] },
  { key: "restockPay", who: "seller", phones: ["seller", "hub"] },
  { key: "restockHandover", who: "hub", phones: ["hub", "seller"] },
  { key: "pickupAssign", who: "founder", phones: ["rider", "supplier"] },
  { key: "batchReady", who: "supplier", phones: ["supplier", "rider"] },
  { key: "pickupAccept", who: "rider", phones: ["rider", "supplier"] },
  { key: "pickupPay", who: "rider", phones: ["rider", "supplier"] },
  { key: "pickupHandover", who: "supplier", phones: ["supplier", "rider"] },
  { key: "arrive", who: "rider", phones: ["rider", "hub"] },
  { key: "inspect", who: "hub", phones: ["hub", "rider"] },
  { key: "deliveryPay", who: "hub", phones: ["hub", "rider"] },
  { key: "deliveryRelease", who: "rider", phones: ["rider", "hub"] },
] as const satisfies readonly { key: string; who: JourneyRole; phones: readonly JourneyRole[] }[];
export type JourneyStepKey = (typeof JOURNEY_STEPS)[number]["key"];

export interface JourneyLogEntry {
  key: JourneyStepKey;
  at: string;
  /** Short facts for the step's line, e.g. the order reference and the amount; rendered through labels. */
  facts: Record<string, string | number>;
}

export interface JourneyState {
  /** Index of the next step; JOURNEY_STEPS.length when finished. */
  step: number;
  startedAt: string;
  /** When the last step ran: messages newer than this are "just arrived". */
  lastAt: string;
  hubId: string;
  sellerId: string;
  riderId: string;
  supplierUserId: string;
  supplierId: string;
  productId: string;
  customerName: string;
  customerPhone: string;
  customerId?: string;
  challengeId?: string;
  planId?: string;
  restockId?: string;
  pickupId?: string;
  deliveryId?: string;
  log: JourneyLogEntry[];
  error?: string;
}

export function parseJourney(raw: unknown): JourneyState | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || typeof (v as JourneyState).step !== "number" || !Array.isArray((v as JourneyState).log)) return null;
  return v as JourneyState;
}

/** Orders the walkthrough is driving; the live engine leaves them alone (lib/demo/load.ts). */
export function journeyOrderIds(st: JourneyState | null): string[] {
  if (!st || st.step >= JOURNEY_STEPS.length) return [];
  return [st.planId, st.restockId, st.pickupId, st.deliveryId].filter((x): x is string => !!x);
}
