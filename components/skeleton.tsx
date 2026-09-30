/**
 * What a page shows while it streams in (Prompt H, progressive loading): the
 * shape of a heading and a few cards, so the screen never sits blank. Used by
 * the loading.tsx files of the admin and field apps.
 */
export function PageSkeleton({ cards = 3, label }: { cards?: number; label: string }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite" aria-label={label} data-testid="page-skeleton">
      <div className="skeleton h-8 w-2/3 max-w-sm" />
      <div className="skeleton h-4 w-full max-w-xl" />
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="skeleton h-28 w-full" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
