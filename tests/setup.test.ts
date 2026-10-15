import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/heyreach", async (orig) => ({
  ...(await orig<typeof import("@/lib/heyreach")>()),
  addLeadsToCampaign: vi.fn(),
  sendMessage: vi.fn(),
}));

import { addLeadsToCampaign, sendMessage } from "@/lib/heyreach";
import { db, run } from "@/lib/db";
import { config } from "@/lib/config";
import { getSecret, setSecret, secretSource } from "@/lib/secrets";
import { pushApproved } from "@/lib/outreach";
import { sendReply } from "@/lib/inbox";

beforeEach(() => {
  vi.clearAllMocks();
  db().exec("DELETE FROM secrets; DELETE FROM conversations; DELETE FROM leads;");
});
afterEach(() => vi.unstubAllEnvs());

describe("keys entered in the app", () => {
  it("are used when .env.local has none, and env wins otherwise", () => {
    vi.stubEnv("HEYREACH_API_KEY", "");
    setSecret("HEYREACH_API_KEY", "app-key");
    expect(config.heyreachApiKey()).toBe("app-key");
    expect(secretSource("HEYREACH_API_KEY")).toBe("app");
    vi.stubEnv("HEYREACH_API_KEY", "env-key");
    expect(config.heyreachApiKey()).toBe("env-key");
    setSecret("HEYREACH_API_KEY", "");
    expect(getSecret("HEYREACH_API_KEY")).toBe("");
  });
});

describe("live mode", () => {
  it("is off by default: nothing is pushed and no message is sent", async () => {
    vi.stubEnv("RG_LIVE_ENABLED", "");
    expect(config.liveEnabled()).toBe(false);
    await expect(pushApproved()).rejects.toThrow(/RG_LIVE_ENABLED/);
    run("INSERT INTO conversations (id, sender_id) VALUES ('c1', '1')");
    await expect(sendReply("c1", "hello")).rejects.toThrow(/RG_LIVE_ENABLED/);
    expect(addLeadsToCampaign).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("turns on from the app and can be forced off by the environment", async () => {
    vi.stubEnv("RG_LIVE_ENABLED", "");
    setSecret("RG_LIVE_ENABLED", "1");
    expect(config.liveEnabled()).toBe(true);
    run("INSERT INTO conversations (id, sender_id) VALUES ('c2', '7')");
    await sendReply("c2", "hello");
    expect(sendMessage).toHaveBeenCalledWith("c2", "7", "hello");

    vi.stubEnv("RG_LIVE_ENABLED", "0");
    expect(config.liveEnabled()).toBe(false);
    expect(config.liveForcedOff()).toBe(true);
  });
});
