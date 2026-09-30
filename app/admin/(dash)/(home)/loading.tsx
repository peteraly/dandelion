import { PageSkeleton } from "@/components/skeleton";

/** Shown at once while this page's data loads (streaming). Only on pages that never answer "not found", so real 404s keep their status. */
export default function Loading() {
  return <PageSkeleton cards={3} label="Loading… · Inapakia…" />;
}
