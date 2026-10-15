import { describe, expect, it } from "vitest";
import { parseCsv, toLeadRows } from "@/lib/csv";
import { clamp, mostSimilar, similarity } from "@/lib/agents";
import { decide, rampCap } from "@/lib/governor";
import { DEFAULT_SETTINGS as S } from "@/lib/settings";
import { readWebhook } from "@/lib/inbox";
import { readConversation, readMessages } from "@/lib/heyreach";

describe("csv", () => {
  it("parses quotes, escaped quotes, commas and CRLF", () => {
    const rows = parseCsv('Profile URL,First Name,About\r\n"https://www.linkedin.com/in/ana/?trk=x",Ana,"Says ""hi"", a lot"\r\n');
    expect(rows).toEqual([{ profileurl: "https://www.linkedin.com/in/ana/?trk=x", firstname: "Ana", about: 'Says "hi", a lot' }]);
  });

  it("keeps only LinkedIn profile rows and cleans URLs", () => {
    const { rows, skipped } = toLeadRows(parseCsv("linkedin,first,title\nhttps://www.linkedin.com/in/ana/?trk=x,Ana,CEO\nhttps://evil.com/in/x,Bo,CTO\n,,\n"));
    expect(skipped).toBe(1);
    expect(rows).toEqual([{ profileUrl: "https://www.linkedin.com/in/ana", firstName: "Ana", lastName: "", company: "", position: "CEO", profileText: "" }]);
  });
});

describe("copy variation", () => {
  it("scores identical text 1 and unrelated text near 0", () => {
    expect(similarity("Loved your post about onboarding SDRs", "Loved your post about onboarding SDRs")).toBe(1);
    expect(similarity("Loved your post about onboarding", "Congrats on the new warehouse in Lyon")).toBeLessThan(0.1);
    expect(mostSimilar("a new idea entirely here", ["nothing alike whatsoever", "a new idea entirely here"])).toBe(1);
  });

  it("clamps long text at a word boundary", () => {
    const out = clamp("word ".repeat(100), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("…")).toBe(true);
    expect(clamp("short", 50)).toBe("short");
  });
});

describe("governor", () => {
  const base = { current: "ok" as const, manualPauseReason: null, requests7d: 0, accepted7d: 0, baseCap: 25, sentToday: 0, sentWeek: 0, s: S };

  it("ramps new accounts from the start cap to the daily cap", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    expect(rampCap("2026-10-15 00:00:00", S, now)).toBe(S.rampStartCap);
    expect(rampCap("2026-09-01 00:00:00", S, now)).toBe(S.dailyCap);
    const mid = rampCap("2026-10-08 00:00:00", S, now);
    expect(mid).toBeGreaterThan(S.rampStartCap);
    expect(mid).toBeLessThan(S.dailyCap);
  });

  it("ignores acceptance rate until there is enough data", () => {
    expect(decide({ ...base, requests7d: 10, accepted7d: 0 }).verdict).toBe("ok");
  });

  it("halves volume on low acceptance and pauses on very low acceptance", () => {
    const warn = decide({ ...base, requests7d: 100, accepted7d: 15 });
    expect(warn.verdict).toBe("warn");
    expect(warn.cap).toBe(12);
    const paused = decide({ ...base, requests7d: 100, accepted7d: 5 });
    expect(paused.verdict).toBe("paused");
    expect(paused.cap).toBe(0);
  });

  it("enforces the weekly cap and today's usage", () => {
    expect(decide({ ...base, sentWeek: 100, sentToday: 0 }).remaining).toBe(0);
    expect(decide({ ...base, sentWeek: 95, sentToday: 3 }).remaining).toBe(5);
    expect(decide({ ...base, sentToday: 25, sentWeek: 25 }).remaining).toBe(0);
  });

  it("keeps a manual pause in place regardless of rates", () => {
    const d = decide({ ...base, current: "paused", manualPauseReason: "Manual: warning", requests7d: 100, accepted7d: 60 });
    expect(d.verdict).toBe("paused");
  });
});

describe("payload readers", () => {
  it("reads a snake_case reply webhook", () => {
    const e = readWebhook({
      event_type: "message_reply_received",
      conversation_id: "c1",
      sender: { id: 77, full_name: "Rep" },
      campaign: { id: 9 },
      lead: { first_name: "Ana", last_name: "Silva", profile_url: "https://linkedin.com/in/ana" },
      recent_messages: [{ message: "old" }, { message: "Sounds good, Tuesday?" }],
    });
    expect(e).toEqual({
      type: "MESSAGE_REPLY_RECEIVED", senderId: "77", campaignId: "9", conversationId: "c1",
      leadName: "Ana Silva", leadProfileUrl: "https://linkedin.com/in/ana", message: "Sounds good, Tuesday?",
    });
  });

  it("reads chatroom messages and their direction", () => {
    expect(readMessages({ messages: [{ body: "hi", sender: "ME" }, { body: "hello", sender: "CORRESPONDENT", createdAt: "t" }] })).toEqual([
      { direction: "out", text: "hi", at: null },
      { direction: "in", text: "hello", at: "t" },
    ]);
  });

  it("reads a conversation list item", () => {
    const c = readConversation({ id: "c2", linkedInAccountId: 5, correspondentProfile: { firstName: "Bo", profileUrl: "u" }, messages: [{ body: "yo" }] });
    expect(c).toMatchObject({ id: "c2", accountId: "5", leadName: "Bo", leadProfileUrl: "u" });
    expect(c.messages).toHaveLength(1);
  });
});
