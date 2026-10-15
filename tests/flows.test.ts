import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents")>()),
  writeOutreach: vi.fn(),
  triageConversation: vi.fn(),
}));
vi.mock("@/lib/heyreach", async (orig) => ({
  ...(await orig<typeof import("@/lib/heyreach")>()),
  addLeadsToCampaign: vi.fn(),
  pauseCampaign: vi.fn(),
  getChatroom: vi.fn(),
  sendMessage: vi.fn(),
}));

import { triageConversation, writeOutreach } from "@/lib/agents";
import { addLeadsToCampaign, getChatroom, pauseCampaign, sendMessage } from "@/lib/heyreach";
import { db, get, run, type Conversation, type Lead } from "@/lib/db";
import { saveSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { draftLead, importLeads, pushApproved } from "@/lib/outreach";
import { markRestricted, runGovernor } from "@/lib/governor";
import { handleWebhook, processInbound } from "@/lib/inbox";

let clientId = 0;

beforeEach(() => {
  vi.clearAllMocks();
  db().exec("DELETE FROM leads; DELETE FROM conversations; DELETE FROM health_events; DELETE FROM senders; DELETE FROM campaigns; DELETE FROM clients; DELETE FROM settings; DELETE FROM events;");
  saveSettings(DEFAULT_SETTINGS);
  clientId = Number(run("INSERT INTO clients (name, notes, require_approval) VALUES ('Acme', 'sells X', 1)").lastInsertRowid);
  run("INSERT INTO campaigns (id, client_id, name, status) VALUES ('10', ?, 'Q4', 'IN_PROGRESS')", clientId);
  // Two accounts old enough to be past ramp-up.
  run("INSERT INTO senders (id, client_id, name, first_seen) VALUES ('1', ?, 'Rep One', datetime('now', '-60 days'))", clientId);
  run("INSERT INTO senders (id, client_id, name, first_seen) VALUES ('2', ?, 'Rep Two', datetime('now', '-60 days'))", clientId);
  vi.mocked(addLeadsToCampaign).mockImplementation(async (_c, pairs) => ({ added: pairs.length, updated: 0, failed: 0, raw: {} }));
});

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ profileUrl: `https://www.linkedin.com/in/p${i}`, firstName: `P${i}`, lastName: "", company: "Co", position: "CEO", profileText: "" }));

describe("outreach", () => {
  it("rejects imports into campaigns of another client", () => {
    const other = Number(run("INSERT INTO clients (name) VALUES ('Other')").lastInsertRowid);
    expect(() => importLeads(other, "10", rows(1))).toThrow(/not assigned/);
    expect(importLeads(clientId, "10", [...rows(2), ...rows(2)])).toEqual({ inserted: 2, duplicates: 2 });
  });

  it("rewrites copy that is too similar to earlier messages in the campaign", async () => {
    importLeads(clientId, "10", rows(2));
    const [a, b] = db().prepare("SELECT id FROM leads ORDER BY id").all() as { id: number }[];
    const same = { connection_note: "Loved your post on onboarding sales hires", first_message: "Thanks for connecting, how do you ramp reps?", basis: "post" };
    vi.mocked(writeOutreach).mockResolvedValueOnce(same).mockResolvedValueOnce(same)
      .mockResolvedValueOnce({ connection_note: "Your Lyon expansion caught my eye", first_message: "Curious what hiring looks like there now?", basis: "news" });
    await draftLead(a.id);
    await draftLead(b.id);
    expect(writeOutreach).toHaveBeenCalledTimes(3);
    expect(vi.mocked(writeOutreach).mock.calls[2][3]).toContain(same.connection_note);
    expect(get<Lead>("SELECT * FROM leads WHERE id = ?", b.id)).toMatchObject({ status: "drafted", error: null });
  });

  it("splits pushes across accounts within each account's daily cap", async () => {
    saveSettings({ dailyCap: 3 });
    importLeads(clientId, "10", rows(8));
    run("UPDATE leads SET status = 'approved', connection_note = 'n', first_message = 'm'");
    const r = await pushApproved();
    expect(r).toEqual({ pushed: 6, failed: 0, waiting: 2 });
    const perSender = db().prepare("SELECT sender_id, COUNT(*) AS n FROM leads WHERE status = 'pushed' GROUP BY sender_id").all();
    expect(perSender).toEqual([{ sender_id: "1", n: 3 }, { sender_id: "2", n: 3 }]);
    const [, pairs] = vi.mocked(addLeadsToCampaign).mock.calls[0];
    expect(pairs[0].lead.customUserFields).toEqual([{ name: "rg_connection_note", value: "n" }, { name: "rg_first_message", value: "m" }]);
  });

  it("never pushes through a paused account", async () => {
    importLeads(clientId, "10", rows(2));
    run("UPDATE leads SET status = 'approved', connection_note = 'n', first_message = 'm'");
    await markRestricted("1", "captcha");
    await markRestricted("2", "");
    expect((await pushApproved()).pushed).toBe(0);
  });
});

describe("governor", () => {
  it("pauses an account with very low acceptance and pauses its campaigns", async () => {
    importLeads(clientId, "10", rows(1));
    run("UPDATE leads SET status = 'pushed', sender_id = '1', pushed_at = datetime('now')");
    for (let i = 0; i < 40; i++) run("INSERT INTO health_events (sender_id, kind) VALUES ('1', 'CONNECTION_REQUEST_SENT')");
    run("INSERT INTO health_events (sender_id, kind) VALUES ('1', 'CONNECTION_REQUEST_ACCEPTED')");
    const r = await runGovernor();
    expect(r.changed).toBe(1);
    expect(get<{ status: string }>("SELECT status FROM senders WHERE id = '1'")?.status).toBe("paused");
    expect(pauseCampaign).toHaveBeenCalledWith("10");
  });
});

describe("reply agent", () => {
  const triage = (category: string, hand_off = false) => ({ category, summary: "s", suggested_reply: "Thanks!", hand_off }) as Awaited<ReturnType<typeof triageConversation>>;

  it("drafts a reply for approval and records health events from webhooks", async () => {
    vi.mocked(getChatroom).mockResolvedValue([{ direction: "out", text: "hi", at: null }, { direction: "in", text: "Tell me more", at: null }]);
    vi.mocked(triageConversation).mockResolvedValue(triage("question"));
    await handleWebhook({ type: "MESSAGE_REPLY_RECEIVED", senderId: "1", campaignId: "10", conversationId: "c1", leadName: "Ana", leadProfileUrl: null, message: "Tell me more" });
    const c = get<Conversation>("SELECT * FROM conversations WHERE id = 'c1'");
    expect(c).toMatchObject({ status: "awaiting_approval", category: "question", client_id: clientId, last_inbound: "Tell me more" });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM health_events WHERE kind = 'MESSAGE_REPLY_RECEIVED'")?.n).toBe(1);
  });

  it("auto-sends only allowed categories and never hand-offs", async () => {
    run("UPDATE clients SET auto_send = '[\"not_now\",\"interested\"]' WHERE id = ?", clientId);
    vi.mocked(getChatroom).mockResolvedValue([{ direction: "in", text: "Not now", at: null }]);
    vi.mocked(triageConversation).mockResolvedValueOnce(triage("not_now"));
    await processInbound({ conversationId: "c2", senderId: "1", campaignId: "10", leadName: null, leadProfileUrl: null, fallback: [] });
    expect(sendMessage).toHaveBeenCalledWith("c2", "1", "Thanks!");
    expect(get<Conversation>("SELECT * FROM conversations WHERE id = 'c2'")?.status).toBe("sent");

    vi.mocked(getChatroom).mockResolvedValue([{ direction: "in", text: "Yes let's talk", at: null }]);
    vi.mocked(triageConversation).mockResolvedValueOnce(triage("interested", true));
    await processInbound({ conversationId: "c3", senderId: "1", campaignId: "10", leadName: null, leadProfileUrl: null, fallback: [] });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(get<Conversation>("SELECT * FROM conversations WHERE id = 'c3'")).toMatchObject({ status: "awaiting_approval", hand_off: 1 });
  });

  it("does not re-triage the same inbound message twice", async () => {
    vi.mocked(getChatroom).mockResolvedValue([{ direction: "in", text: "Hello", at: null }]);
    vi.mocked(triageConversation).mockResolvedValue(triage("other"));
    await processInbound({ conversationId: "c4", senderId: "1", campaignId: null, leadName: null, leadProfileUrl: null, fallback: [] });
    await processInbound({ conversationId: "c4", senderId: "1", campaignId: null, leadName: null, leadProfileUrl: null, fallback: [] });
    expect(triageConversation).toHaveBeenCalledTimes(1);
  });
});
