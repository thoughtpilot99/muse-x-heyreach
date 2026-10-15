import Link from "next/link";
import { connection } from "next/server";
import { all } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import { createClientAction, syncAction } from "../actions";

export default async function ClientsPage() {
  await connection();
  const clients = all<{ id: number; name: string; senders: number; campaigns: number; leads: number }>(
    `SELECT c.id, c.name,
       (SELECT COUNT(*) FROM senders s WHERE s.client_id = c.id) AS senders,
       (SELECT COUNT(*) FROM campaigns k WHERE k.client_id = c.id) AS campaigns,
       (SELECT COUNT(*) FROM leads l WHERE l.client_id = c.id) AS leads
     FROM clients c ORDER BY c.name`,
  );
  const unassigned = all<{ n: number }>("SELECT COUNT(*) AS n FROM senders WHERE client_id IS NULL")[0]?.n ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-muted">Each client owns LinkedIn accounts and HeyReach campaigns. {unassigned} account(s) unassigned.</p>
        </div>
        <ActionForm action={syncAction} submit={[{ label: "Sync accounts and campaigns from HeyReach" }]} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {clients.map((c) => (
          <Link key={c.id} href={`/clients/${c.id}`} className="rounded-lg border border-line bg-panel p-4 hover:border-accent">
            <div className="font-medium">{c.name}</div>
            <div className="mt-1 text-sm text-muted">{c.senders} accounts · {c.campaigns} campaigns · {c.leads} leads</div>
          </Link>
        ))}
        {!clients.length && <p className="text-sm text-muted">No clients yet.</p>}
      </div>

      <Card title="New client">
        <ActionForm action={createClientAction} submit={[{ label: "Create client" }]}>
          <div className="space-y-3">
            <input name="name" required placeholder="Client name" className={inputClass} />
            <textarea name="notes" rows={3} className={inputClass}
              placeholder="What the client sells, to whom, proof points, and anything Muse Wonder must never say." />
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
