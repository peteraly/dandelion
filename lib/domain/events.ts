/**
 * The names the logs may carry. Typed so a new event or action cannot be
 * logged without a label for the ecosystem feed (tests/unit/ecosystem-labels).
 * Security event types are UPPER_SNAKE; admin actions are dotted lower-case.
 */
import type { ExceptionType } from "./types";

export const SECURITY_EVENT_TYPES = [
  "OPEN_DEMO_ENTRY",
  "ACCOUNT_LOCKED",
  "ADMIN_2FA_FAILED",
  "ADMIN_PASSKEY_REGISTERED",
  "ANCHOR_WALLET_LOW_BALANCE",
  "CALLBACK_DUPLICATE",
  "CALLBACK_RATE_LIMITED",
  "CALLBACK_REJECTED",
  "CALLBACK_SIGNATURE_INVALID",
  "CALLBACK_SPOOFED",
  "DEMO_RESET",
  "DONOR_FUNDING_APPROVED",
  "DUPLICATE_APPROVAL_ATTEMPT",
  "ENROLL_PHONE_MISMATCH",
  "EXPORT",
  "LOGIN_WHILE_LOCKED",
  "ORGANISATION_ACTIVATED",
  "ORGANISATION_DEACTIVATED",
  "OTP_BURST",
  "OTP_NEW_DEVICE",
  "OTP_REQUESTED",
  "PAYMENT_REVERSED",
  "PIN_FAILED",
  "PIN_RESET_BY_ADMIN",
  "PIN_TEMP_LOCKOUT",
  "SELF_APPROVAL_ATTEMPT",
  "STATEMENT_IMPORTED",
  "SUPPLIER_ACTIVATED",
  "SUPPLIER_DEACTIVATED",
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number] | `PROBLEM_${ExceptionType}`;

export const ADMIN_ACTIONS = [
  "admin.enrolled",
  "approval.approve",
  "approval.reject",
  "approval.request",
  "area.rains.update",
  "area.sales.change",
  "data_request.create",
  "data_request.handle",
  "demo.journey",
  "demo.reset",
  "demo.tick",
  "donor_funding.approved",
  "ecosystem.view",
  "exception.resolved",
  "export.csv",
  "hub.road.update",
  "message.send",
  "org_sale.cancel",
  "org_sale.create",
  "org_sale.deliver",
  "organisation.activate",
  "organisation.create",
  "organisation.deactivate",
  "organisation.update",
  "payout.approve",
  "payout.reject",
  "payout.send",
  "pickup.create",
  "pricelist.draft",
  "recon.flag.resolve",
  "statement.import",
  "supplier.activate",
  "supplier.create",
  "supplier.deactivate",
  "supplier.product.offer",
  "supplier.product.withdraw",
  "supplier.update",
  "user.create",
  "user.lock",
  "user.reenroll",
  "user.suspend",
  "user.unsuspend",
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** A security event type as stored, split into the label key and the problem type it carries. */
export function securityLabelKey(type: string): { key: string; problem: string | null } {
  if (type.startsWith("PROBLEM_")) return { key: "PROBLEM", problem: type.slice("PROBLEM_".length) };
  return { key: (SECURITY_EVENT_TYPES as readonly string[]).includes(type) ? type : "UNKNOWN", problem: null };
}

/**
 * Prompt D §5.7: a feed subject is shown only when a person would recognise
 * it as a reference (order, batch, exception, receipt, approval, price list,
 * reconciliation run) — never internal words like "session" or "statement".
 */
export function isHumanRef(subject: string): boolean {
  return /^(OR|B|EX|RC|AP|PL|RECON|S|O)-[A-Za-z0-9][A-Za-z0-9-]+$/.test(subject.trim());
}
