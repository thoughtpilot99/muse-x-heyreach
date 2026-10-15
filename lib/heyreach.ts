import { config } from "./config";

// HeyReach public API. Paths and bodies follow the official Postman collection
// as wrapped by the open-source heyreach-cli (bcharleson/heyreach-cli).
// Response shapes are only partly documented, so readers below are tolerant
// and every raw response that matters is logged by the callers.
const BASE = "https://api.heyreach.io/api/public";

export class HeyReachError extends Error {
  constructor(public status: number, message: string) {
    super(`HeyReach ${status}: ${message}`);
  }
}

// Simple client-side limiter: HeyReach allows 300 requests/minute.
const g = globalThis as unknown as { __hrCalls?: number[] };
async function throttle() {
  const calls = (g.__hrCalls ??= []);
  const now = Date.now();
  while (calls.length && now - calls[0] > 60_000) calls.shift();
  if (calls.length >= 280) await new Promise((r) => setTimeout(r, 60_000 - (now - calls[0])));
  calls.push(Date.now());
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  await throttle();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "X-API-KEY": config.heyreachApiKey(), "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new HeyReachError(res.status, text.slice(0, 300) || res.statusText);
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
export function pickStr(o: unknown, keys: string[]): string | null {
  if (!isObj(o)) return null;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}
const items = (res: unknown): Obj[] => (isObj(res) && Array.isArray(res.items) ? res.items.filter(isObj) : Array.isArray(res) ? res.filter(isObj) : []);

async function paged(path: string, body: Obj = {}): Promise<Obj[]> {
  const out: Obj[] = [];
  for (let offset = 0; offset < 5_000; offset += 100) {
    const res = await call<unknown>("POST", path, { ...body, offset, limit: 100 });
    const page = items(res);
    out.push(...page);
    const total = isObj(res) && typeof res.totalCount === "number" ? res.totalCount : null;
    if (page.length < 100 || (total !== null && out.length >= total)) break;
  }
  return out;
}

export async function checkApiKey(): Promise<void> {
  await call("GET", "/auth/CheckApiKey");
}

export type HrAccount = { id: string; name: string };
export async function listAccounts(): Promise<HrAccount[]> {
  return (await paged("/li_account/GetAll")).map((a) => ({
    id: pickStr(a, ["id", "linkedInAccountId"]) ?? "",
    name:
      [pickStr(a, ["firstName"]), pickStr(a, ["lastName"])].filter(Boolean).join(" ") ||
      pickStr(a, ["name", "emailAddress", "email"]) || "LinkedIn account",
  })).filter((a) => a.id);
}

export type HrCampaign = { id: string; name: string; status: string; accountIds: string[] };
export async function listCampaigns(): Promise<HrCampaign[]> {
  return (await paged("/campaign/GetAll")).map((c) => {
    const ids = [c.campaignAccountIds, c.linkedInAccountIds, c.accountIds].find(Array.isArray) as unknown[] | undefined;
    return {
      id: pickStr(c, ["id", "campaignId"]) ?? "",
      name: pickStr(c, ["name"]) ?? "Untitled campaign",
      status: pickStr(c, ["status"]) ?? "UNKNOWN",
      accountIds: (ids ?? []).map(String),
    };
  }).filter((c) => c.id);
}

export type LeadInput = {
  profileUrl: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  position?: string | null;
  customUserFields?: { name: string; value: string }[];
};

export async function addLeadsToCampaign(campaignId: string, pairs: { linkedInAccountId: string; lead: LeadInput }[]) {
  const res = await call<Obj>("POST", "/campaign/AddLeadsToCampaignV2", {
    campaignId: Number(campaignId),
    accountLeadPairs: pairs.map((p) => ({ linkedInAccountId: Number(p.linkedInAccountId), lead: p.lead })),
  });
  return {
    added: Number(res?.addedLeadsCount ?? 0),
    updated: Number(res?.updatedLeadsCount ?? 0),
    failed: Number(res?.failedLeadsCount ?? 0),
    raw: res,
  };
}

export async function pauseCampaign(campaignId: string) {
  await call("POST", `/campaign/Pause?campaignId=${encodeURIComponent(campaignId)}`);
}

export async function resumeCampaign(campaignId: string) {
  await call("POST", `/campaign/Resume?campaignId=${encodeURIComponent(campaignId)}`);
}

export type HrMessage = { direction: "in" | "out"; text: string; at: string | null };

export function readMessages(raw: unknown): HrMessage[] {
  const list = isObj(raw) ? [raw.messages, raw.chatroomMessages, raw.items].find(Array.isArray) : Array.isArray(raw) ? raw : null;
  return ((list as unknown[]) ?? []).filter(isObj).map((m) => {
    const sender = (pickStr(m, ["sender", "senderType", "direction"]) ?? "").toUpperCase();
    const outgoing = m.isOutgoing === true || m.fromMe === true || sender === "ME" || sender === "OUTGOING" || sender === "OUTBOUND";
    return {
      direction: outgoing ? "out" : "in",
      text: pickStr(m, ["body", "message", "text", "content"]) ?? "",
      at: pickStr(m, ["createdAt", "created_at", "sentAt", "timestamp"]),
    } satisfies HrMessage;
  }).filter((m) => m.text);
}

export type HrConversation = {
  id: string;
  accountId: string;
  campaignId: string | null;
  leadName: string | null;
  leadProfileUrl: string | null;
  messages: HrMessage[];
};

export function readConversation(c: Obj): HrConversation {
  const lead = [c.correspondentProfile, c.leadProfile, c.lead, c.correspondent].find(isObj);
  return {
    id: pickStr(c, ["id", "conversationId"]) ?? "",
    accountId: pickStr(c, ["linkedInAccountId", "accountId"]) ?? pickStr(c.linkedInAccount, ["id"]) ?? "",
    campaignId: pickStr(c, ["campaignId"]),
    leadName: [pickStr(lead, ["firstName"]), pickStr(lead, ["lastName"])].filter(Boolean).join(" ") || pickStr(lead, ["name", "fullName"]),
    leadProfileUrl: pickStr(lead, ["profileUrl", "linkedInUrl", "url"]),
    messages: readMessages(c),
  };
}

/** Unseen conversations, used as a polling fallback when webhooks are not set up. */
export async function listUnseenConversations(): Promise<HrConversation[]> {
  return (await paged("/inbox/GetConversationsV2", { filters: { seen: false } })).map(readConversation).filter((c) => c.id);
}

export async function getChatroom(accountId: string, conversationId: string): Promise<HrMessage[]> {
  const raw = await call<unknown>("GET", `/inbox/GetChatroom/${encodeURIComponent(accountId)}/${encodeURIComponent(conversationId)}`);
  return readMessages(raw);
}

export async function sendMessage(conversationId: string, linkedInAccountId: string, message: string) {
  await call("POST", "/inbox/SendMessage", { message, conversationId, linkedInAccountId: Number(linkedInAccountId) });
}

export async function getOverallStats(opts: { startDate: string; endDate: string; campaignIds?: string[]; accountIds?: string[] }) {
  return call<unknown>("POST", "/stats/GetOverallStats", {
    startDate: opts.startDate,
    endDate: opts.endDate,
    accountIds: (opts.accountIds ?? []).map(Number),
    campaignIds: (opts.campaignIds ?? []).map(Number),
  });
}
