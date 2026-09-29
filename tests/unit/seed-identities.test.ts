/**
 * Prompt B §2.8: seed credentials come from the environment; development keeps
 * fixed defaults, everything else refuses without them. The repository must
 * hold no credential usable on a deployed environment.
 */
import { describe, expect, it } from "vitest";
import { buildSeed, requireSeedCredentials, FAKE_PHONE_RE } from "../../scripts/seed";

describe("seed identities", () => {
  it("development uses fixed defaults", () => {
    const s = buildSeed({}, true);
    expect(s.adminA.passphrase).toBe("test-admin-passphrase-alpha");
    expect(s.riders[0]!.pin).toBe("2580");
    expect(() => requireSeedCredentials(s)).not.toThrow();
  });

  it("outside development a missing variable is empty and the seed refuses", () => {
    const s = buildSeed({}, false);
    expect(s.adminA.passphrase).toBe("");
    expect(s.adminB.totp).toBe("");
    expect(s.fieldPin).toBe("");
    expect(() => requireSeedCredentials(s)).toThrow(/SEED_ADMIN_PASSPHRASE_A/);
    expect(() => requireSeedCredentials(s)).toThrow(/SEED_ADMIN_TOTP_B/);
    expect(() => requireSeedCredentials(s)).toThrow(/SEED_FIELD_PIN/);
  });

  it("outside development the environment values are used and validated", () => {
    const env = {
      SEED_ADMIN_PASSPHRASE_A: "a-long-preview-passphrase",
      SEED_ADMIN_PASSPHRASE_B: "another-long-passphrase",
      SEED_ADMIN_TOTP_A: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
      SEED_ADMIN_TOTP_B: "KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU",
      SEED_FIELD_PIN: "7391",
    };
    const s = buildSeed(env, false);
    expect(s.adminA.passphrase).toBe(env.SEED_ADMIN_PASSPHRASE_A);
    expect(s.champions[0]!.pin).toBe("7391");
    expect(() => requireSeedCredentials(s)).not.toThrow();
    expect(() => requireSeedCredentials(buildSeed({ ...env, SEED_ADMIN_TOTP_A: "not-base32!" }, false))).toThrow(/TOTP_A/);
    expect(() => requireSeedCredentials(buildSeed({ ...env, SEED_FIELD_PIN: "1111" }, false))).toThrow(/PIN/);
    expect(() => requireSeedCredentials(buildSeed({ ...env, SEED_ADMIN_PASSPHRASE_B: "short" }, false))).toThrow(/PASSPHRASE_B/);
  });

  it("every fixed identity is in the fake range and marked (TEST)", () => {
    const s = buildSeed({}, true);
    for (const p of [s.adminA, s.adminB, s.supplier, s.hub, ...s.riders, ...s.champions, ...s.customers]) {
      expect(p.phone).toMatch(FAKE_PHONE_RE);
      expect(p.name).toContain("(TEST)");
    }
    expect("+255712345678").not.toMatch(FAKE_PHONE_RE);
    expect("+255700010000").not.toMatch(FAKE_PHONE_RE);
  });
});
