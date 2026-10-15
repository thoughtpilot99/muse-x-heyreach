import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type Client = {
  id: number;
  name: string;
  notes: string;
  require_approval: number; // 1 = drafted messages need approval before pushing to HeyReach
  auto_send: string; // JSON array of reply categories that may be sent without approval
  created_at: string;
};

export type Sender = {
  id: string; // HeyReach LinkedIn account id
  client_id: number | null;
  name: string;
  first_seen: string;
  status: "ok" | "warn" | "paused";
  status_reason: string | null;
  status_changed_at: string | null;
};

export type Campaign = {
  id: string; // HeyReach campaign id
  client_id: number | null;
  name: string;
  status: string;
  paused_by_guard: number;
};

export type LeadStatus = "new" | "drafted" | "approved" | "pushed" | "failed";

export type Lead = {
  id: number;
  client_id: number;
  campaign_id: string;
  sender_id: string | null;
  profile_url: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  position: string | null;
  profile_text: string | null;
  connection_note: string | null;
  first_message: string | null;
  basis: string | null;
  status: LeadStatus;
  error: string | null;
  pushed_at: string | null;
  created_at: string;
};

export type ConversationStatus = "awaiting_approval" | "sent" | "handed_off" | "closed" | "failed";

export type Conversation = {
  id: string; // HeyReach conversation id
  sender_id: string;
  campaign_id: string | null;
  client_id: number | null;
  lead_name: string | null;
  lead_profile_url: string | null;
  last_inbound: string | null;
  last_inbound_at: string | null;
  history: string | null; // JSON Message[]
  category: string | null;
  summary: string | null;
  suggested_reply: string | null;
  hand_off: number;
  status: ConversationStatus;
  error: string | null;
  updated_at: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  require_approval INTEGER NOT NULL DEFAULT 1,
  auto_send TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS senders (
  id TEXT PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  name TEXT NOT NULL,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'ok',
  status_reason TEXT,
  status_changed_at TEXT
);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  paused_by_guard INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  campaign_id TEXT NOT NULL,
  sender_id TEXT,
  profile_url TEXT NOT NULL,
  first_name TEXT, last_name TEXT, company TEXT, position TEXT, profile_text TEXT,
  connection_note TEXT, first_message TEXT, basis TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  error TEXT,
  pushed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, profile_url)
);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  campaign_id TEXT,
  client_id INTEGER,
  lead_name TEXT, lead_profile_url TEXT,
  last_inbound TEXT, last_inbound_at TEXT,
  history TEXT,
  category TEXT, summary TEXT, suggested_reply TEXT,
  hand_off INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'awaiting_approval',
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS health_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS health_sender ON health_events(sender_id, created_at);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  markdown TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  ok INTEGER NOT NULL,
  note TEXT,
  headers TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step TEXT NOT NULL,
  lead_id INTEGER,
  input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const g = globalThis as unknown as { __rgDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!g.__rgDb) {
    const file = process.env.RG_DB_PATH ?? path.join(process.cwd(), "data", "app.db");
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const d = new DatabaseSync(file);
    d.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    d.exec(SCHEMA);
    g.__rgDb = d;
  }
  return g.__rgDb;
}

type Param = string | number | null;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
  return db().prepare(sql).run(...params);
}

/** UPDATE helper restricted to an allow-list of columns. */
export function update(table: "leads" | "conversations" | "senders" | "campaigns" | "clients", id: Param, fields: Record<string, Param>, allowed: string[]) {
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  const extra = table === "conversations" ? ", updated_at = datetime('now')" : "";
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")}${extra} WHERE id = ?`, ...keys.map((k) => fields[k]), id);
}

export function logEvent(e: { source: string; kind: string; ok: boolean; note?: string; headers?: Record<string, string>; payload?: string }) {
  run(
    "INSERT INTO events (source, kind, ok, note, headers, payload) VALUES (?, ?, ?, ?, ?, ?)",
    e.source, e.kind, e.ok ? 1 : 0, e.note ?? null, e.headers ? JSON.stringify(e.headers) : null, e.payload ?? null,
  );
}
