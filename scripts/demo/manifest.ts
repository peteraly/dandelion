/**
 * Manifest of everything the generator did on purpose that a reviewer would
 * otherwise flag (Prompt B §2.3): deliberate anomalies with ids, scenarios it
 * could not produce through the services (and why), fictional place names and
 * Swahili texts that need native review. Stored in settings.demoManifest.
 */
export interface AnomalyEntry {
  /** Reconciliation flag kind or exception type this explains, when applicable. */
  kind: string;
  orderRef?: string;
  ids?: Record<string, string>;
  note: string;
  at: string;
}

export interface SkippedScenario {
  scenario: string;
  reason: string;
  at: string;
  /** Top of the stack, so a skipped scenario can be traced to the service that refused. */
  where?: string;
}

export interface DemoManifest {
  version: 1;
  seed: string;
  scale: string;
  generatedAt: string;
  simulatedFrom: string;
  simulatedTo: string;
  anomalies: AnomalyEntry[];
  skipped: SkippedScenario[];
  fictionalPlaces: string[];
  needsNativeReview: string[];
  counts: Record<string, number>;
}

export class Manifest {
  readonly anomalies: AnomalyEntry[] = [];
  readonly skipped: SkippedScenario[] = [];
  readonly needsNativeReview = new Set<string>();
  readonly counts: Record<string, number> = {};

  constructor(
    private readonly seed: string,
    private readonly scale: string,
    private readonly clock: () => Date,
  ) {}

  anomaly(kind: string, note: string, extra: { orderRef?: string; ids?: Record<string, string> } = {}): void {
    this.anomalies.push({ kind, note, at: this.clock().toISOString(), ...extra });
  }

  skip(scenario: string, e: unknown): void {
    const reason = e instanceof Error ? e.message : String(e);
    const where = e instanceof Error && e.stack ? e.stack.split("\n").slice(1, 5).map((l) => l.trim().replace(process.cwd() + "/", "")).join(" < ") : undefined;
    this.skipped.push({ scenario, reason, at: this.clock().toISOString(), where });
    console.warn(`[demo] skipped ${scenario}: ${reason}${where ? `\n         ${where}` : ""}`);
  }

  count(key: string, n = 1): void {
    this.counts[key] = (this.counts[key] ?? 0) + n;
  }

  swahili(text: string): string {
    this.needsNativeReview.add(text);
    return text;
  }

  /** Orders whose reconciliation flags are expected (deliberate). */
  expectedFlagKinds(): Set<string> {
    return new Set(this.anomalies.map((a) => a.kind));
  }

  toJSON(from: Date, to: Date, fictionalPlaces: string[]): DemoManifest {
    return {
      version: 1,
      seed: this.seed,
      scale: this.scale,
      generatedAt: new Date().toISOString(),
      simulatedFrom: from.toISOString(),
      simulatedTo: to.toISOString(),
      anomalies: this.anomalies,
      skipped: this.skipped,
      fictionalPlaces,
      needsNativeReview: [...this.needsNativeReview],
      counts: this.counts,
    };
  }
}
