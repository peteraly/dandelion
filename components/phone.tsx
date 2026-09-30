/**
 * A phone on screen (Prompt H): what one person sees — the text messages the
 * system sent them, newest at the bottom, and for people with the app, what
 * their home screen says now. The thread is a reversed column (newest first in
 * the markup) so it opens at the newest text and scrolls up to older ones. Demo only; the messages are the mock SMS
 * provider's outbox, which exists only outside production.
 */
export interface PhoneMessage {
  id: string;
  body: string;
  at: string;
  /** Arrived with the last step: slides in and is outlined. */
  fresh: boolean;
}

export function Phone({
  name,
  role,
  time,
  active,
  app,
  messages,
  labels,
  testid,
}: {
  name: string;
  role: string;
  time: string;
  active: boolean;
  app: { status: string; next: string } | null;
  messages: PhoneMessage[];
  labels: { messages: string; none: string; smsOnly: string; app: string; next: string; justNow: string };
  testid?: string;
}) {
  return (
    <figure
      className={`flex h-[460px] w-[250px] shrink-0 snap-center flex-col overflow-hidden rounded-[2rem] border-[7px] bg-stone-50 shadow-lg transition-shadow ${active ? "border-brand-700 shadow-brand-200" : "border-stone-800"}`}
      data-testid={testid}
      data-active={active ? "true" : undefined}
    >
      <div className="flex items-center justify-between bg-stone-800 px-4 py-1 text-[10px] text-white" aria-hidden="true">
        <span>{time}</span>
        <span>▂▄▆ ◔ 87%</span>
      </div>
      <figcaption className="border-b border-stone-200 bg-white px-3 py-2">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="text-xs text-stone-500">{role}</p>
      </figcaption>
      {app ? (
        <div className="border-b border-stone-200 bg-brand-50 px-3 py-2 text-xs" data-testid="phone-app">
          <p className="font-medium uppercase tracking-wide text-stone-500">{labels.app}</p>
          <p className="font-semibold text-stone-900">{app.status}</p>
          <p className="text-brand-800">
            {labels.next}: {app.next}
          </p>
        </div>
      ) : (
        <p className="border-b border-stone-200 bg-stone-100 px-3 py-1.5 text-[11px] text-stone-600">{labels.smsOnly}</p>
      )}
      <p className="px-3 pt-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">{labels.messages}</p>
      <ol className="flex min-h-0 flex-1 flex-col-reverse gap-2 overflow-y-auto px-3 pb-3 pt-1" tabIndex={0} aria-label={`${labels.messages}: ${name}`} data-testid="phone-messages">
        {messages.length === 0 ? <li className="text-center text-xs text-stone-400">{labels.none}</li> : null}
        {[...messages].reverse().map((m) => (
          <li key={m.id} className={`max-w-[92%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-[12px] leading-snug text-stone-900 shadow-sm ${m.fresh ? "phone-new ring-2 ring-brand-500" : ""}`} data-testid="phone-sms" data-fresh={m.fresh ? "true" : undefined}>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <p className="mt-1 text-right text-[10px] text-stone-400">{m.fresh ? labels.justNow : m.at}</p>
          </li>
        ))}
      </ol>
    </figure>
  );
}
