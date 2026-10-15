import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { config } from "@/lib/config";
import { get } from "@/lib/db";
import { getSecret, mask, secretSource, type SecretName } from "@/lib/secrets";
import { NOTE_FIELD, MESSAGE_FIELD } from "@/lib/outreach";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import { generateTokenAction, saveKeyAction, setLiveAction, syncAction, testHeyReachAction, testMuseAction } from "./actions";

function KeyField({ name, label, help }: { name: SecretName; label: string; help: ReactNode }) {
  const source = secretSource(name);
  const current = process.env[name] || getSecret(name);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className={source === "none" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
          {source === "none" ? "not connected" : `connected ${mask(current)}${source === "env" ? " (from .env.local)" : ""}`}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">{help}</p>
      {source !== "env" && (
        <ActionForm action={saveKeyAction} submit={[{ label: source === "app" ? "Replace" : "Save", tone: "neutral" }]}>
          <input type="hidden" name="name" value={name} />
          <input name="value" type="password" autoComplete="off" placeholder={source === "app" ? "Paste a new key, or leave empty to remove" : "Paste key"} className={`${inputClass} mt-2`} />
        </ActionForm>
      )}
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <Card title={`${n}. ${title}`} actions={<span className={done ? "text-emerald-600 dark:text-emerald-400 text-sm" : "text-muted text-sm"}>{done ? "✓ done" : "to do"}</span>}>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export default async function SetupPage() {
  await connection();
  const n = (sql: string) => get<{ n: number }>(sql)?.n ?? 0;
  const accounts = n("SELECT COUNT(*) AS n FROM senders");
  const campaigns = n("SELECT COUNT(*) AS n FROM campaigns");
  const token = config.webhookToken();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Setup</h1>
        <p className="text-sm text-muted">
          Connect your own accounts. Keys are stored only on this computer (in <code>data/app.db</code>, never committed). Values in{" "}
          <code>.env.local</code> take precedence.
        </p>
      </div>

      <Step n={1} title="Muse Wonder (the AI)" done={!!config.museApiKey()}>
        <KeyField name="MODEL_API_KEY" label="Meta Model API key"
          help={<>Create one at <a className="underline" href="https://dev.meta.ai" target="_blank" rel="noreferrer">dev.meta.ai</a> → API keys. Model: <code>{config.museModel()}</code>.</>} />
        {config.museApiKey() && <ActionForm action={testMuseAction} submit={[{ label: "Test Muse Wonder", tone: "neutral" }]} />}
      </Step>

      <Step n={2} title="HeyReach (LinkedIn accounts and campaigns)" done={!!config.heyreachApiKey() && accounts > 0}>
        <KeyField name="HEYREACH_API_KEY" label="HeyReach API key" help="HeyReach → Settings → Integrations → API." />
        {config.heyreachApiKey() && (
          <div className="flex flex-wrap gap-2">
            <ActionForm action={testHeyReachAction} submit={[{ label: "Test HeyReach", tone: "neutral" }]} />
            <ActionForm action={syncAction} submit={[{ label: "Sync accounts and campaigns" }]} />
          </div>
        )}
        <p className="text-sm text-muted">{accounts} LinkedIn account(s) and {campaigns} campaign(s) synced.</p>
        <div className="rounded-md bg-subtle p-3 text-sm">
          <p className="font-medium">One-time setup inside HeyReach</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>In each campaign ReachGuard feeds, use <code>{`{${NOTE_FIELD}}`}</code> as the connection-request note and <code>{`{${MESSAGE_FIELD}}`}</code> as the first message after acceptance.</li>
            <li>Start the campaign (HeyReach only accepts new leads into active campaigns).</li>
            <li>Keep HeyReach&apos;s own per-account limits at or below ReachGuard&apos;s caps (Settings).</li>
          </ol>
        </div>
      </Step>

      <Step n={3} title="Clients" done={n("SELECT COUNT(*) AS n FROM senders WHERE client_id IS NOT NULL") > 0}>
        <p className="text-sm">
          Create a client and assign its LinkedIn accounts and campaigns on the <Link className="underline" href="/clients">Clients</Link> page.
        </p>
      </Step>

      <Step n={4} title="Webhooks (recommended)" done={!!token}>
        <p className="text-sm text-muted">
          Webhooks give ReachGuard acceptance rates (for account safety) and instant reply drafting. Without them, replies are still
          picked up every 10 minutes by polling.
        </p>
        {token ? (
          <div className="space-y-2 text-sm">
            <p>Register this URL in HeyReach → Settings → Integrations → Webhooks for <em>Connection request sent</em>, <em>Connection request accepted</em> and <em>Message reply received</em>:</p>
            <code className="block overflow-x-auto rounded-md bg-subtle p-2 text-xs">https://&lt;your-tunnel&gt;/api/webhooks/heyreach?token={token}</code>
            <p className="text-xs text-muted">Expose the app with <code>cloudflared tunnel --url http://localhost:3000</code>, and set <code>APP_PASSWORD</code> in .env.local first so only the webhook is public.</p>
          </div>
        ) : null}
        <ActionForm action={generateTokenAction} submit={[{ label: token ? "Generate a new token" : "Generate webhook token", tone: "neutral" }]} />
      </Step>

      <Step n={5} title="Go live" done={config.liveEnabled()}>
        <p className="text-sm">
          While live mode is off, ReachGuard drafts outreach, checks account health and drafts replies — but adds nothing to HeyReach and sends no
          LinkedIn message. Turn it on when your drafts look right.
        </p>
        {config.liveEnabled() ? (
          <ActionForm action={setLiveAction} submit={[{ label: "Turn live mode off", intent: "off", tone: "danger" }]} />
        ) : config.liveForcedOff() ? (
          <p className="text-sm text-muted"><code>RG_LIVE_ENABLED=0</code> in .env.local keeps live mode off.</p>
        ) : (
          <ActionForm action={setLiveAction} submit={[{ label: "Turn live mode on", intent: "on", tone: "danger" }]}>
            <input name="confirm" placeholder="Type LIVE to confirm" className={`${inputClass} max-w-xs`} />
          </ActionForm>
        )}
      </Step>
    </div>
  );
}
