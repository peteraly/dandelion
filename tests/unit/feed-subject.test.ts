/**
 * Prompt D §5.7: the live feed shows a subject only when a person would
 * recognise it as a reference.
 */
import { describe, expect, it } from "vitest";
import { isHumanRef } from "@/lib/domain/events";

describe("feed subjects", () => {
  it("keeps order, batch, exception, receipt, approval and reconciliation references", () => {
    for (const s of ["OR-39F486", "B-8YDVAW", "EX-K2M9QP", "RC-20260930-MX77J", "AP-7HJ2KL", "RECON-2026-09-29", "PL-v3", "S-3f9a2b1c0d", "O-9a8b7c6d5e"]) expect(isHumanRef(s), s).toBe(true);
  });
  it("drops internal words and anything that is not a reference", () => {
    for (const s of ["session", "statement", "", "OR-", "OR-1", "user:1234", "x-1", "or 39F486"]) expect(isHumanRef(s), s).toBe(false);
  });
});
