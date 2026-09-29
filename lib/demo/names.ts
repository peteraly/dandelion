/**
 * Fictional identities for the demo (Prompt B §1.2). Names are Tanzanian in
 * shape but belong to nobody; every display name carries "(TEST)". Place
 * names are invented. Phone numbers come from the reserved-looking fake range
 * +255 700 00[0-9] [0-9][0-9][0-9] only (unverified as reserved — ADR-025).
 */
import { FAKE_PHONE_RE } from "@/lib/seed-identities";
import type { Rng } from "./rng";

const FIRST = [
  "Amina", "Neema", "Zawadi", "Rehema", "Halima", "Upendo", "Furaha", "Imani", "Baraka", "Juma", "Hassan", "Salma", "Mariam", "Fatuma", "Asha",
  "Mwanaidi", "Grace", "Joyce", "Esther", "Rose", "Anna", "Lucy", "Dorcas", "Pendo", "Tumaini", "Bahati", "Subira", "Saada", "Zuhura", "Latifa",
  "Emmanuel", "Joseph", "Daniel", "Elias", "Godfrey", "Peter", "Samuel", "Rashid", "Omari", "Selemani",
];
const LAST = [
  "Mwakasege", "Kimaro", "Mushi", "Massawe", "Mrema", "Kihwele", "Ngowi", "Shayo", "Mbwambo", "Lyimo", "Mtei", "Nyoni", "Mwenda", "Kapinga", "Mahundi",
  "Mgaya", "Chuwa", "Sanga", "Komba", "Haule", "Mlowe", "Kessy", "Temba", "Urassa", "Mwaipopo", "Sumari", "Mbise", "Nnko", "Mollel", "Laizer",
];
/** Fictional supplier companies — never a real manufacturer's name (Prompt B §8.5). */
const COMPANIES = ["Jua Kali Hygiene Supplies Ltd", "Maua Sanitary Products Co.", "Nyota Pads Works", "Tumaini Health Goods Ltd", "Bahari Textiles & Care Co."];
const VILLAGES = ["Mwembe Chai", "Kilima Moto", "Bonde la Amani", "Mtoni Juu", "Kijiji Kipya", "Mlima Mrefu", "Ziwa Ndogo", "Msitu Mweupe", "Tumaini Mashariki", "Upendo Kaskazini"];

export class Names {
  private used = new Set<string>();
  private nextField = 100; // +255 700 000 1xx … for field users beyond the fixed ones
  private nextCustomer = 1000; // +255 700 001 000 … for customers

  constructor(private rng: Rng) {}

  /** Continue numbering above phones that already exist (ticks on a populated database). */
  reserveAbove(existingPhones: readonly string[]): void {
    for (const p of existingPhones) {
      const m = p.match(/^\+2557000(\d{5})$/);
      if (!m) continue;
      const n = Number(m[1]);
      if (n >= 100 && n < 1000) this.nextField = Math.max(this.nextField, n + 1);
      else if (n >= 1000) this.nextCustomer = Math.max(this.nextCustomer, n + 1);
    }
  }

  person(): string {
    for (let i = 0; i < 100; i++) {
      const n = `${this.rng.pick(FIRST)} ${this.rng.pick(LAST)}`;
      if (!this.used.has(n)) {
        this.used.add(n);
        return `${n} (TEST)`;
      }
    }
    // Pools are large enough for `full`; fall back to a numbered name rather than a duplicate.
    return `Demo Person ${this.used.size + 1} (TEST)`;
  }

  fieldPhone(): string {
    const n = this.nextField++;
    if (n > 999) throw new Error("fake field-phone range exhausted");
    return this.check(`+255700000${String(n).padStart(3, "0")}`);
  }

  customerPhone(): string {
    const n = this.nextCustomer++;
    if (n > 9999) throw new Error("fake customer-phone range exhausted");
    return this.check(`+25570000${String(n).padStart(4, "0")}`);
  }

  village(i: number): string {
    return `${VILLAGES[i % VILLAGES.length]} (TEST)`;
  }

  company(i: number): string {
    return `${COMPANIES[i % COMPANIES.length]} (TEST)`;
  }

  till(prefix: string, i: number): string {
    return `TILL-${prefix}-${String(i).padStart(3, "0")}`;
  }

  private check(phone: string): string {
    if (!FAKE_PHONE_RE.test(phone)) throw new Error(`generated phone outside the fake range: ${phone}`);
    return phone;
  }
}

/** Fictional place names the manifest lists so nobody mistakes them for real ones. */
export const FICTIONAL_PLACES = [...VILLAGES];
