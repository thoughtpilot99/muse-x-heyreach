import { getSecret, type SecretName } from "./secrets";

// Each value comes from .env.local first, then from what was entered on /setup.
const val = (name: SecretName) => process.env[name] || getSecret(name) || "";

export const config = {
  museApiKey: () => val("MODEL_API_KEY"),
  museBaseUrl: () => process.env.MUSE_BASE_URL || "https://api.meta.ai/v1",
  museModel: () => process.env.MUSE_MODEL || "muse-wonder-1.0",
  heyreachApiKey: () => val("HEYREACH_API_KEY"),
  webhookToken: () => val("HEYREACH_WEBHOOK_TOKEN"),
  jobsEnabled: () => process.env.RG_JOBS_ENABLED !== "0",
  // Live mode lets ReachGuard push leads into HeyReach and send replies. Off by default;
  // RG_LIVE_ENABLED=0 in the environment always forces it off.
  liveEnabled: () => {
    const env = process.env.RG_LIVE_ENABLED;
    if (env === "0") return false;
    return env === "1" || getSecret("RG_LIVE_ENABLED") === "1";
  },
  liveForcedOff: () => process.env.RG_LIVE_ENABLED === "0",
};

// Muse Wonder list price, USD per million tokens (dev.meta.ai, Oct 2026).
export const MUSE_PRICE = { input: 4, cachedInput: 0.2, output: 20 };

const REQUIRED: { key: string; label: string; get: () => string }[] = [
  { key: "MODEL_API_KEY", label: "Muse Wonder (Meta Model API)", get: config.museApiKey },
  { key: "HEYREACH_API_KEY", label: "HeyReach API", get: config.heyreachApiKey },
];

export function missingKeys() {
  return REQUIRED.filter((r) => !r.get()).map(({ key, label }) => ({ key, label }));
}

export class MissingKeysError extends Error {
  constructor(public missing: { key: string; label: string }[]) {
    super(`Missing configuration: ${missing.map((m) => m.key).join(", ")}`);
  }
}

export function assertConfigured() {
  const missing = missingKeys();
  if (missing.length) throw new MissingKeysError(missing);
}

/** Anything that changes HeyReach (adding leads, sending messages) requires live mode. */
export function assertLive() {
  assertConfigured();
  if (!config.liveEnabled()) throw new MissingKeysError([{ key: "RG_LIVE_ENABLED", label: "Live mode (turn it on in Setup)" }]);
}
