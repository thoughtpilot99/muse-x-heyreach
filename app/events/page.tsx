import { connection } from "next/server";
import { all } from "@/lib/db";

type Row = { id: number; source: string; kind: string; ok: number; note: string | null; headers: string | null; payload: string | null; created_at: string };

export default async function EventsPage() {
  await connection();
  const events = all<Row>("SELECT * FROM events ORDER BY id DESC LIMIT 200");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Events</h1>
        <p className="text-sm text-muted">
          Webhook deliveries and integration errors. Raw payloads are kept so field mapping can be checked against real data.
        </p>
      </div>
      <ul className="space-y-2">
        {events.map((e) => (
          <li key={e.id} className="rounded-lg border border-line bg-panel px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${e.ok ? "bg-emerald-500" : "bg-red-500"}`} />
              <strong>{e.source}</strong>
              <span>{e.kind}</span>
              <span className="text-xs text-muted">{e.created_at} UTC</span>
            </div>
            {e.note && <p className="mt-1 text-muted">{e.note}</p>}
            {(e.payload || e.headers) && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted">Raw</summary>
                {e.headers && <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(JSON.parse(e.headers), null, 2)}</pre>}
                {e.payload && <pre className="mt-2 max-h-80 overflow-auto text-xs">{e.payload}</pre>}
              </details>
            )}
          </li>
        ))}
        {!events.length && <li className="text-sm text-muted">No events yet.</li>}
      </ul>
    </div>
  );
}
