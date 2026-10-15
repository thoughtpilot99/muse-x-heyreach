import crypto from "node:crypto";
import { after } from "next/server";
import { config, missingKeys } from "@/lib/config";
import { logEvent } from "@/lib/db";
import { handleWebhook, readWebhook } from "@/lib/inbox";

const MAX_BODY = 1_000_000;

function tokenOk(given: string | null, expected: string) {
  if (!given || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// HeyReach webhooks carry no signature, so the URL registered in HeyReach
// includes a secret token: /api/webhooks/heyreach?token=...
export async function POST(req: Request) {
  const expected = config.webhookToken();
  if (!expected) return Response.json({ error: "Set HEYREACH_WEBHOOK_TOKEN first" }, { status: 503 });
  if (!tokenOk(new URL(req.url).searchParams.get("token"), expected)) {
    logEvent({ source: "heyreach", kind: "webhook_rejected", ok: false, note: "bad or missing token" });
    return Response.json({ error: "Invalid token" }, { status: 401 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "Payload too large" }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    logEvent({ source: "heyreach", kind: "webhook_invalid_json", ok: false, payload: raw.slice(0, 20_000) });
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = readWebhook(body);
  logEvent({ source: "heyreach", kind: `webhook_${event.type}`, ok: true, payload: raw.slice(0, 50_000) });
  if (missingKeys().length) return Response.json({ received: true, processed: false });

  // Reply drafting calls Muse Wonder; answer HeyReach immediately and work afterwards.
  after(async () => {
    try {
      await handleWebhook(event);
    } catch (e) {
      logEvent({ source: "heyreach", kind: "webhook_processing_failed", ok: false, note: e instanceof Error ? e.message : String(e) });
    }
  });
  return Response.json({ received: true });
}
