/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const ALIASES: Record<string, string[]> = {
  profileUrl: ["profileurl", "linkedinurl", "linkedin", "url", "linkedinprofile", "profile"],
  firstName: ["firstname", "first"],
  lastName: ["lastname", "last"],
  company: ["company", "companyname", "organization"],
  position: ["position", "title", "jobtitle", "headline"],
  profileText: ["profiletext", "about", "summary", "notes", "bio", "recentpost"],
};

export type LeadRow = { profileUrl: string; firstName: string; lastName: string; company: string; position: string; profileText: string };

export function toLeadRows(records: Record<string, string>[]): { rows: LeadRow[]; skipped: number } {
  const col = (r: Record<string, string>, key: string) => ALIASES[key].map((a) => r[a]).find((v) => v) ?? "";
  const rows: LeadRow[] = [];
  let skipped = 0;
  for (const r of records) {
    const url = col(r, "profileUrl");
    if (!/^https?:\/\/([a-z]+\.)?linkedin\.com\/(in|sales\/lead|sales\/people)\//i.test(url)) {
      skipped++;
      continue;
    }
    rows.push({
      profileUrl: url.split("?")[0].replace(/\/$/, ""),
      firstName: col(r, "firstName"),
      lastName: col(r, "lastName"),
      company: col(r, "company"),
      position: col(r, "position"),
      profileText: col(r, "profileText").slice(0, 4_000),
    });
  }
  return { rows, skipped };
}
