"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MissingKeysError, assertLive, missingKeys } from "@/lib/config";
import { get, run, update, type Campaign } from "@/lib/db";
import { pingMuse } from "@/lib/muse";
import { checkApiKey, resumeCampaign } from "@/lib/heyreach";
import { parseCsv, toLeadRows } from "@/lib/csv";
import { approveAllDrafted, draftLead, draftNewLeads, importLeads, pushApproved, saveLeadCopy, syncFromHeyReach } from "@/lib/outreach";
import { clearPause, markRestricted, runGovernor } from "@/lib/governor";
import { closeConversation, pollInbox, sendReply } from "@/lib/inbox";
import { generateReport } from "@/lib/reports";
import { REPLY_CATEGORIES, HAND_OFF } from "@/lib/agents";
import { DEFAULT_SETTINGS, saveSettings, type Settings } from "@/lib/settings";

export type ActionResult = { ok: boolean; message: string };

async function attempt(fn: () => Promise<string> | string): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) {
    if (e instanceof MissingKeysError) {
      return { ok: false, message: `Set these up on the Setup page first: ${e.missing.map((m) => m.label).join(", ")}` };
    }
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => z.coerce.number().int().positive().parse(fd.get(k));

// ---------- clients ------------------------------------------------------

export async function createClientAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    const name = str(fd, "name");
    if (!name) throw new Error("Client name is required");
    run("INSERT INTO clients (name, notes) VALUES (?, ?)", name, str(fd, "notes"));
    return `Client "${name}" created.`;
  });
}

export async function updateClientAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    const id = num(fd, "id");
    // Never auto-send replies that should go to a human.
    const autoSend = fd.getAll("auto_send").map(String).filter((c) => (REPLY_CATEGORIES as readonly string[]).includes(c) && !HAND_OFF.has(c));
    update("clients", id, {
      name: str(fd, "name"),
      notes: str(fd, "notes"),
      require_approval: fd.get("require_approval") === "on" ? 1 : 0,
      auto_send: JSON.stringify(autoSend),
    }, ["name", "notes", "require_approval", "auto_send"]);
    return "Client saved.";
  });
}

export async function assignAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    const clientId = num(fd, "client_id");
    const senders = fd.getAll("senders").map(String);
    const campaigns = fd.getAll("campaigns").map(String);
    run("UPDATE senders SET client_id = NULL WHERE client_id = ?", clientId);
    run("UPDATE campaigns SET client_id = NULL WHERE client_id = ?", clientId);
    for (const s of senders) run("UPDATE senders SET client_id = ? WHERE id = ?", clientId, s);
    for (const c of campaigns) run("UPDATE campaigns SET client_id = ? WHERE id = ?", clientId, c);
    return `Assigned ${senders.length} account(s) and ${campaigns.length} campaign(s).`;
  });
}

export async function syncAction() {
  return attempt(async () => {
    const r = await syncFromHeyReach();
    return `Synced ${r.accounts} LinkedIn account(s) and ${r.campaigns} campaign(s) from HeyReach.`;
  });
}

// ---------- leads --------------------------------------------------------

export async function importCsvAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const campaignId = str(fd, "campaign_id");
    const campaign = get<Campaign>("SELECT * FROM campaigns WHERE id = ?", campaignId);
    if (!campaign?.client_id) throw new Error("Pick a campaign that is assigned to a client");
    const file = fd.get("file");
    const text = file instanceof File && file.size ? await file.text() : str(fd, "csv");
    if (!text) throw new Error("Upload a CSV or paste one");
    const { rows, skipped } = toLeadRows(parseCsv(text));
    if (!rows.length) throw new Error("No rows with a LinkedIn profile URL were found");
    const r = importLeads(campaign.client_id, campaignId, rows);
    return `${r.inserted} lead(s) imported, ${r.duplicates} already in this campaign, ${skipped} row(s) without a LinkedIn URL skipped.`;
  });
}

export async function draftNowAction() {
  return attempt(async () => `Drafted messages for ${await draftNewLeads(25)} lead(s).`);
}

export async function redraftAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const id = num(fd, "id");
    run("UPDATE leads SET status = 'new' WHERE id = ? AND status IN ('drafted', 'failed')", id);
    const lead = await draftLead(id);
    return `Lead is now ${lead?.status}.`;
  });
}

export async function saveLeadAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    const approve = fd.get("intent") === "approve";
    saveLeadCopy(num(fd, "id"), str(fd, "connection_note"), str(fd, "first_message"), approve);
    return approve ? "Saved and approved." : "Saved.";
  });
}

export async function approveAllAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => `${approveAllDrafted(str(fd, "campaign_id"))} lead(s) approved.`);
}

export async function pushNowAction() {
  return attempt(async () => {
    await runGovernor();
    const r = await pushApproved();
    return `Pushed ${r.pushed} to HeyReach, ${r.failed} failed, ${r.waiting} waiting for account capacity.`;
  });
}

// ---------- governor -----------------------------------------------------

export async function governorAction() {
  return attempt(async () => `Health checked. ${(await runGovernor()).changed} account status change(s).`);
}

export async function markRestrictedAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    await markRestricted(str(fd, "sender_id"), str(fd, "note"));
    return "Account paused and its campaigns paused in HeyReach.";
  });
}

export async function clearPauseAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    clearPause(str(fd, "sender_id"));
    return "Account cleared. It restarts at the ramp-up volume.";
  });
}

export async function resumeCampaignAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const id = str(fd, "campaign_id");
    assertLive(); // resuming restarts sending
    await resumeCampaign(id);
    run("UPDATE campaigns SET paused_by_guard = 0, status = 'IN_PROGRESS' WHERE id = ?", id);
    return "Campaign resumed in HeyReach.";
  });
}

// ---------- inbox --------------------------------------------------------

export async function sendReplyAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const id = str(fd, "conversation_id");
    if (fd.get("intent") === "close") {
      closeConversation(id);
      return "Closed without replying.";
    }
    await sendReply(id, str(fd, "message"));
    return "Sent through HeyReach.";
  });
}

export async function pollInboxAction() {
  return attempt(async () => `${await pollInbox()} new repl(ies) handled.`);
}

// ---------- reports ------------------------------------------------------

export async function reportAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    await generateReport(num(fd, "client_id"));
    return "Report written.";
  });
}

// ---------- settings -----------------------------------------------------

export async function saveSettingsAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    const patch: Partial<Settings> = {};
    for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
      const v = fd.get(key);
      if (v === null) continue;
      if (typeof def === "number") {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a positive number`);
        (patch as Record<string, unknown>)[key] = n;
      } else (patch as Record<string, unknown>)[key] = String(v).trim();
    }
    if ((patch.dailyCap ?? 0) > 40) throw new Error("Keep the daily cap at 40 or below per LinkedIn account");
    if ((patch.weeklyCap ?? 0) > 150) throw new Error("Keep the weekly cap at 150 or below per LinkedIn account");
    if ((patch.maxSimilarity ?? 0) > 1) throw new Error("Max similarity is between 0 and 1");
    saveSettings(patch);
    return "Settings saved.";
  });
}

export async function testConnectionsAction(): Promise<ActionResult> {
  const missing = missingKeys();
  if (missing.length) return { ok: false, message: `Missing: ${missing.map((m) => m.key).join(", ")}` };
  const lines: string[] = [];
  let ok = true;
  try {
    lines.push(`Muse Wonder: OK (${await pingMuse()})`);
  } catch (e) {
    ok = false;
    lines.push(`Muse Wonder: ${e instanceof Error ? e.message : e}`);
  }
  try {
    await checkApiKey();
    lines.push("HeyReach: OK");
  } catch (e) {
    ok = false;
    lines.push(`HeyReach: ${e instanceof Error ? e.message : e}`);
  }
  return { ok, message: lines.join("\n") };
}
