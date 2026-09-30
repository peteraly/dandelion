"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/current";
import { isDemoDataset } from "@/components/demo-banner";
import { ecosystemSnapshot } from "@/lib/services/ecosystem";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { desc } from "drizzle-orm";

/**
 * Prompt D §5.1 "Warm up": wake the database and the snapshot's hot paths
 * before a demo, so the first click is not the slow one. Reads only; the
 * pages themselves need no warming outside development.
 */
export async function warmUpAction(): Promise<void> {
  const { actor } = await requireAdmin();
  if (!(await isDemoDataset())) redirect("/admin");
  const db = getDb();
  await ecosystemSnapshot(actor, { window: "7d" });
  await db.query.orders.findMany({ orderBy: desc(s.orders.updatedAt), limit: 20 });
  await db.query.smsOutbox.findMany({ orderBy: desc(s.smsOutbox.createdAt), limit: 5 });
  redirect("/admin/demo?ok=warm");
}
