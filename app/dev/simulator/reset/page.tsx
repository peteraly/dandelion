/**
 * Shown after "Reset to demo dataset" wiped the database: there is no session
 * left to require, and nothing here but the outcome the action produced.
 * 404 unless the simulator guard is on (never in production).
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { simulatorEnabled } from "@/lib/env";
import type { SearchParams } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function ResetDonePage({ searchParams }: { searchParams: SearchParams }) {
  if (!simulatorEnabled()) notFound();
  const sp = await searchParams;
  const result = typeof sp.result === "string" ? sp.result : "";
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">Demo dataset reset</h1>
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">The database was wiped, so every session ended — including yours. The demo dataset comes back when the rebuild finishes; then sign in again.</p>
      <pre className="overflow-x-auto rounded-xl bg-stone-900 p-3 text-xs text-green-200" data-testid="reset-result">
        {result}
      </pre>
      <Link href="/admin/login" className="underline">
        Admin sign-in
      </Link>
    </div>
  );
}
