/**
 * Ledger leaves (review correction §4.4).
 *
 * Each event is canonical JSON with only: event type, subject ref
 * (orderRef or batch code), amount, role, and a day-granularity date.
 * It is hashed with a per-event random 32-byte salt, so a published root or
 * proof cannot be brute-forced back to low-entropy event contents.
 *
 *   leaf = keccak256(0x00 ‖ salt ‖ keccak256(utf8(canonical)))
 *
 * The 0x00 prefix domain-separates leaves from interior nodes (0x01).
 */
import { randomBytes } from "node:crypto";
import { concat, keccak256, toBytes, toHex, type Hex } from "viem";
import type { LedgerEventType } from "@/lib/domain/types";

export interface LedgerFact {
  type: LedgerEventType;
  ref: string;
  amountTzs: number | null;
  role: string | null;
  date: string; // YYYY-MM-DD, Africa/Dar_es_Salaam
}

/** Deterministic JSON: fixed key order, no whitespace. */
export function canonicalJson(f: LedgerFact): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) throw new Error("date must be YYYY-MM-DD");
  if (f.amountTzs !== null && (!Number.isSafeInteger(f.amountTzs) || f.amountTzs < 0)) throw new Error("amount must be integer TZS");
  const ordered = { amountTzs: f.amountTzs, date: f.date, ref: f.ref, role: f.role, type: f.type, v: 1 };
  return JSON.stringify(ordered);
}

export function newSalt(): Hex {
  return toHex(randomBytes(32));
}

export function leafHash(canonical: string, salt: Hex): Hex {
  return keccak256(concat([toHex(0, { size: 1 }), salt, keccak256(toBytes(canonical))]));
}
