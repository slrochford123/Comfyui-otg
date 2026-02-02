export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    buildcheck: "WORKFLOWS_SCAN+INDICATOR+SELECTSTYLE",
    ts: new Date().toISOString(),
  }, { headers: { "cache-control": "no-store" } });
}
