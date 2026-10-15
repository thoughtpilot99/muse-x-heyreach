"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { config } from "@/lib/config";
import { isSecretName, setSecret } from "@/lib/secrets";
import { pingMuse } from "@/lib/muse";
import { checkApiKey } from "@/lib/heyreach";
import { syncFromHeyReach } from "@/lib/outreach";
import type { ActionResult } from "../actions";

async function attempt(fn: () => Promise<string> | string): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveKeyAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    const name = str(fd, "name");
    if (!isSecretName(name) || name === "RG_LIVE_ENABLED") throw new Error("Unknown setting");
    if (process.env[name]) throw new Error(`${name} is set in .env.local, which takes precedence. Change it there.`);
    const value = str(fd, "value");
    if (value.length > 500 || /\s/.test(value)) throw new Error("That doesn't look like a key (no spaces, max 500 characters)");
    setSecret(name, value);
    return value ? "Saved." : "Cleared.";
  });
}

export async function testMuseAction(): Promise<ActionResult> {
  return attempt(async () => `Connected to ${await pingMuse()}.`);
}

export async function testHeyReachAction(): Promise<ActionResult> {
  return attempt(async () => {
    await checkApiKey();
    return "HeyReach key is valid.";
  });
}

export async function syncAction(): Promise<ActionResult> {
  return attempt(async () => {
    const r = await syncFromHeyReach();
    return `Synced ${r.accounts} LinkedIn account(s) and ${r.campaigns} campaign(s).`;
  });
}

export async function generateTokenAction(): Promise<ActionResult> {
  return attempt(() => {
    if (process.env.HEYREACH_WEBHOOK_TOKEN) throw new Error("HEYREACH_WEBHOOK_TOKEN is set in .env.local; change it there.");
    setSecret("HEYREACH_WEBHOOK_TOKEN", crypto.randomBytes(24).toString("base64url"));
    return "New webhook token created. Update the URL in HeyReach if you had one before.";
  });
}

export async function setLiveAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    if (fd.get("intent") === "off") {
      setSecret("RG_LIVE_ENABLED", "0");
      return "Live mode is off.";
    }
    if (config.liveForcedOff()) throw new Error("RG_LIVE_ENABLED=0 in .env.local forces live mode off. Remove it first.");
    if (str(fd, "confirm") !== "LIVE") throw new Error("Type LIVE to confirm");
    setSecret("RG_LIVE_ENABLED", "1");
    return "Live mode is ON. Approved leads will be added to HeyReach and approved replies sent.";
  });
}
