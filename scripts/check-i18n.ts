/** CI gate: SW and EN catalogues carry the same keys; SW is flagged for review. */
import en from "../messages/en.json";
import sw from "../messages/sw.json";

function flatten(o: unknown, prefix = ""): string[] {
  if (typeof o !== "object" || o === null) return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

const a = flatten(en).filter((k) => !k.startsWith("_meta")).sort();
const b = flatten(sw).filter((k) => !k.startsWith("_meta")).sort();
const missingInSw = a.filter((k) => !b.includes(k));
const missingInEn = b.filter((k) => !a.includes(k));
if (missingInSw.length || missingInEn.length) {
  console.error("i18n mismatch", { missingInSw, missingInEn });
  process.exit(1);
}
if (!sw._meta.needs_native_review) {
  console.error("sw.json must carry _meta.needs_native_review = true until a native speaker signs off (gate G6)");
  process.exit(1);
}
console.log(`i18n ok: ${a.length} keys in sw and en`);
