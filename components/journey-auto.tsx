"use client";

/**
 * "Play the walkthrough": one step every few seconds, so a presenter can talk
 * while the phones light up. Stops at the end, on any refusal, or when the
 * tab is hidden; a second press stops it.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { journeyAutoAction } from "@/app/admin/(dash)/demo/journey/actions";

export function JourneyAuto({ seconds, done, labels }: { seconds: number; done: boolean; labels: { play: string; stop: string } }) {
  const router = useRouter();
  const [on, setOn] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (!on || done) return;
    const timer = window.setInterval(async () => {
      if (busy.current || document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        const r = await journeyAutoAction();
        router.refresh();
        if (!r.ok || r.done) setOn(false);
      } catch {
        setOn(false);
      } finally {
        busy.current = false;
      }
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [on, done, seconds, router]);

  if (done) return null;
  return (
    <button type="button" className="btn btn-secondary w-auto px-4 text-base" aria-pressed={on} onClick={() => setOn((v) => !v)} data-testid="journey-auto">
      {on ? `❚❚ ${labels.stop}` : `▶ ${labels.play}`}
    </button>
  );
}
