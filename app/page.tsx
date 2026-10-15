import Link from "next/link";
import { connection } from "next/server";
import { all, get } from "@/lib/db";
import { healthOfAll } from "@/lib/governor";
import { config } from "@/lib/config";
import { ActionForm } from "@/components/ActionForm";
import { Checklist } from "@/components/Checklist";
import { Badge, Card, Stat } from "@/components/ui";
import { draftNowAction, pollInboxAction, pushNowAction } from "./actions";

export default async function Dashboard() {
  await connection();
  const n = (sql: string) => get<{ n: number }>(sql)?.n ?? 0;
  const health = healthOfAll();
  const awaiting = n("SELECT COUNT(*) AS n FROM conversations WHERE status = 'awaiting_approval'");
  const hot = n("SELECT COUNT(*) AS n FROM conversations WHERE hand_off = 1 AND status IN ('awaiting_approval', 'handed_off')");
  const pushedToday = n("SELECT COUNT(*) AS n FROM leads WHERE date(pushed_at, 'localtime') = date('now', 'localtime')");
  const capacity = health.reduce((a, h) => a + h.remaining, 0);
  const drafted = n("SELECT COUNT(*) AS n FROM leads WHERE status = 'drafted'");
  const ai = get<{ cost: number | null; runs: number }>("SELECT SUM(cost_usd) AS cost, COUNT(*) AS runs FROM ai_runs") ?? { cost: 0, runs: 0 };
  const categories = all<{ category: string; n: number }>(
    "SELECT category, COUNT(*) AS n FROM conversations WHERE category IS NOT NULL AND updated_at >= datetime('now', '-7 days') GROUP BY category ORDER BY n DESC",
  );

  const checklist = [
    { label: "Connect Muse Wonder", done: !!config.museApiKey(), href: "/setup" },
    { label: "Connect HeyReach and sync", done: !!config.heyreachApiKey() && health.length > 0, href: "/setup" },
    { label: "Create a client", done: n("SELECT COUNT(*) AS n FROM clients") > 0, href: "/clients" },
    { label: "Assign accounts and campaigns", done: n("SELECT COUNT(*) AS n FROM campaigns WHERE client_id IS NOT NULL") > 0, href: "/clients" },
    { label: "Import leads (CSV)", done: n("SELECT COUNT(*) AS n FROM leads") > 0, href: "/leads" },
    { label: "Review and approve drafts", done: n("SELECT COUNT(*) AS n FROM leads WHERE status IN ('approved', 'pushed')") > 0, href: "/leads" },
    { label: "Set up webhooks", done: !!config.webhookToken(), href: "/setup" },
    { label: "Turn live mode on", done: config.liveEnabled(), href: "/setup" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted">HeyReach sends. Muse Wonder writes, guards every account, and answers replies.</p>
      </div>

      <Checklist items={checklist} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Replies to approve" value={awaiting} hint={`${hot} ready for a human`} />
        <Stat label="Leads added today" value={pushedToday} hint={`${capacity} more allowed today`} />
        <Stat label="Drafts to review" value={drafted} />
        <Stat label="Muse Wonder spend" value={`$${(ai.cost ?? 0).toFixed(2)}`} hint={`${ai.runs} model calls`} />
      </div>

      <Card title="LinkedIn account health" actions={<Link href="/accounts" className="text-sm underline">Details</Link>}>
        {health.length ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {health.map((h) => (
              <div key={h.sender.id} className="rounded-md border border-line px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{h.sender.name}</span>
                  <Badge status={h.verdict} />
                </div>
                <div className="mt-1 text-xs text-muted">
                  {h.sentToday}/{h.cap} today · acceptance {h.acceptance === null ? "–" : `${h.acceptance}%`}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No LinkedIn accounts yet. <Link href="/clients" className="underline">Sync from HeyReach</Link>.</p>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Replies this week">
          {categories.length ? (
            <ul className="space-y-1 text-sm">
              {categories.map((c) => (
                <li key={c.category} className="flex justify-between"><span>{c.category.replace("_", " ")}</span><span className="tabular-nums">{c.n}</span></li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No replies yet.</p>
          )}
        </Card>
        <Card title="Run now">
          <div className="space-y-1">
            <ActionForm action={draftNowAction} submit={[{ label: "Draft messages for new leads" }]} />
            <ActionForm action={pushNowAction} submit={[{ label: "Check health and push approved leads", tone: "neutral" }]} />
            <ActionForm action={pollInboxAction} submit={[{ label: "Check inbox", tone: "neutral" }]} />
          </div>
          <p className="mt-3 text-xs text-muted">These also run automatically every 1–10 minutes.</p>
        </Card>
      </div>
    </div>
  );
}
