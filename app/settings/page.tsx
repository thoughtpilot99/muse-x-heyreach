import Link from "next/link";
import { connection } from "next/server";
import { getSettings } from "@/lib/settings";
import { NOTE_FIELD, MESSAGE_FIELD } from "@/lib/outreach";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import { saveSettingsAction, testConnectionsAction } from "../actions";

export default async function SettingsPage() {
  await connection();
  const s = getSettings();
  const field = (name: keyof typeof s, label: string, type = "text", hint?: string) => (
    <label className="block text-sm">
      <span className="text-xs text-muted">{label}</span>
      <input name={name} type={type} step={type === "number" ? "any" : undefined} defaultValue={String(s[name])} className={`${inputClass} mt-1`} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card title="Connections">
        <p className="text-sm text-muted">
          Keys, webhook token and live mode are on the <Link href="/setup" className="underline">Setup</Link> page.
        </p>
        <ActionForm action={testConnectionsAction} submit={[{ label: "Test all connections", tone: "neutral" }]} />
      </Card>

      <ActionForm action={saveSettingsAction} submit={[{ label: "Save settings" }]} className="space-y-4">
        <Card title="Writing">
          <div className="grid gap-3 md:grid-cols-2">
            {field("agencyName", "Agency name (used in client reports)")}
            {field("tone", "Writing tone")}
            {field("maxSimilarity", "Max wording overlap between messages (0–1)", "number", "Lower = more varied copy. 0.6 is a good default.")}
          </div>
          <p className="mt-3 text-xs text-muted">
            In the HeyReach campaign, use the custom fields <code>{NOTE_FIELD}</code> (connection note) and <code>{MESSAGE_FIELD}</code> (first message) as the step text.
          </p>
        </Card>

        <Card title="Safety governor (per LinkedIn account)">
          <div className="grid gap-3 md:grid-cols-3">
            {field("dailyCap", "Daily cap (≤ 40)", "number")}
            {field("weeklyCap", "Weekly cap (≤ 150)", "number")}
            {field("rampStartCap", "New account starts at", "number")}
            {field("rampDays", "Ramp-up length (days)", "number")}
            {field("minAcceptanceWarn", "Slow down below acceptance %", "number")}
            {field("minAcceptancePause", "Pause below acceptance %", "number")}
            {field("minSampleForRates", "Requests needed before judging", "number")}
          </div>
        </Card>
      </ActionForm>
    </div>
  );
}
