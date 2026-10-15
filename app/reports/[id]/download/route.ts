import { get } from "@/lib/db";

export async function GET(_req: Request, ctx: RouteContext<"/reports/[id]/download">) {
  const { id } = await ctx.params;
  const r = get<{ markdown: string; client_name: string; period_end: string }>(
    "SELECT r.markdown, c.name AS client_name, r.period_end FROM reports r JOIN clients c ON c.id = r.client_id WHERE r.id = ?",
    Number(id),
  );
  if (!r) return new Response("Not found", { status: 404 });
  const name = `${r.client_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${r.period_end.slice(0, 10)}.md`;
  return new Response(r.markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
}
