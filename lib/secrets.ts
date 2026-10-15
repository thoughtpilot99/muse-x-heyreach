import { get, run } from "./db";

// Keys and connection choices entered on the /setup page. They live only in the
// local, gitignored SQLite file (data/app.db). Values in .env.local take precedence.
export const SECRET_NAMES = [
  "MODEL_API_KEY",
  "HEYREACH_API_KEY",
  "HEYREACH_WEBHOOK_TOKEN",
  "RG_LIVE_ENABLED",
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

export const isSecretName = (n: string): n is SecretName => (SECRET_NAMES as readonly string[]).includes(n);

export function getSecret(name: SecretName): string {
  return get<{ value: string }>("SELECT value FROM secrets WHERE name = ?", name)?.value ?? "";
}

export function setSecret(name: SecretName, value: string) {
  const v = value.trim();
  if (!v) return clearSecret(name);
  run(
    `INSERT INTO secrets (name, value) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    name, v,
  );
}

export function clearSecret(name: SecretName) {
  run("DELETE FROM secrets WHERE name = ?", name);
}

/** Where a value comes from, for the setup page. */
export function secretSource(name: SecretName): "env" | "app" | "none" {
  if (process.env[name]) return "env";
  return getSecret(name) ? "app" : "none";
}

/** Show only enough of a key to recognise it. */
export function mask(value: string): string {
  if (!value) return "";
  return value.length <= 8 ? "â€¢â€¢â€¢â€¢" : `â€¢â€¢â€¢â€¢${value.slice(-4)}`;
}
