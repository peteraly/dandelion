"use client";

/**
 * The admin sidebar and the one-line guide above every admin page. Both need
 * the current path, so they are the only client pieces of the admin shell;
 * every label and hint comes translated from the server layout.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  hint: string;
}
export interface NavGroup {
  heading: string;
  items: NavItem[];
}

/** The item a path belongs to: exact match, else the longest prefix (so /admin/orders/123 is "Orders"; /admin is only itself). */
export function activeItem(groups: NavGroup[], pathname: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of groups)
    for (const item of group.items) {
      const hit = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
      if (hit && (!best || item.href.length > best.item.href.length)) best = { group, item };
    }
  return best;
}

export function AdminNav({ groups, label, highlight }: { groups: NavGroup[]; label: string; highlight?: string }) {
  const pathname = usePathname();
  const current = activeItem(groups, pathname)?.item.href;
  return (
    <nav className="flex flex-wrap gap-1 md:flex-col" aria-label={label}>
      {groups.map((g) => (
        <div key={g.heading} className="md:mt-2">
          <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">{g.heading}</p>
          {g.items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              title={it.hint}
              aria-current={current === it.href ? "page" : undefined}
              className={`block rounded-lg px-3 py-2 text-sm ${current === it.href ? "bg-brand-100 font-semibold text-brand-800" : it.href === highlight ? "font-semibold text-brand-700 hover:bg-stone-200" : "hover:bg-stone-200"}`}
            >
              {it.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** "Day to day › Approvals — Anything important needs two admins…": where am I, and what is this page for. */
export function PageGuide({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const hit = activeItem(groups, pathname);
  if (!hit || hit.item.href === "/admin") return null;
  return (
    <p className="text-sm text-stone-600" data-testid="page-guide">
      <span className="text-stone-500">{hit.group.heading} ›</span> <span className="font-medium text-stone-800">{hit.item.label}</span> — {hit.item.hint}
    </p>
  );
}
