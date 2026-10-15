import { connection } from "next/server";
import { all, type Campaign } from "@/lib/db";
import { healthOfAll } from "@/lib/governor";
import { getSettings } from "@/lib/settings";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, inputClass } from "@/components/ui";
import { clearPauseAction, governorAction, markRestrictedAction, resumeCampaignAction } from "../actions";

export default async function AccountsPage() {
  await connection();
  const health = healthOfAll();
  const s = getSettings();
  const pausedCampaigns = all<Campaign>("SELECT * FROM campaigns WHERE paused_by_guard = 1");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Account safety</h1>
          <p className="text-sm text-muted">
            Caps: {s.dailyCap}/day and {s.weeklyCap}/week per account, new accounts ramp from {s.rampStartCap}/day over {s.rampDays} days.
            Volume halves below {s.minAcceptanceWarn}% acceptance and campaigns pause below {s.minAcceptancePause}%.
          </p>
        </div>
        <ActionForm action={governorAction} submit={[{ label: "Re-check now" }]} />
      </div>

      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
        These limits lower the risk of restrictions but cannot remove it — automating LinkedIn is against LinkedIn&apos;s terms of service.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {health.map((h) => (
          <Card key={h.sender.id} title={h.sender.name} actions={<Badge status={h.verdict} />}>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted">Added today</dt><dd className="tabular-nums">{h.sentToday} / {h.cap}</dd>
              <dt className="text-muted">Added this week</dt><dd className="tabular-nums">{h.sentWeek} / {s.weeklyCap}</dd>
              <dt className="text-muted">Requests (7d)</dt><dd className="tabular-nums">{h.requests7d}</dd>
              <dt className="text-muted">Acceptance (7d)</dt>
              <dd className="tabular-nums">
                {h.acceptance === null ? "no data yet" : `${h.acceptance}%`}
                {h.requests7d > 0 && h.requests7d < s.minSampleForRates && <span className="text-xs text-muted"> (too few to judge)</span>}
              </dd>
            </dl>
            <p className="mt-2 text-sm text-muted">{h.reason}</p>
            {h.verdict === "paused" ? (
              <ActionForm action={clearPauseAction} submit={[{ label: "Clear and restart ramp-up", tone: "neutral" }]} className="mt-3">
                <input type="hidden" name="sender_id" value={h.sender.id} />
              </ActionForm>
            ) : (
              <ActionForm action={markRestrictedAction} submit={[{ label: "Report LinkedIn warning", tone: "danger" }]} className="mt-3">
                <input type="hidden" name="sender_id" value={h.sender.id} />
                <input name="note" placeholder="What did LinkedIn show? (optional)" className={inputClass} />
              </ActionForm>
            )}
          </Card>
        ))}
        {!health.length && <p className="text-sm text-muted">No LinkedIn accounts synced yet.</p>}
      </div>

      {pausedCampaigns.length > 0 && (
        <Card title="Campaigns paused by ReachGuard">
          <ul className="space-y-2">
            {pausedCampaigns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{c.name}</span>
                <ActionForm action={resumeCampaignAction} submit={[{ label: "Resume in HeyReach", tone: "neutral" }]}>
                  <input type="hidden" name="campaign_id" value={c.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
