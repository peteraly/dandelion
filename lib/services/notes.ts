/**
 * Offline notes (§3.10): non-financial text only, synced when back online.
 * Idempotent on (user, clientId). Anything that looks like a money or status
 * claim is still stored as text — it has no effect on any record.
 */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/policy";

export const OfflineNoteSchema = z
  .object({
    clientId: z.string().uuid(),
    category: z.enum(["GENERAL", "STOCK", "CUSTOMER_VISIT", "PROBLEM"]),
    body: z.string().trim().min(1).max(1000),
    writtenAt: z.coerce.date(),
  })
  .strict();

export async function syncOfflineNotes(actor: Actor, notes: unknown[]): Promise<{ synced: number }> {
  authorize(actor, "note.create");
  const parsed = z.array(OfflineNoteSchema).max(50).parse(notes);
  if (parsed.length === 0) return { synced: 0 };
  const res = await getDb()
    .insert(s.offlineNotes)
    .values(parsed.map((n) => ({ ...n, userId: actor.userId })))
    .onConflictDoNothing()
    .returning({ id: s.offlineNotes.id });
  return { synced: res.length };
}

export async function myNotes(actor: Actor) {
  authorize(actor, "note.create");
  return getDb().query.offlineNotes.findMany({ where: eq(s.offlineNotes.userId, actor.userId), orderBy: desc(s.offlineNotes.writtenAt), limit: 50 });
}
