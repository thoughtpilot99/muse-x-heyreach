import { all, get, logEvent, run, type Campaign, type Client } from "./db";
import { assertConfigured } from "./config";
import { getSettings } from "./settings";
import { writeReport } from "./agents";
import { getOverallStats } from "./heyreach";

/** Facts for the last 7 days, computed from ReachGuard's own records plus HeyReach stats. */
export async function gatherFacts(clientId: number) {
  const n = (sql: string, ...p: (string | number)[]) => get<{ n: number }>(sql, ...p)?.n ?? 0;
  const campaigns = all<Campaign>("SELECT * FROM campaigns WHERE client_id = ?", clientId);
  const senders = all<{ id: string; name: string; status: string; status_reason: string | null }>(
    "SELECT id, name, status, status_reason FROM senders WHERE client_id = ?", clientId,
  );
  const senderIds = senders.map((s) => s.id);
  const inSenders = senderIds.length ? `(${senderIds.map(() => "?").join(",")})` : "('')";
  const health = (kind: string) =>
    n(`SELECT COUNT(*) AS n FROM health_events WHERE kind = ? AND created_at >= datetime('now', '-7 days') AND sender_id IN ${inSenders}`, kind, ...senderIds);

  const categories = all<{ category: string; n: number }>(
    "SELECT category, COUNT(*) AS n FROM conversations WHERE client_id = ? AND updated_at >= datetime('now', '-7 days') AND category IS NOT NULL GROUP BY category",
    clientId,
  );
  const notable = all<{ lead_name: string | null; category: string; summary: string }>(
    "SELECT lead_name, category, summary FROM conversations WHERE client_id = ? AND updated_at >= datetime('now', '-7 days') AND hand_off = 1 ORDER BY updated_at DESC LIMIT 8",
    clientId,
  );
  const safety = all<{ note: string; created_at: string }>(
    "SELECT note, created_at FROM events WHERE source = 'governor' AND created_at >= datetime('now', '-7 days') ORDER BY id DESC LIMIT 20",
  ).filter((e) => senders.some((s) => e.note?.includes(s.name)) || campaigns.some((c) => e.note?.includes(c.id)));

  let heyreachStats: unknown = "not available";
  if (campaigns.length) {
    const end = new Date();
    try {
      heyreachStats = await getOverallStats({
        startDate: new Date(end.getTime() - 7 * 86_400_000).toISOString(),
        endDate: end.toISOString(),
        campaignIds: campaigns.map((c) => c.id),
      });
    } catch (e) {
      logEvent({ source: "heyreach", kind: "stats_failed", ok: false, note: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    campaigns: campaigns.map((c) => ({ name: c.name, status: c.status })),
    linkedin_accounts: senders.map((s) => ({ name: s.name, status: s.status, note: s.status_reason })),
    leads_added: n("SELECT COUNT(*) AS n FROM leads WHERE client_id = ? AND pushed_at >= datetime('now', '-7 days')", clientId),
    connection_requests_sent: health("CONNECTION_REQUEST_SENT"),
    connections_accepted: health("CONNECTION_REQUEST_ACCEPTED"),
    replies_by_category: Object.fromEntries(categories.map((c) => [c.category, c.n])),
    hot_conversations: notable,
    safety_actions: safety.map((s) => `${s.created_at}: ${s.note}`),
    heyreach_stats: heyreachStats,
  };
}

export async function generateReport(clientId: number) {
  assertConfigured();
  const client = get<Client>("SELECT * FROM clients WHERE id = ?", clientId);
  if (!client) throw new Error("Client not found");
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const period = `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`;
  const facts = await gatherFacts(clientId);
  const { markdown } = await writeReport({ client, agency: getSettings().agencyName, period, facts });
  const res = run(
    "INSERT INTO reports (client_id, period_start, period_end, markdown) VALUES (?, ?, ?, ?)",
    clientId, start.toISOString(), end.toISOString(), markdown,
  );
  return Number(res.lastInsertRowid);
}
