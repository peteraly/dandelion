/**
 * Prompt D §5.2: the " (TEST)" suffix stays in the data and leaves the
 * display as a chip; a name without the suffix is never touched.
 */
import { describe, expect, it } from "vitest";
import { displayName, splitTestName, TEST_SUFFIX } from "@/components/name";

describe("test-name chip", () => {
  it("splits the suffix off fictional names and leaves real-looking ones alone", () => {
    expect(splitTestName("Rider One (TEST)")).toEqual({ base: "Rider One", test: true });
    expect(splitTestName("Kilima Moto Hub (TEST)")).toEqual({ base: "Kilima Moto Hub", test: true });
    expect(splitTestName("Rider One")).toEqual({ base: "Rider One", test: false });
    expect(splitTestName("(TEST) first")).toEqual({ base: "(TEST) first", test: false });
    expect(displayName("Tumaini School (TEST)")).toBe("Tumaini School");
    expect(TEST_SUFFIX).toBe(" (TEST)");
  });
});
