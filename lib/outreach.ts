import { all, get, logEvent, run, update, type Campaign, type Client, type Lead } from "./db";
import { assertConfigured, assertLive } from "./config";
import { getSettings } from "./settings";
import { mostSimilar, writeOutreach } from "./agents";
import { addLeadsToCampaign, listAccounts, listCampaigns } from "./heyreach";
import { healthOfAll } from "./governor";
import type { LeadRow } from "./csv";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const LEAD_FIELDS = ["sender_id", "connection_note", "first_message", "basis", "status", "error", "pushed_at"];

// Custom fields the HeyReach campaign sequence uses as variables (see README).
export const NOTE_FIELD = "rg_connection_note";
export const MESSAGE_FIELD = "rg_first_message";

// ---------- sync from HeyReach -----------------------------------------

export async function syncFromHeyReach() {
  assertConfigured();
  const [accounts, campaigns] = await Promise.all([listAccounts(), listCampaigns()]);
  for (const a of accounts) {
    run("INSERT INTO senders (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name", a.id, a.name);
  }
  for (const c of campaigns) {
    run(
      `INSERT INTO campaigns (id, name, status) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status`,
      c.id, c.name, c.status,
    );
  }
  return { accounts: accounts.length, campaigns: campaigns.length };
}

// ---------- import + draft ---------------------------------------------

export function importLeads(clientId: number, campaignId: string, rows: LeadRow[]) {
  const campaign = get<Campaign>("SELECT * FROM campaigns WHERE id = ?", campaignId);
  if (!campaign) throw new Error("Unknown campaign — sync from HeyReach first");
  if (campaign.client_id !== clientId) throw new Error("That campaign is not assigned to this client");
  let inserted = 0;
  for (const r of rows) {
    const res = run(
      `INSERT INTO leads (client_id, campaign_id, profile_url, first_name, last_name, company, position, profile_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(campaign_id, profile_url) DO NOTHING`,
      clientId, campaignId, r.profileUrl, r.firstName || null, r.lastName || null, r.company || null, r.position || null, r.profileText || null,
    );
    inserted += Number(res.changes);
  }
  return { inserted, duplicates: rows.length - inserted };
}

/** Write a connection note + first message, rewriting once if too close to earlier copy in the same campaign. */
export async function draftLead(id: number): Promise<Lead | undefined> {
  assertConfigured();
  const claimed = run("UPDATE leads SET status = 'drafted', error = NULL WHERE id = ? AND status IN ('new', 'failed')", id);
  if (Number(claimed.changes) !== 1) return get<Lead>("SELECT * FROM leads WHERE id = ?", id);
  const lead = get<Lead>("SELECT * FROM leads WHERE id = ?", id)!;
  const client = get<Client>("SELECT * FROM clients WHERE id = ?", lead.client_id)!;
  const s = getSettings();
  try {
    const earlier = all<{ connection_note: string; first_message: string }>(
      "SELECT connection_note, first_message FROM leads WHERE campaign_id = ? AND id != ? AND connection_note IS NOT NULL ORDER BY id DESC LIMIT 200",
      lead.campaign_id, id,
    );
    const notes = earlier.map((e) => e.connection_note);
    const msgs = earlier.map((e) => e.first_message);
    let out = await writeOutreach(lead, client, s);
    const tooClose = () => mostSimilar(out.connection_note, notes) > s.maxSimilarity || mostSimilar(out.first_message, msgs) > s.maxSimilarity;
    if (tooClose()) {
      const sample = [...notes.slice(0, 5), ...msgs.slice(0, 5)];
      out = await writeOutreach(lead, client, s, sample);
    }
    const flag = tooClose() ? "Wording is still close to other messages in this campaign — edit before approving." : null;
    const status = client.require_approval || flag ? "drafted" : "approved";
    update("leads", id, { connection_note: out.connection_note, first_message: out.first_message, basis: out.basis, status, error: flag }, LEAD_FIELDS);
  } catch (e) {
    update("leads", id, { status: "failed", error: errMsg(e) }, LEAD_FIELDS);
  }
  return get<Lead>("SELECT * FROM leads WHERE id = ?", id);
}

export async function draftNewLeads(limit = 20) {
  const ids = all<{ id: number }>("SELECT id FROM leads WHERE status = 'new' ORDER BY id LIMIT ?", limit);
  for (const { id } of ids) await draftLead(id);
  return ids.length;
}

export function saveLeadCopy(id: number, note: string, message: string, approve: boolean) {
  const lead = get<Lead>("SELECT * FROM leads WHERE id = ?", id);
  if (!lead) throw new Error("Lead not found");
  if (lead.status === "pushed") throw new Error("Already pushed to HeyReach");
  if (!note.trim() || !message.trim()) throw new Error("Both the note and the message are needed");
  update("leads", id, {
    connection_note: note.trim(), first_message: message.trim(), error: null,
    ...(approve ? { status: "approved" } : {}),
  }, LEAD_FIELDS);
}

export function approveAllDrafted(campaignId: string) {
  return Number(run("UPDATE leads SET status = 'approved' WHERE campaign_id = ? AND status = 'drafted' AND error IS NULL", campaignId).changes);
}

// ---------- push to HeyReach under the governor's caps ------------------

export async function pushApproved(): Promise<{ pushed: number; failed: number; waiting: number }> {
  // Hard stop: nothing is added to HeyReach unless live mode is on.
  assertLive();
  // Capacity per sender comes from the governor (ramp-up, daily/weekly caps, health).
  const capacity = new Map(healthOfAll().filter((h) => h.verdict !== "paused").map((h) => [h.sender.id, h.remaining]));
  const leads = all<Lead>(
    "SELECT * FROM leads WHERE status = 'approved' ORDER BY id LIMIT 1000",
  );
  const senders = all<{ id: string; client_id: number }>("SELECT id, client_id FROM senders WHERE client_id IS NOT NULL");

  const batches = new Map<string, { campaignId: string; senderId: string; leads: Lead[] }>();
  let waiting = 0;
  for (const lead of leads) {
    // Round-robin: the client's account with the most remaining capacity today.
    const pool = senders.filter((s) => s.client_id === lead.client_id && (capacity.get(s.id) ?? 0) > 0);
    const pick = pool.sort((a, b) => (capacity.get(b.id) ?? 0) - (capacity.get(a.id) ?? 0))[0];
    if (!pick) {
      waiting++;
      continue;
    }
    capacity.set(pick.id, (capacity.get(pick.id) ?? 0) - 1);
    const key = `${lead.campaign_id}|${pick.id}`;
    if (!batches.has(key)) batches.set(key, { campaignId: lead.campaign_id, senderId: pick.id, leads: [] });
    batches.get(key)!.leads.push(lead);
  }

  let pushed = 0, failed = 0;
  for (const b of batches.values()) {
    for (let i = 0; i < b.leads.length; i += 100) {
      const chunk = b.leads.slice(i, i + 100);
      try {
        const res = await addLeadsToCampaign(b.campaignId, chunk.map((l) => ({
          linkedInAccountId: b.senderId,
          lead: {
            profileUrl: l.profile_url,
            firstName: l.first_name,
            lastName: l.last_name,
            companyName: l.company,
            position: l.position,
            customUserFields: [
              { name: NOTE_FIELD, value: l.connection_note ?? "" },
              { name: MESSAGE_FIELD, value: l.first_message ?? "" },
            ],
          },
        })));
        const now = new Date().toISOString();
        for (const l of chunk) update("leads", l.id, { status: "pushed", sender_id: b.senderId, pushed_at: now, error: null }, LEAD_FIELDS);
        pushed += chunk.length;
        if (res.failed) {
          logEvent({ source: "heyreach", kind: "add_leads_partial", ok: false, note: `${res.failed} of ${chunk.length} rejected by HeyReach`, payload: JSON.stringify(res.raw) });
        }
      } catch (e) {
        for (const l of chunk) update("leads", l.id, { error: errMsg(e) }, LEAD_FIELDS);
        logEvent({ source: "heyreach", kind: "add_leads_failed", ok: false, note: errMsg(e) });
        failed += chunk.length;
      }
    }
  }
  return { pushed, failed, waiting };
}
