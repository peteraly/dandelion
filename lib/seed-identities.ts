/**
 * Seed identities (Prompt B §2.8, ADR-026). Pure: no database access, so the
 * app, the seed script, the demo generator and tests can all share it.
 *
 * Development keeps fixed defaults; every other environment must set
 * SEED_ADMIN_PASSPHRASE_A/B, SEED_ADMIN_TOTP_A/B and SEED_FIELD_PIN, so the
 * public repository holds no credential usable on a deployed environment.
 */
import { createHash } from "node:crypto";
import { appEnv } from "@/lib/env";
import { base32Encode } from "@/lib/auth/totp";

/** Fake-range check shared with the demo generator: +255 700 00[0-9] [0-9][0-9][0-9] (unverified as reserved — ADR-025). */
export const FAKE_PHONE_RE = /^\+2557000{2}\d{4}$/;

export interface SeedIdentities {
  adminA: { phone: string; name: string; passphrase: string; totp: string };
  adminB: { phone: string; name: string; passphrase: string; totp: string };
  fieldPin: string;
  supplier: { phone: string; name: string; pin: string; payee: string };
  riders: { phone: string; name: string; pin: string; payee: string }[];
  hub: { phone: string; name: string; pin: string; payee: string };
  champions: { phone: string; name: string; pin: string; payee: string }[];
  customers: { phone: string; name: string }[];
  prices: { supplier: number; hub: number; champion: number; customer: number };
}

/** What the minimal seed created, for callers that build on it (the demo generator). */
export interface MinimalSeedResult {
  areaId: string;
  supplierId: string;
  hubId: string;
  productIds: { kit: string; disposable: string };
  adminIds: [string, string];
}

const B32_RE = /^[A-Z2-7]{16,64}$/;

/**
 * A base32 secret as people paste it — grouped with spaces or dashes the way
 * authenticator apps show it, in lower case, with "=" padding, even the whole
 * `NAME=value` line — is the same secret: base32 ignores case, the rest is layout.
 */
export function normaliseTotpSecret(raw: string, name = ""): string {
  let v = raw.trim();
  if (name && v.toUpperCase().startsWith(`${name}=`)) v = v.slice(name.length + 1);
  return v.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
}

/** Variables whose sign-in secret a preview had to derive (see buildSeed); the seed says so on the admin home. */
export const SEED_NOTES: string[] = [];

/**
 * Identities from the environment. `isDev` decides whether the fixed
 * development defaults apply; otherwise a missing variable yields "" and
 * `requireSeedCredentials` refuses later. Values are trimmed and a pasted
 * `NAME=` prefix is dropped. With `derivePreviewTotp` (previews only), a TOTP
 * variable that is still not base32 does not stop the preview: a valid secret
 * is derived from it — as secret as the value itself — and a note says so.
 */
export function buildSeed(env: Record<string, string | undefined>, isDev: boolean, opts: { derivePreviewTotp?: boolean; notes?: string[] } = {}): SeedIdentities {
  const fromEnv = (name: string, devDefault: string): string => {
    let v = env[name]?.trim() ?? "";
    if (v.startsWith(`${name}=`)) v = v.slice(name.length + 1).trim();
    if (v.length > 0) return v;
    return isDev ? devDefault : "";
  };
  const totp = (name: string, devDefault: string): string => {
    const v = normaliseTotpSecret(fromEnv(name, devDefault), name);
    if (!v || B32_RE.test(v) || !opts.derivePreviewTotp) return v;
    opts.notes?.push(name);
    return base32Encode(createHash("sha1").update(v).digest());
  };
  const fieldPin = fromEnv("SEED_FIELD_PIN", "2580");
  return {
    adminA: { phone: "+255700000001", name: "Admin Alpha (TEST)", passphrase: fromEnv("SEED_ADMIN_PASSPHRASE_A", "test-admin-passphrase-alpha"), totp: totp("SEED_ADMIN_TOTP_A", "JBSWY3DPEHPK3PXP") },
    adminB: { phone: "+255700000002", name: "Admin Bravo (TEST)", passphrase: fromEnv("SEED_ADMIN_PASSPHRASE_B", "test-admin-passphrase-bravo"), totp: totp("SEED_ADMIN_TOTP_B", "KRSXG5CTMVRXEZLU") },
    fieldPin,
    supplier: { phone: "+255700000010", name: "Supplier Test Co. (TEST)", pin: fieldPin, payee: "TILL-SUP-001" },
    riders: [
      { phone: "+255700000021", name: "Rider One (TEST)", pin: fieldPin, payee: "TILL-RID-001" },
      { phone: "+255700000022", name: "Rider Two (TEST)", pin: fieldPin, payee: "TILL-RID-002" },
    ],
    hub: { phone: "+255700000030", name: "Hub Manager (TEST)", pin: fieldPin, payee: "TILL-HUB-001" },
    champions: [
      { phone: "+255700000041", name: "Champion One (TEST)", pin: fieldPin, payee: "TILL-CHA-001" },
      { phone: "+255700000042", name: "Champion Two (TEST)", pin: fieldPin, payee: "TILL-CHA-002" },
      { phone: "+255700000043", name: "Champion Three (TEST)", pin: fieldPin, payee: "TILL-CHA-003" },
    ],
    customers: [
      { phone: "+255700000051", name: "Customer A (TEST)" },
      { phone: "+255700000052", name: "Customer B (TEST)" },
      { phone: "+255700000053", name: "Customer C (TEST)" },
      { phone: "+255700000054", name: "Customer D (TEST)" },
      { phone: "+255700000055", name: "Customer E (TEST)" },
    ],
    prices: { supplier: 7500, hub: 8000, champion: 9000, customer: 11400 },
  };
}

export const SEED: SeedIdentities = buildSeed(process.env, appEnv() === "development", { derivePreviewTotp: appEnv() === "preview", notes: SEED_NOTES });

/** Refuses to create people with missing or weak credentials (outside development the env must set them). */
export function requireSeedCredentials(seed: SeedIdentities = SEED): void {
  const problems: string[] = [];
  const b32 = B32_RE;
  for (const [label, a] of [
    ["A", seed.adminA],
    ["B", seed.adminB],
  ] as const) {
    if (a.passphrase.length < 12) problems.push(`SEED_ADMIN_PASSPHRASE_${label} (min 12 characters)`);
    if (!b32.test(a.totp)) problems.push(`SEED_ADMIN_TOTP_${label} (base32, 16–64 characters)`);
  }
  if (!/^\d{4}$/.test(seed.fieldPin) || /^(\d)\1{3}$/.test(seed.fieldPin) || seed.fieldPin === "1234" || seed.fieldPin === "4321") problems.push("SEED_FIELD_PIN (4 digits, not trivial)");
  for (const p of [seed.adminA, seed.adminB, seed.supplier, seed.hub, ...seed.riders, ...seed.champions, ...seed.customers]) {
    if (!FAKE_PHONE_RE.test(p.phone)) problems.push(`phone outside the fake range: ${p.phone}`);
    if (!p.name.includes("(TEST)")) problems.push(`name without (TEST): ${p.name}`);
  }
  if (problems.length) throw new Error(`seed refuses: set/fix ${problems.join("; ")}`);
}
