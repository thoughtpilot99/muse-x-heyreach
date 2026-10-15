import { all, run } from "./db";

export type Settings = {
  agencyName: string;
  tone: string;
  // Safety governor: connection requests (= leads pushed) per LinkedIn account.
  dailyCap: number;
  weeklyCap: number;
  rampDays: number; // new accounts start lower and reach dailyCap after this many days
  rampStartCap: number;
  minAcceptanceWarn: number; // % acceptance below which an account is slowed
  minAcceptancePause: number; // % acceptance below which campaigns are paused
  minSampleForRates: number; // requests needed before acceptance rate is trusted
  maxSimilarity: number; // 0-1, max word-overlap between two messages in a campaign
};

export const DEFAULT_SETTINGS: Settings = {
  agencyName: "",
  tone: "Short, specific, human. No pitch in the connection note. No emojis.",
  dailyCap: 25,
  weeklyCap: 100,
  rampDays: 14,
  rampStartCap: 8,
  minAcceptanceWarn: 20,
  minAcceptancePause: 10,
  minSampleForRates: 25,
  maxSimilarity: 0.6,
};

export function getSettings(): Settings {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (!(key in s)) continue;
    const def = DEFAULT_SETTINGS[key as keyof Settings];
    (s as Record<string, unknown>)[key] = typeof def === "number" ? Number(value) : value;
  }
  return s;
}

export function saveSettings(patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
    run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key, String(value),
    );
  }
}
