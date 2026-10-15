import { get, logEvent, run, update, type Client, type Conversation } from "./db";
import { assertConfigured, assertLive, config } from "./config";
import { getSettings } from "./settings";
import { triageConversation } from "./agents";
import { getChatroom, listUnseenConversations, pickStr, sendMessage, type HrMessage } from "./heyreach";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const CONV_FIELDS = ["history", "category", "summary", "suggested_reply", "hand_off", "status", "error", "last_inbound", "last_inbound_at", "client_id", "campaign_id", "lead_name", "lead_profile_url"];

// ---------- webhook events ----------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

export type WebhookEvent = {
  type: string;
  senderId: string | null;
  campaignId: string | null;
  conversationId: string | null;
  leadName: string | null;
  leadProfileUrl: string | null;
  message: string | null;
};

/** HeyReach webhook bodies are not formally documented; read the common field spellings. */
export function readWebhook(body: unknown): WebhookEvent {
  const b = isObj(body) ? body : {};
  const sender = [b.sender, b.linkedInAccount, b.linkedin_account, b.account].find(isObj);
  const lead = [b.lead, b.correspondent, b.prospect].find(isObj);
  const campaign = [b.campaign].find(isObj);
  const recent = Array.isArray(b.recent_messages) ? b.recent_messages.filter(isObj) : Array.isArray(b.recentMessages) ? b.recentMessages.filter(isObj) : [];
  const lastRecent = recent.at(-1);
  return {
    type: (pickStr(b, ["event_type", "eventType", "type", "event"]) ?? "UNKNOWN").toUpperCase(),
    senderId: pickStr(sender, ["id", "linkedInAccountId"]) ?? pickStr(b, ["linkedInAccountId", "linkedin_account_id", "sender_id", "accountId"]),
    campaignId: pickStr(campaign, ["id"]) ?? pickStr(b, ["campaignId", "campaign_id"]),
    conversationId: pickStr(b, ["conversation_id", "conversationId", "chatroom_id", "chatroomId"]),
    leadName:
      [pickStr(lead, ["first_name", "firstName"]), pickStr(lead, ["last_name", "lastName"])].filter(Boolean).join(" ") ||
      pickStr(lead, ["full_name", "fullName", "name"]),
    leadProfileUrl: pickStr(lead, ["profile_url", "profileUrl", "linkedin_url", "linkedInUrl"]),
    message: pickStr(b, ["message", "message_text", "messageText", "text"]) ?? pickStr(lastRecent, ["message", "body", "text"]),
  };
}

const HEALTH_KINDS = new Set(["CONNECTION_REQUEST_SENT", "CONNECTION_REQUEST_ACCEPTED", "MESSAGE_SENT", "MESSAGE_REPLY_RECEIVED", "INMAIL_SENT", "INMAIL_REPLY_RECEIVED"]);
const REPLY_KINDS = new Set(["MESSAGE_REPLY_RECEIVED", "EVERY_MESSAGE_REPLY_RECEIVED", "INMAIL_REPLY_RECEIVED"]);

export async function handleWebhook(e: WebhookEvent) {
  if (e.senderId && HEALTH_KINDS.has(e.type)) {
    run("INSERT INTO health_events (sender_id, kind) VALUES (?, ?)", e.senderId, e.type);
  }
  if (REPLY_KINDS.has(e.type) && e.conversationId && e.senderId) {
    await processInbound({
      conversationId: e.conversationId,
      senderId: e.senderId,
      campaignId: e.campaignId,
      leadName: e.leadName,
      leadProfileUrl: e.leadProfileUrl,
      fallback: e.message ? [{ direction: "in", text: e.message, at: new Date().toISOString() }] : [],
    });
  }
}

// ---------- reply agent -------------------------------------------------

function clientFor(campaignId: string | null, senderId: string): Client | null {
  const viaCampaign = campaignId
    ? get<Client>("SELECT c.* FROM clients c JOIN campaigns k ON k.client_id = c.id WHERE k.id = ?", campaignId)
    : undefined;
  return viaCampaign ?? get<Client>("SELECT c.* FROM clients c JOIN senders s ON s.client_id = c.id WHERE s.id = ?", senderId) ?? null;
}

export async function processInbound(input: {
  conversationId: string;
  senderId: string;
  campaignId: string | null;
  leadName: string | null;
  leadProfileUrl: string | null;
  fallback: HrMessage[];
}) {
  assertConfigured();
  let history: HrMessage[] = input.fallback;
  try {
    const full = await getChatroom(input.senderId, input.conversationId);
    if (full.length) history = full;
  } catch (e) {
    logEvent({ source: "heyreach", kind: "chatroom_fetch_failed", ok: false, note: errMsg(e) });
  }
  const lastIn = [...history].reverse().find((m) => m.direction === "in");
  if (!lastIn) return null;

  const existing = get<Conversation>("SELECT * FROM conversations WHERE id = ?", input.conversationId);
  // Already handled this exact inbound message.
  if (existing && existing.last_inbound === lastIn.text && existing.status !== "failed") return existing;

  const client = clientFor(input.campaignId, input.senderId);
  run(
    `INSERT INTO conversations (id, sender_id, status) VALUES (?, ?, 'awaiting_approval')
     ON CONFLICT(id) DO NOTHING`,
    input.conversationId, input.senderId,
  );
  update("conversations", input.conversationId, {
    client_id: client?.id ?? null,
    campaign_id: input.campaignId ?? existing?.campaign_id ?? null,
    lead_name: input.leadName ?? existing?.lead_name ?? null,
    lead_profile_url: input.leadProfileUrl ?? existing?.lead_profile_url ?? null,
    history: JSON.stringify(history),
    last_inbound: lastIn.text,
    last_inbound_at: lastIn.at ?? new Date().toISOString(),
  }, CONV_FIELDS);

  try {
    const t = await triageConversation({ history, leadName: input.leadName ?? existing?.lead_name ?? null, client, s: getSettings() });
    update("conversations", input.conversationId, {
      category: t.category, summary: t.summary, suggested_reply: t.suggested_reply,
      hand_off: t.hand_off ? 1 : 0, status: "awaiting_approval", error: null,
    }, CONV_FIELDS);
    const autoSend: string[] = client ? JSON.parse(client.auto_send || "[]") : [];
    if (!t.hand_off && autoSend.includes(t.category) && config.liveEnabled()) {
      await sendReply(input.conversationId, t.suggested_reply);
    }
  } catch (e) {
    update("conversations", input.conversationId, { status: "failed", error: errMsg(e) }, CONV_FIELDS);
  }
  return get<Conversation>("SELECT * FROM conversations WHERE id = ?", input.conversationId);
}

/** Polling fallback for when HeyReach webhooks are not configured. */
export async function pollInbox(): Promise<number> {
  assertConfigured();
  const convs = await listUnseenConversations();
  let handled = 0;
  for (const c of convs) {
    const lastIn = [...c.messages].reverse().find((m) => m.direction === "in");
    const existing = get<Conversation>("SELECT last_inbound FROM conversations WHERE id = ?", c.id);
    if (!lastIn || existing?.last_inbound === lastIn.text || !c.accountId) continue;
    await processInbound({
      conversationId: c.id, senderId: c.accountId, campaignId: c.campaignId,
      leadName: c.leadName, leadProfileUrl: c.leadProfileUrl, fallback: c.messages,
    });
    handled++;
  }
  return handled;
}

export async function sendReply(conversationId: string, text: string) {
  // Hard stop: no LinkedIn message is sent unless live mode is on.
  assertLive();
  const conv = get<Conversation>("SELECT * FROM conversations WHERE id = ?", conversationId);
  if (!conv) throw new Error("Conversation not found");
  const message = text.trim();
  if (!message) throw new Error("Message is empty");
  await sendMessage(conversationId, conv.sender_id, message);
  const history: HrMessage[] = conv.history ? JSON.parse(conv.history) : [];
  history.push({ direction: "out", text: message, at: new Date().toISOString() });
  update("conversations", conversationId, {
    history: JSON.stringify(history), suggested_reply: message,
    status: conv.hand_off ? "handed_off" : "sent", error: null,
  }, CONV_FIELDS);
}

export function closeConversation(conversationId: string) {
  update("conversations", conversationId, { status: "closed" }, CONV_FIELDS);
}
