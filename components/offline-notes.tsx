"use client";

/**
 * Offline notes (§3.10): saved to localStorage immediately, synced to the
 * server when online. Non-financial text only — the server enforces that
 * notes have no effect on any record.
 */
import { useEffect, useState } from "react";
import { syncNotesAction } from "@/app/(field)/actions";

type Note = { clientId: string; category: "GENERAL" | "STOCK" | "CUSTOMER_VISIT" | "PROBLEM"; body: string; writtenAt: string; synced: boolean };
const KEY = "dandelion.offlineNotes.v1";

function load(): Note[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Note[];
  } catch {
    return [];
  }
}
function persist(notes: Note[]) {
  localStorage.setItem(KEY, JSON.stringify(notes));
}

export function OfflineNotes({ labels }: { labels: { body: string; category: string; categories: Record<Note["category"], string>; save: string; saved: string; pending: string; synced: string } }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Note["category"]>("GENERAL");
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  void online;

  useEffect(() => {
    const initial = load();
    // Hydrate from local storage, then sync anything still pending.
    const timer = setTimeout(() => {
      setNotes(initial);
      setOnline(navigator.onLine);
      if (navigator.onLine) void sync(initial);
    }, 0);
    const up = () => {
      setOnline(true);
      void sync(load());
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  async function sync(list: Note[]) {
    const pending = list.filter((n) => !n.synced);
    if (pending.length === 0 || !navigator.onLine) return;
    let r: Awaited<ReturnType<typeof syncNotesAction>>;
    try {
      r = await syncNotesAction(pending.map(({ synced: _s, ...n }) => n));
    } catch {
      return; // offline or server unreachable: keep the notes pending
    }
    if ("synced" in r) {
      const ids = new Set(pending.map((n) => n.clientId));
      const next = load().map((n) => (ids.has(n.clientId) ? { ...n, synced: true } : n));
      persist(next);
      setNotes(next);
    }
  }

  function save() {
    if (body.trim().length === 0) return;
    const note: Note = { clientId: crypto.randomUUID(), category, body: body.trim(), writtenAt: new Date().toISOString(), synced: false };
    const next = [note, ...notes];
    persist(next);
    setNotes(next);
    setBody("");
    setMessage(labels.saved);
    void sync(next);
  }

  return (
    <div className="card flex flex-col gap-3">
      <label className="label" htmlFor="note-category">
        {labels.category}
      </label>
      <select id="note-category" className="field" value={category} onChange={(e) => setCategory(e.target.value as Note["category"])}>
        {Object.entries(labels.categories).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <label className="label" htmlFor="note-body">
        {labels.body}
      </label>
      <textarea id="note-body" className="field" rows={3} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
      <button type="button" className="btn btn-primary" onClick={save} data-testid="save-note">
        {labels.save}
      </button>
      {message ? <p className="text-sm text-green-800">{message}</p> : null}
      <ul className="divide-y divide-stone-100">
        {notes.map((n) => (
          <li key={n.clientId} className="flex items-start justify-between gap-2 py-2" data-testid="local-note">
            <span>
              <span className="text-xs uppercase text-stone-500">{labels.categories[n.category]}</span>
              <p>{n.body}</p>
            </span>
            <span className={`badge ${n.synced ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>{n.synced ? labels.synced : labels.pending}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
