"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/app/actions";

type Props = {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  children?: ReactNode;
  submit?: { label: string; intent?: string; tone?: "primary" | "neutral" | "danger" }[];
  className?: string;
};

const TONES = {
  primary: "bg-accent text-white hover:opacity-90",
  neutral: "border border-line hover:bg-subtle",
  danger: "border border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400",
};

export function ActionForm({ action, children, submit = [{ label: "Run" }], className }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {submit.map((s) => (
          <button
            key={s.label}
            name="intent"
            value={s.intent ?? ""}
            disabled={pending}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${TONES[s.tone ?? "primary"]}`}
          >
            {pending ? "Working…" : s.label}
          </button>
        ))}
        {state && (
          <p
            role="status"
            className={`whitespace-pre-line text-sm ${state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
