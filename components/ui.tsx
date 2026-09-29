import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <section className={`card ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function PrimaryButton({ children, disabled, name, value }: { children: ReactNode; disabled?: boolean; name?: string; value?: string }) {
  return (
    <button type="submit" className="btn btn-primary" disabled={disabled} name={name} value={value}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "danger" | "warn" }) {
  return (
    <Link href={href} className={`btn btn-${variant}`}>
      {children}
    </Link>
  );
}

export function ErrorText({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" data-testid="error" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-800">
      {message}
    </p>
  );
}

export function SuccessText({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-3 text-green-800">
      {message}
    </p>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-sm text-stone-500">{hint}</p> : null}
    </div>
  );
}

export function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} className="mt-0.5" />
      <span>{label}</span>
    </label>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-stone-500">{k}</dt>
          <dd className="font-medium text-right break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "purple" }) {
  const tones = {
    neutral: "bg-stone-100 text-stone-700",
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    purple: "bg-brand-100 text-brand-800",
  };
  return <span className={`badge ${tones[tone]}`}>{children}</span>;
}

/** Hidden idempotency key for mutating forms. */
export function IdemKey() {
  return <input type="hidden" name="idem" value={crypto.randomUUID()} />;
}
