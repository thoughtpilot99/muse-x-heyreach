import { afterEach, describe, expect, it, vi } from "vitest";
import { addLeadsToCampaign, HeyReachError, listCampaigns, pauseCampaign, sendMessage } from "@/lib/heyreach";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

describe("heyreach client", () => {
  it("sends X-API-KEY and the V2 accountLeadPairs body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ addedLeadsCount: 1, updatedLeadsCount: 0, failedLeadsCount: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await addLeadsToCampaign("10", [{ linkedInAccountId: "5", lead: { profileUrl: "u", firstName: "A" } }]);
    expect(r.added).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.heyreach.io/api/public/campaign/AddLeadsToCampaignV2");
    expect(init.headers["X-API-KEY"]).toBe("test-heyreach");
    expect(JSON.parse(init.body)).toEqual({ campaignId: 10, accountLeadPairs: [{ linkedInAccountId: 5, lead: { profileUrl: "u", firstName: "A" } }] });
  });

  it("pages through campaign lists", async () => {
    const page = (n: number, start: number) => Array.from({ length: n }, (_, i) => ({ id: start + i, name: `C${start + i}`, status: "IN_PROGRESS" }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ totalCount: 130, items: page(100, 0) }))
      .mockResolvedValueOnce(json({ totalCount: 130, items: page(30, 100) }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listCampaigns()).toHaveLength(130);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ offset: 100, limit: 100 });
  });

  it("passes campaignId as a query param for pause and numeric account id for messages", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await pauseCampaign("10");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.heyreach.io/api/public/campaign/Pause?campaignId=10");
    await sendMessage("conv", "5", "hi");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ message: "hi", conversationId: "conv", linkedInAccountId: 5 });
  });

  it("raises HeyReachError with the status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("Unauthorized", { status: 401 })));
    await expect(pauseCampaign("1")).rejects.toThrow(HeyReachError);
    await expect(pauseCampaign("1")).rejects.toThrow(/401/);
  });
});
