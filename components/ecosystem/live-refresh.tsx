"use client";

/**
 * Auto-refresh for /admin/ecosystem (Prompt B §3.4): router.refresh() on an
 * interval, only while the tab is visible; 30 s by default, 60 s after ten
 * minutes, paused after an hour without any interaction. A dot in the tab
 * title says new attention items arrived since the page was last looked at.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh({ intervalSeconds, attentionTotal, labels, asOf }: { intervalSeconds: number; attentionTotal: number; labels: { live: string; paused: string; pause: string; resume: string; idle: string; hidden: string; asOf: string }; asOf: string }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [idle, setIdle] = useState(false);
  const [hidden, setHidden] = useState(false);
  // Clock reads happen in effects, never during render (react-hooks/purity).
  const started = useRef(0);
  const lastInteraction = useRef(0);
  const seenAttention = useRef(attentionTotal);
  const baseTitle = useRef<string | null>(null);

  useEffect(() => {
    if (started.current === 0) started.current = Date.now();
    if (lastInteraction.current === 0) lastInteraction.current = Date.now();
  }, []);

  // Title dot when attention grew while the page was not looked at.
  useEffect(() => {
    if (baseTitle.current === null) baseTitle.current = document.title.replace(/^● /, "");
    const grew = attentionTotal > seenAttention.current;
    if (grew && document.visibilityState === "hidden") document.title = `● ${baseTitle.current}`;
    if (document.visibilityState === "visible" && document.hasFocus()) {
      seenAttention.current = attentionTotal;
      document.title = baseTitle.current;
    }
  }, [attentionTotal]);

  useEffect(() => {
    const onVisibility = () => {
      setHidden(document.visibilityState === "hidden");
      if (document.visibilityState === "visible") {
        seenAttention.current = attentionTotal;
        if (baseTitle.current) document.title = baseTitle.current;
      }
    };
    const onInteract = () => {
      lastInteraction.current = Date.now();
      if (idle) setIdle(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    for (const ev of ["mousemove", "keydown", "click", "touchstart", "scroll"]) window.addEventListener(ev, onInteract, { passive: true });
    onVisibility();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      for (const ev of ["mousemove", "keydown", "click", "touchstart", "scroll"]) window.removeEventListener(ev, onInteract);
    };
  }, [attentionTotal, idle]);

  useEffect(() => {
    if (paused || idle || hidden) return;
    const elapsedMin = (Date.now() - started.current) / 60_000;
    const seconds = elapsedMin >= 10 ? Math.max(intervalSeconds, 60) : intervalSeconds;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastInteraction.current > 60 * 60_000) {
        setIdle(true);
        return;
      }
      router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [paused, idle, hidden, intervalSeconds, router]);

  const state = paused ? "paused" : idle ? "idle" : hidden ? "hidden" : "live";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="live-refresh" data-state={state}>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${state === "live" ? "bg-green-100 text-green-900" : "bg-stone-200 text-stone-700"}`}>
        <span aria-hidden="true">{state === "live" ? "●" : "◌"}</span>
        {state === "live" ? labels.live : labels.paused}
      </span>
      <span className="text-stone-600">{labels.asOf.replace("{time}", asOf)}</span>
      {state === "hidden" ? <span className="text-stone-500">{labels.hidden}</span> : null}
      {idle ? (
        <button
          type="button"
          className="btn btn-secondary w-auto min-h-10 px-3 py-1 text-sm"
          onClick={() => {
            lastInteraction.current = Date.now();
            setIdle(false);
            router.refresh();
          }}
        >
          {labels.idle}
        </button>
      ) : (
        <button type="button" className="btn btn-secondary w-auto min-h-10 px-3 py-1 text-sm" aria-pressed={paused} onClick={() => setPaused((p) => !p)} data-testid="pause-refresh">
          {paused ? labels.resume : labels.pause}
        </button>
      )}
    </div>
  );
}
