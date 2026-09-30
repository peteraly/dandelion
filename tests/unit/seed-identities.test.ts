/**
 * Prompt B §2.8: seed credentials come from the environment; development keeps
 * fixed defaults, everything else refuses without them. The repository must
 * hold no credential usable on a deployed environment.
 */
import { describe, expect, it } from "vitest";
import { buildSeed, normaliseTotpSecret, requireSeedCredentials, FAKE_PHONE_RE } from "../../scripts/seed";

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

  it("reads a base32 secret the way people paste it: spaced, lower case, padded, or with its NAME= prefix", () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    for (const pasted of [secret, " jbsw y3dp ehpk 3pxp jbsw y3dp ehpk 3pxp ", "JBSW-Y3DP-EHPK-3PXP-JBSW-Y3DP-EHPK-3PXP", `${secret}====`, `SEED_ADMIN_TOTP_A=${secret}\n`]) {
      expect(normaliseTotpSecret(pasted, "SEED_ADMIN_TOTP_A")).toBe(secret);
      expect(buildSeed({ SEED_ADMIN_TOTP_A: pasted }, false).adminA.totp).toBe(secret);
    }
    // Other values lose surrounding whitespace and a pasted NAME= prefix, nothing else.
    expect(buildSeed({ SEED_FIELD_PIN: "SEED_FIELD_PIN=7391\n" }, false).fieldPin).toBe("7391");
    expect(buildSeed({ SEED_ADMIN_PASSPHRASE_A: "  a passphrase with spaces inside  " }, false).adminA.passphrase).toBe("a passphrase with spaces inside");
  });

  it("a preview derives a valid sign-in secret from a value that is not base32, and says so; elsewhere the seed refuses", () => {
    const env = { SEED_ADMIN_PASSPHRASE_A: "a-long-preview-passphrase", SEED_ADMIN_PASSPHRASE_B: "another-long-passphrase", SEED_ADMIN_TOTP_A: "0f1e2d3c4b5a69788796a5b4c3d2e1f0", SEED_ADMIN_TOTP_B: "KRSXG5CTMVRXEZLU", SEED_FIELD_PIN: "7391" };
    const notes: string[] = [];
    const preview = buildSeed(env, false, { derivePreviewTotp: true, notes });
    expect(preview.adminA.totp).toMatch(/^[A-Z2-7]{32}$/);
    expect(buildSeed(env, false, { derivePreviewTotp: true }).adminA.totp).toBe(preview.adminA.totp); // the same value derives the same secret
    expect(preview.adminB.totp).toBe("KRSXG5CTMVRXEZLU");
    expect(notes).toEqual(["SEED_ADMIN_TOTP_A"]); // the variable's name, never its value
    expect(() => requireSeedCredentials(preview)).not.toThrow();
    expect(() => requireSeedCredentials(buildSeed(env, false))).toThrow(/TOTP_A/);
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
