/**
 * Red-team fixes (docs/REVIEW.md → "Red team"): the two redirect sinks accept
 * only same-origin paths, and CSV exports never hand a spreadsheet a formula.
 */
import { describe, expect, it } from "vitest";
import { returnPath } from "@/lib/security/request";
import { csvCell } from "@/lib/services/admin";

describe("return paths", () => {
  it("keeps same-origin paths and rejects everything that would leave the site", () => {
    expect(returnPath("/admin/ecosystem?window=7d")).toBe("/admin/ecosystem?window=7d");
    expect(returnPath("/")).toBe("/");
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/x\r\nLocation: https://evil.example", "", null, undefined, 42, "admin"]) {
      expect(returnPath(bad as string), String(bad)).toBeNull();
    }
  });
  it("can be limited to a set of routes", () => {
    const within = ["/admin/ecosystem", "/admin/demo"];
    expect(returnPath("/admin/demo", within)).toBe("/admin/demo");
    expect(returnPath("/admin/ecosystem?attention=lockedBatches", within)).toBe("/admin/ecosystem?attention=lockedBatches");
    expect(returnPath("/admin/ecosystems", within)).toBeNull();
    expect(returnPath("/admin/settings", within)).toBeNull();
  });
});

describe("csv cells", () => {
  it("neutralises formula-looking free text and leaves numbers, dates and plain text alone", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+255700000001")).toBe("'+255700000001");
    expect(csvCell("-1 late fee")).toBe("'-1 late fee");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(11400)).toBe("11400");
    expect(csvCell(new Date("2026-09-30T00:00:00Z"))).toBe("2026-09-30T00:00:00.000Z");
    expect(csvCell("Rider One (TEST)")).toBe("Rider One (TEST)");
    expect(csvCell("a,b")).toBe("\"a,b\"");
    expect(csvCell(null)).toBe("");
  });
});
