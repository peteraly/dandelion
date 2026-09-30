"use client";

/**
 * The demo district runs by itself (Prompt G): while an admin page of the demo
 * dataset is open and looked at, one simulated hour happens every `seconds`,
 * then the page refreshes. No button. The server decides whether it is time
 * (at most one step a minute however many people watch, and its own rate
 * limit); a step someone else just took counts as the district having moved.
 * Pauses while the tab is hidden or after an hour without anyone touching
 * the page, and picks up again on the next touch. Never refreshes under a
 * person who is typing.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { autoTickAction } from "@/app/dev/simulator/actions";

const AWAY_MS = 60 * 60_000;
const QUIET_CODES = new Set(["rate_limited", "live_recently_advanced"]);

export function LiveDistrict({ seconds, labels }: { seconds: number; labels: { running: string; updating: string; away: string; stopped: string } }) {
  const router = useRouter();
  const [state, setState] = useState<"running" | "updating" | "away" | "stopped">("running");
  const busy = useRef(false);
  const lastTouch = useRef(0);

  useEffect(() => {
    lastTouch.current = Date.now();
    const touch = () => {
      lastTouch.current = Date.now();
      setState((s) => (s === "away" ? "running" : s));
    };
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    for (const ev of events) window.addEventListener(ev, touch, { passive: true });
    return () => {
      for (const ev of events) window.removeEventListener(ev, touch);
    };
  }, []);

  useEffect(() => {
    if (state === "stopped") return;
    const step = async () => {
      if (busy.current || document.visibilityState !== "visible") return;
      if (Date.now() - lastTouch.current > AWAY_MS) {
        setState("away");
        return;
      }
      busy.current = true;
      setState("updating");
      try {
        const r = await autoTickAction();
        if (!r.ok && !QUIET_CODES.has(r.code ?? "")) {
          setState("stopped");
          return;
        }
        const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement;
        if (!typing) router.refresh();
        setState("running");
      } catch {
        setState("stopped");
      } finally {
        busy.current = false;
      }
    };
    const first = window.setTimeout(() => void step(), 1500);
    const timer = window.setInterval(() => void step(), seconds * 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [state === "stopped", seconds, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = state === "running" || state === "updating";
  return (
    <p className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${live ? "bg-green-100 text-green-900" : "bg-stone-200 text-stone-700"}`} role="status" data-testid="live-district" data-state={state}>
      <span aria-hidden="true" className={live ? "district-pulse" : undefined}>
        ●
      </span>
      {labels[state]}
    </p>
  );
}
