"use client";

/**
 * Optional AI-assisted problem intake (build prompt §7.1). Only rendered when
 * AI_ENABLED=true. Free text → proposed category; the user still confirms by
 * choosing the radio button and submitting. Voice input via the browser's
 * SpeechRecognition where available; typing is always the fallback.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { proposeProblemAction } from "@/app/(field)/ai-actions";

type SR = { start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; lang: string; onend: (() => void) | null };

export function ProblemIntake() {
  const t = useTranslations("problems");
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<{ id: string; type: string; confidence: number; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const w = typeof window !== "undefined" ? (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }) : undefined;
  const Speech = w?.SpeechRecognition ?? w?.webkitSpeechRecognition;

  async function propose() {
    setBusy(true);
    try {
      const r = await proposeProblemAction(text);
      setProposal(r);
      if (r) {
        const radio = document.querySelector<HTMLInputElement>(`input[name="type"][value="${r.type}"]`);
        if (radio) radio.checked = true;
        const note = document.querySelector<HTMLTextAreaElement>('textarea[name="note"]');
        if (note && !note.value) note.value = r.note;
      }
    } finally {
      setBusy(false);
    }
  }

  function listen() {
    if (!Speech) return;
    const rec = new Speech();
    rec.lang = "sw-TZ";
    rec.onresult = (e) => setText((prev) => `${prev} ${e.results[0]?.[0]?.transcript ?? ""}`.trim());
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  }

  return (
    <div className="rounded-xl border border-dashed border-brand-600 p-3" data-testid="ai-intake">
      <p className="mb-2 text-sm text-stone-600">{t("aiHelp")}</p>
      <textarea className="field" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label={t("aiHelp")} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" onClick={propose} disabled={busy || text.trim().length < 3}>
          {busy ? "…" : "AI"}
        </button>
        {Speech ? (
          <button type="button" className="btn btn-secondary" onClick={listen} disabled={listening} aria-label="voice input">
            {listening ? "●" : "🎤"}
          </button>
        ) : null}
      </div>
      {/* The human's confirmation is recorded against this interaction when the form is submitted. */}
      <input type="hidden" name="aiInteractionId" value={proposal?.id ?? ""} />
      {proposal ? (
        <p className="mt-2 text-sm">
          → {t(`${proposal.type}.label`)} ({Math.round(proposal.confidence * 100)}%)
        </p>
      ) : null}
    </div>
  );
}
