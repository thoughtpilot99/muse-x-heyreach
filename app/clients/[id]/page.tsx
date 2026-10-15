import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { all, get, type Campaign, type Client, type Sender } from "@/lib/db";
import { HAND_OFF, REPLY_CATEGORIES } from "@/lib/agents";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import { assignAction, reportAction, updateClientAction } from "../../actions";

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  await connection();
  const { id } = await params;
  const client = get<Client>("SELECT * FROM clients WHERE id = ?", Number(id));
  if (!client) notFound();
  const senders = all<Sender>("SELECT * FROM senders WHERE client_id IS NULL OR client_id = ? ORDER BY name", client.id);
  const campaigns = all<Campaign>("SELECT * FROM campaigns WHERE client_id IS NULL OR client_id = ? ORDER BY name", client.id);
  const autoSend: string[] = JSON.parse(client.auto_send || "[]");
  const safeCategories = REPLY_CATEGORIES.filter((c) => !HAND_OFF.has(c));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/clients" className="text-sm text-muted hover:underline">← Clients</Link>
        <h1 className="mt-1 text-2xl font-semibold">{client.name}</h1>
      </div>

      <Card title="Client details">
        <ActionForm action={updateClientAction} submit={[{ label: "Save" }]}>
          <input type="hidden" name="id" value={client.id} />
          <div className="space-y-3">
            <input name="name" defaultValue={client.name} className={inputClass} />
            <textarea name="notes" rows={4} defaultValue={client.notes} className={inputClass}
              placeholder="Offer, audience, proof points, words to avoid." />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="require_approval" defaultChecked={!!client.require_approval} />
              Approve outreach copy before it is pushed to HeyReach
            </label>
            <fieldset>
              <legend className="text-sm">Reply categories Muse Wonder may answer without approval</legend>
              <p className="text-xs text-muted">Interested leads and meeting requests always go to a human.</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {safeCategories.map((c) => (
                  <label key={c} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" name="auto_send" value={c} defaultChecked={autoSend.includes(c)} /> {c.replace("_", " ")}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </ActionForm>
      </Card>

      <Card title="LinkedIn accounts and campaigns">
        <ActionForm action={assignAction} submit={[{ label: "Save assignment" }]}>
          <input type="hidden" name="client_id" value={client.id} />
          <div className="grid gap-6 md:grid-cols-2">
            <fieldset>
              <legend className="mb-2 text-xs uppercase tracking-wide text-muted">Accounts</legend>
              {senders.map((s) => (
                <label key={s.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" name="senders" value={s.id} defaultChecked={s.client_id === client.id} /> {s.name}
                </label>
              ))}
              {!senders.length && <p className="text-sm text-muted">No free accounts. Sync from HeyReach on the Clients page.</p>}
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-xs uppercase tracking-wide text-muted">Campaigns</legend>
              {campaigns.map((c) => (
                <label key={c.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" name="campaigns" value={c.id} defaultChecked={c.client_id === client.id} /> {c.name}
                  <span className="text-xs text-muted">{c.status}</span>
                </label>
              ))}
              {!campaigns.length && <p className="text-sm text-muted">No free campaigns.</p>}
            </fieldset>
          </div>
        </ActionForm>
      </Card>

      <Card title="Weekly report">
        <ActionForm action={reportAction} submit={[{ label: "Write this week's report" }]}>
          <input type="hidden" name="client_id" value={client.id} />
        </ActionForm>
        <Link href={`/reports?client=${client.id}`} className="mt-2 inline-block text-sm underline">See reports</Link>
      </Card>
    </div>
  );
}
