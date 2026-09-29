/** Shape of a morning-brief item. Pure type shared by services and (read-only) AI code. */
export interface BriefItem {
  id: string;
  kind: "PAYMENT_REVIEW" | "EXCEPTION" | "APPROVAL" | "RECON_FLAG" | "PENDING_TOO_LONG" | "LOW_STOCK" | "SECURITY";
  title: string;
  detail: string;
  href: string;
  /** Handbook §16 stop-and-fix triggers this item fires. */
  triggers: string[];
  ageHours: number;
}
