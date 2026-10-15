import Link from "next/link";
import { connection } from "next/server";
import { all } from "@/lib/db";

type Row = { id: number; client_id: number; client_name: string; period_start: string; period_end: string; markdown: string; created_at: string };

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  await connection();
  const { client } = await searchParams;
  const clientId = typeof client === "string" ? Number(client) : null;
  const reports = clientId
    ? all<Row>("SELECT r.*, c.name AS client_name FROM reports r JOIN clients c ON c.id = r.client_id WHERE r.client_id = ? ORDER BY r.id DESC LIMIT 50", clientId)
    : all<Row>("SELECT r.*, c.name AS client_name FROM reports r JOIN clients c ON c.id = r.client_id ORDER BY r.id DESC LIMIT 50");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted">Written by Muse Wonder from ReachGuard&apos;s records and HeyReach stats. Generate one from a client&apos;s page.</p>
      </div>
      {reports.map((r) => (
        <article key={r.id} className="rounded-lg border border-line bg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{r.client_name}</strong>
            <span className="text-xs text-muted">{r.period_start.slice(0, 10)} → {r.period_end.slice(0, 10)}</span>
            <Link href={`/reports/${r.id}/download`} className="text-sm underline">Download .md</Link>
          </div>
          <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap font-sans text-sm">{r.markdown}</pre>
        </article>
      ))}
      {!reports.length && <p className="text-sm text-muted">No reports yet.</p>}
    </div>
  );
}
