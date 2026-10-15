import Link from "next/link";
import { connection } from "next/server";
import { all, type Conversation } from "@/lib/db";
import type { HrMessage } from "@/lib/heyreach";
import { ActionForm } from "@/components/ActionForm";
import { Badge, inputClass } from "@/components/ui";
import { pollInboxAction, sendReplyAction } from "../actions";

const VIEWS = ["awaiting_approval", "handed_off", "sent", "failed", "closed"];

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  await connection();
  const { view: raw } = await searchParams;
  const view = typeof raw === "string" && VIEWS.includes(raw) ? raw : "awaiting_approval";
  const convs = all<Conversation & { client_name: string | null; sender_name: string | null }>(
    `SELECT c.*, cl.name AS client_name, s.name AS sender_name FROM conversations c
     LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN senders s ON s.id = c.sender_id
     WHERE c.status = ? ORDER BY c.hand_off DESC, c.last_inbound_at DESC LIMIT 200`,
    view,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inbox</h1>
          <p className="text-sm text-muted">Muse Wonder reads every reply and drafts the answer. Nothing is sent without approval unless a client allows it.</p>
        </div>
        <ActionForm action={pollInboxAction} submit={[{ label: "Check inbox", tone: "neutral" }]} />
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {VIEWS.map((v) => (
          <Link key={v} href={`/inbox?view=${v}`}
            className={`rounded-full border px-3 py-1 ${v === view ? "border-accent text-accent" : "border-line text-muted hover:text-foreground"}`}>
            {v.replace("_", " ")}
          </Link>
        ))}
      </div>

      <div className="space-y-4">
        {convs.map((c) => {
          const history: HrMessage[] = c.history ? JSON.parse(c.history) : [];
          return (
            <article key={c.id} className="rounded-lg border border-line bg-panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{c.lead_name ?? "Unknown lead"}</strong>
                {c.lead_profile_url && <a href={c.lead_profile_url} target="_blank" rel="noreferrer" className="text-xs underline">profile</a>}
                {c.category && <Badge status={c.category} />}
                {c.hand_off ? <span className="rounded bg-teal-500/20 px-2 py-0.5 text-xs font-medium text-teal-700 dark:text-teal-300">hand to a human</span> : null}
                <span className="ml-auto text-xs text-muted">{c.client_name ?? "no client"} · via {c.sender_name ?? c.sender_id}</span>
              </div>
              {c.summary && <p className="mt-2 text-sm text-muted">{c.summary}</p>}
              {c.error && <p className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{c.error}</p>}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted">Conversation ({history.length} messages)</summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {history.slice(-12).map((m, i) => (
                    <li key={i} className={m.direction === "out" ? "text-muted" : ""}>
                      <span className="text-xs uppercase">{m.direction === "out" ? "us" : "them"}:</span> {m.text}
                    </li>
                  ))}
                </ul>
              </details>
              <p className="mt-3 rounded-md bg-subtle px-3 py-2 text-sm"><span className="text-xs text-muted">Latest from them:</span> {c.last_inbound}</p>
              {(view === "awaiting_approval" || view === "failed" || view === "handed_off") && (
                <ActionForm action={sendReplyAction}
                  submit={[{ label: "Send", intent: "send" }, { label: "Close without replying", intent: "close", tone: "neutral" }]}
                  className="mt-3">
                  <input type="hidden" name="conversation_id" value={c.id} />
                  <textarea name="message" rows={3} defaultValue={c.suggested_reply ?? ""} className={inputClass} />
                </ActionForm>
              )}
            </article>
          );
        })}
        {!convs.length && <p className="text-sm text-muted">Nothing here.</p>}
      </div>
    </div>
  );
}
