/**
 * The ecosystem view (Prompt B §3): where the stock is, where the money is,
 * who is stuck, is the machine healthy — on one screen, read-only, refreshed
 * only while watched. The view lives in components/ecosystem/view.tsx so the
 * presenter route (Prompt D §5.8) can render it without the sidebar.
 */
import { EcosystemView } from "@/components/ecosystem/view";
import type { SearchParams } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function EcosystemPage({ searchParams }: { searchParams: SearchParams }) {
  return <EcosystemView searchParams={searchParams} />;
}
