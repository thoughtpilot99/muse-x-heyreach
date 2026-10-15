import Link from "next/link";

export type ChecklistItem = { label: string; done: boolean; href: string };

/** Getting-started list shown on the dashboard until every step is done. */
export function Checklist({ items }: { items: ChecklistItem[] }) {
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  const next = items.find((i) => !i.done);
  return (
    <section className="rounded-lg border border-accent/40 bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Getting started · {done}/{items.length}</h2>
        {next && <Link href={next.href} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">Next: {next.label}</Link>}
      </div>
      <ol className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        {items.map((i, n) => (
          <li key={i.label} className="flex items-center gap-2">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${i.done ? "bg-emerald-500 text-white" : "border border-line text-muted"}`}>
              {i.done ? "✓" : n + 1}
            </span>
            <Link href={i.href} className={i.done ? "text-muted line-through" : "hover:underline"}>{i.label}</Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
