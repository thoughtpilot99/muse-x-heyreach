import OpenAI from "openai";
import { z } from "zod";
import { config, MUSE_PRICE } from "./config";
import { run } from "./db";

// Meta's Model API is OpenAI-SDK compatible: same client, different base URL.
// Rebuilt when the key changes (keys can be updated on /setup without a restart).
let client: { key: string; api: OpenAI } | null = null;
function museClient() {
  const key = config.museApiKey();
  if (!client || client.key !== key) {
    client = { key, api: new OpenAI({ apiKey: key, baseURL: config.museBaseUrl() }) };
  }
  return client.api;
}

/** Strict structured outputs need every property required and no extra keys. */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "object" && n.properties && typeof n.properties === "object") {
      n.required = Object.keys(n.properties);
      n.additionalProperties = false;
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visit);
      else visit(v);
    }
  };
  visit(json);
  return json;
}

/** Pull a JSON object out of a reply, tolerating code fences or leading prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Muse Wonder did not return JSON");
  }
}

export function costUsd(usage: { prompt_tokens?: number; completion_tokens?: number; cached?: number }) {
  const cached = usage.cached ?? 0;
  const input = (usage.prompt_tokens ?? 0) - cached;
  return (
    (input * MUSE_PRICE.input + cached * MUSE_PRICE.cachedInput + (usage.completion_tokens ?? 0) * MUSE_PRICE.output) /
    1_000_000
  );
}

export async function runStructured<T>(opts: {
  step: string;
  leadId?: number;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
}): Promise<T> {
  try {
    const res = await museClient().chat.completions.create({
      model: config.museModel(),
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.schemaName, schema: toStrictJsonSchema(opts.schema), strict: true },
      },
    });
    const usage = res.usage;
    const parsed = opts.schema.parse(extractJson(res.choices[0]?.message?.content ?? ""));
    run(
      "INSERT INTO ai_runs (step, lead_id, input_tokens, output_tokens, cost_usd, ok) VALUES (?, ?, ?, ?, ?, 1)",
      opts.step,
      opts.leadId ?? null,
      usage?.prompt_tokens ?? 0,
      usage?.completion_tokens ?? 0,
      costUsd({
        prompt_tokens: usage?.prompt_tokens,
        completion_tokens: usage?.completion_tokens,
        cached: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      }),
    );
    return parsed;
  } catch (err) {
    run(
      "INSERT INTO ai_runs (step, lead_id, ok, error) VALUES (?, ?, 0, ?)",
      opts.step, opts.leadId ?? null, err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

/** Cheapest possible call to confirm the key and model work. */
export async function pingMuse() {
  const res = await museClient().chat.completions.create({
    model: config.museModel(),
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
    max_completion_tokens: 5,
  });
  return res.model;
}
