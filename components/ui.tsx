import type { ReactNode } from "react";

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  new: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  processing: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  rejected: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  needs_email: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  draft: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  approved: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  sent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  replied: "bg-teal-500/20 text-teal-700 dark:text-teal-300",
  failed: "bg-red-500/15 text-red-700 dark:text-red-300",
  drafted: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  pushed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  paused: "bg-red-500/15 text-red-700 dark:text-red-300",
  awaiting_approval: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  handed_off: "bg-teal-500/20 text-teal-700 dark:text-teal-300",
  closed: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

export function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.new}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export function Score({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">–</span>;
  const tone = value >= 75 ? "text-emerald-600 dark:text-emerald-400" : value >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  return <span className={`tabular-nums font-medium ${tone}`}>{value}</span>;
}

export const inputClass =
  "w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";
