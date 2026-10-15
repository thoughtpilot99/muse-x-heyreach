import { all, get, run, update, logEvent, type Sender } from "./db";
import { getSettings, type Settings } from "./settings";
import { pauseCampaign } from "./heyreach";

// The safety governor keeps every LinkedIn account well under LinkedIn's
// informal limits and backs off when acceptance rates suggest the account is
// being flagged. It lowers, but cannot remove, the risk of restriction:
// automating LinkedIn is against its terms of service.

export type Health = {
  sender: Sender;
  sentToday: number;
  sentWeek: number;
  requests7d: number;
  accepted7d: number;
  acceptance: number | null; // %
  cap: number; // effective cap for today
  remaining: number;
  verdict: "ok" | "warn" | "paused";
  reason: string;
};

const DAY = 86_400_000;

export function rampCap(firstSeen: string, s: Settings, now = new Date()): number {
  // SQLite datetime('now') is UTC without a zone marker.
  const t = Date.parse(firstSeen.includes("T") ? firstSeen : `${firstSeen.replace(" ", "T")}Z`);
  const ageDays = Number.isNaN(t) ? 0 : Math.max(0, (now.getTime() - t) / DAY);
  if (ageDays >= s.rampDays) return s.dailyCap;
  const frac = ageDays / s.rampDays;
  return Math.max(1, Math.round(s.rampStartCap + (s.dailyCap - s.rampStartCap) * frac));
}

/** Pure decision used by assess(); kept separate so it can be unit-tested. */
export function decide(input: {
  current: Sender["status"];
  manualPauseReason: string | null;
  requests7d: number;
  accepted7d: number;
  baseCap: number;
  sentToday: number;
  sentWeek: number;
  s: Settings;
}): Pick<Health, "acceptance" | "cap" | "remaining" | "verdict" | "reason"> {
  const { s } = input;
  const acceptance = input.requests7d > 0 ? Math.round((input.accepted7d / input.requests7d) * 100) : null;
  const trusted = acceptance !== null && input.requests7d >= s.minSampleForRates;

  let verdict: Health["verdict"] = "ok";
  let reason = "Healthy.";
  if (input.current === "paused" && input.manualPauseReason) {
    verdict = "paused";
    reason = input.manualPauseReason;
  } else if (trusted && acceptance! < s.minAcceptancePause) {
    verdict = "paused";
    reason = `Acceptance ${acceptance}% over the last 7 days is below ${s.minAcceptancePause}%. LinkedIn treats low acceptance as a spam signal.`;
  } else if (trusted && acceptance! < s.minAcceptanceWarn) {
    verdict = "warn";
    reason = `Acceptance ${acceptance}% is below ${s.minAcceptanceWarn}%; daily volume halved until it recovers.`;
  }

  let cap = verdict === "paused" ? 0 : verdict === "warn" ? Math.floor(input.baseCap / 2) : input.baseCap;
  cap = Math.min(cap, Math.max(0, s.weeklyCap - input.sentWeek + input.sentToday));
  if (input.sentWeek >= s.weeklyCap && verdict === "ok") reason = `Weekly cap of ${s.weeklyCap} reached.`;
  return { acceptance, cap, remaining: Math.max(0, cap - input.sentToday), verdict, reason };
}

function counts(senderId: string) {
  const c = (sql: string) => get<{ n: number }>(sql, senderId)?.n ?? 0;
  return {
    sentToday: c("SELECT COUNT(*) AS n FROM leads WHERE sender_id = ? AND pushed_at IS NOT NULL AND date(pushed_at, 'localtime') = date('now', 'localtime')"),
    sentWeek: c("SELECT COUNT(*) AS n FROM leads WHERE sender_id = ? AND pushed_at >= datetime('now', '-7 days')"),
    requests7d: c("SELECT COUNT(*) AS n FROM health_events WHERE sender_id = ? AND kind = 'CONNECTION_REQUEST_SENT' AND created_at >= datetime('now', '-7 days')"),
    accepted7d: c("SELECT COUNT(*) AS n FROM health_events WHERE sender_id = ? AND kind = 'CONNECTION_REQUEST_ACCEPTED' AND created_at >= datetime('now', '-7 days')"),
  };
}

export function assess(sender: Sender, s = getSettings()): Health {
  const c = counts(sender.id);
  const manual = sender.status === "paused" && sender.status_reason?.startsWith("Manual") ? sender.status_reason : null;
  const d = decide({ current: sender.status, manualPauseReason: manual, baseCap: rampCap(sender.first_seen, s), s, ...c });
  return { sender, ...c, ...d };
}

export function healthOfAll(): Health[] {
  const s = getSettings();
  return all<Sender>("SELECT * FROM senders ORDER BY name").map((x) => assess(x, s));
}

/** Pause every campaign this account pushed leads into during the last 14 days. */
async function pauseCampaignsFor(senderId: string, reason: string) {
  const campaigns = all<{ campaign_id: string }>(
    "SELECT DISTINCT campaign_id FROM leads WHERE sender_id = ? AND pushed_at >= datetime('now', '-14 days')",
    senderId,
  );
  for (const { campaign_id } of campaigns) {
    try {
      await pauseCampaign(campaign_id);
      run("UPDATE campaigns SET paused_by_guard = 1, status = 'PAUSED' WHERE id = ?", campaign_id);
      logEvent({ source: "governor", kind: "campaign_paused", ok: true, note: `Campaign ${campaign_id}: ${reason}` });
    } catch (e) {
      logEvent({ source: "governor", kind: "campaign_pause_failed", ok: false, note: `Campaign ${campaign_id}: ${e instanceof Error ? e.message : e}` });
    }
  }
}

/** Re-evaluate every account; persist status changes and pause campaigns when an account turns red. */
export async function runGovernor(): Promise<{ changed: number }> {
  let changed = 0;
  for (const h of healthOfAll()) {
    if (h.verdict === h.sender.status) continue;
    update("senders", h.sender.id, { status: h.verdict, status_reason: h.reason, status_changed_at: new Date().toISOString() },
      ["status", "status_reason", "status_changed_at"]);
    logEvent({ source: "governor", kind: `sender_${h.verdict}`, ok: h.verdict !== "paused", note: `${h.sender.name}: ${h.reason}` });
    if (h.verdict === "paused") await pauseCampaignsFor(h.sender.id, h.reason);
    changed++;
  }
  return { changed };
}

/** A rep saw a LinkedIn warning or restriction for this account: stop immediately. */
export async function markRestricted(senderId: string, note: string) {
  const reason = `Manual: LinkedIn warning reported${note ? ` — ${note}` : ""}. Resume only after the account is verified and warmed up again.`;
  update("senders", senderId, { status: "paused", status_reason: reason, status_changed_at: new Date().toISOString() },
    ["status", "status_reason", "status_changed_at"]);
  run("INSERT INTO health_events (sender_id, kind) VALUES (?, 'RESTRICTION_REPORTED')", senderId);
  await pauseCampaignsFor(senderId, reason);
}

export function clearPause(senderId: string) {
  update("senders", senderId, { status: "ok", status_reason: "Cleared manually.", status_changed_at: new Date().toISOString() },
    ["status", "status_reason", "status_changed_at"]);
  // Restart the ramp so a recovered account warms up again.
  run("UPDATE senders SET first_seen = datetime('now') WHERE id = ?", senderId);
}
