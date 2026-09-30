/**
 * Prompt D §5.2: fictional people, companies and places carry " (TEST)" in
 * the data (ADR-025) and keep it — exports, SMS and the ledger are untouched.
 * On screen the suffix becomes a small chip; screen readers still hear the
 * suffix (it stays in the accessible name), and the banner says the rest.
 */
export const TEST_SUFFIX = " (TEST)";

export function splitTestName(value: string): { base: string; test: boolean } {
  return value.endsWith(TEST_SUFFIX) ? { base: value.slice(0, -TEST_SUFFIX.length), test: true } : { base: value, test: false };
}

/** The display form for places where only plain text fits (SVG, option elements, titles). */
export function displayName(value: string): string {
  return splitTestName(value).base;
}

export function Name({ value, className }: { value: string; className?: string }) {
  const { base, test } = splitTestName(value);
  if (!test) return <span className={className}>{value}</span>;
  return (
    <span className={className}>
      {base}
      <span className="sr-only">{TEST_SUFFIX}</span>
      <span aria-hidden="true" data-testid="test-chip" className="ml-1 inline-block rounded bg-stone-200 px-1 align-middle text-[10px] font-semibold uppercase tracking-wide text-stone-600">
        test
      </span>
    </span>
  );
}
