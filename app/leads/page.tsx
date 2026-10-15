import Link from "next/link";
import { connection } from "next/server";
import { all, type Lead } from "@/lib/db";
import { NOTE_LIMIT, MESSAGE_LIMIT } from "@/lib/agents";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, inputClass } from "@/components/ui";
import { approveAllAction, draftNowAction, importCsvAction, pushNowAction, redraftAction, saveLeadAction } from "../actions";

const STATUSES = ["drafted", "new", "approved", "pushed", "failed"];

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  await connection();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status) ? sp.status : "drafted";
  const campaigns = all<{ id: string; name: string; client_name: string }>(
    "SELECT k.id, k.name, c.name AS client_name FROM campaigns k JOIN clients c ON c.id = k.client_id ORDER BY c.name, k.name",
  );
  const campaignId = typeof sp.campaign === "string" && campaigns.some((c) => c.id === sp.campaign) ? sp.campaign : "";
  const leads = campaignId
    ? all<Lead>("SELECT * FROM leads WHERE status = ? AND campaign_id = ? ORDER BY id DESC LIMIT 200", status, campaignId)
    : all<Lead>("SELECT * FROM leads WHERE status = ? ORDER BY id DESC LIMIT 200", status);
  const href = (s: string) => `/leads?status=${s}${campaignId ? `&campaign=${campaignId}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted">
            Import → Muse Wonder writes a unique note and first message → approve → pushed to HeyReach within each account&apos;s safe limit.{" "}
            <a href="/leads/sample-csv" className="underline">CSV template</a>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionForm action={draftNowAction} submit={[{ label: "Draft new leads", tone: "neutral" }]} />
          <ActionForm action={pushNowAction} submit={[{ label: "Push approved" }]} />
        </div>
      </div>

      <Card title="Import leads (CSV)">
        {campaigns.length ? (
          <ActionForm action={importCsvAction} submit={[{ label: "Import" }]}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">
                <span className="text-xs text-muted">Campaign</span>
                <select name="campaign_id" className={`${inputClass} mt-1`} defaultValue={campaignId}>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.client_name} — {c.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted">CSV file</span>
                <input type="file" name="file" accept=".csv,text/csv" className={`${inputClass} mt-1`} />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted">
              Columns: profileUrl (required), firstName, lastName, company, position, about. &quot;about&quot; is the profile text Muse
              Wonder writes from — paste the person&apos;s headline, About section or a recent post. ReachGuard does not scrape LinkedIn.{" "}
              <a href="/leads/sample-csv" className="underline">Download a template</a>.
            </p>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">Assign a HeyReach campaign to a client first on the <Link href="/clients" className="underline">Clients</Link> page.</p>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link key={s} href={href(s)} className={`rounded-full border px-3 py-1 ${s === status ? "border-accent text-accent" : "border-line text-muted hover:text-foreground"}`}>{s}</Link>
        ))}
        <form className="ml-auto flex items-center gap-2">
          <input type="hidden" name="status" value={status} />
          <select name="campaign" defaultValue={campaignId} className={`${inputClass} w-64`}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.client_name} — {c.name}</option>)}
          </select>
          <button className="rounded-md border border-line px-3 py-1.5">Filter</button>
        </form>
      </div>

      {status === "drafted" && campaignId && leads.length > 0 && (
        <ActionForm action={approveAllAction} submit={[{ label: `Approve all ${leads.length} drafts without warnings` }]}>
          <input type="hidden" name="campaign_id" value={campaignId} />
        </ActionForm>
      )}

      <div className="space-y-3">
        {leads.map((l) => (
          <article key={l.id} className="rounded-lg border border-line bg-panel p-4">
            <div className="flex flex-wrap items-center gap-2">
              <a href={l.profile_url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                {[l.first_name, l.last_name].filter(Boolean).join(" ") || l.profile_url}
              </a>
              <span className="text-sm text-muted">{l.position}{l.company ? ` · ${l.company}` : ""}</span>
              <span className="ml-auto"><Badge status={l.status} /></span>
            </div>
            {l.error && <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm">{l.error}</p>}
            {l.connection_note && (
              <ActionForm action={saveLeadAction}
                submit={l.status === "pushed" ? [] : [{ label: "Save and approve", intent: "approve" }, { label: "Save", intent: "save", tone: "neutral" }]}
                className="mt-3">
                <input type="hidden" name="id" value={l.id} />
                <fieldset disabled={l.status === "pushed"} className="grid gap-3 md:grid-cols-2">
                  <label className="block text-xs text-muted">Connection note (max {NOTE_LIMIT})
                    <textarea name="connection_note" maxLength={NOTE_LIMIT} rows={3} defaultValue={l.connection_note} className={`${inputClass} mt-1`} />
                  </label>
                  <label className="block text-xs text-muted">First message after accept (max {MESSAGE_LIMIT})
                    <textarea name="first_message" maxLength={MESSAGE_LIMIT} rows={3} defaultValue={l.first_message ?? ""} className={`${inputClass} mt-1`} />
                  </label>
                </fieldset>
                {l.basis && <p className="mt-2 text-xs text-muted">Based on: {l.basis}</p>}
              </ActionForm>
            )}
            {(l.status === "drafted" || l.status === "failed") && (
              <ActionForm action={redraftAction} submit={[{ label: "Rewrite with Muse Wonder", tone: "neutral" }]}>
                <input type="hidden" name="id" value={l.id} />
              </ActionForm>
            )}
          </article>
        ))}
        {!leads.length && <p className="text-sm text-muted">No {status} leads.</p>}
      </div>
    </div>
  );
}
