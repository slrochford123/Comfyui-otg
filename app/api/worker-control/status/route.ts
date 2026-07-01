import { jsonOk } from "@/lib/http/routeHelpers";
import { getWorkerCatalog } from "@/lib/workers/workerCatalog";
import { listResourceLocks } from "@/lib/workers/resourceLocks";
import { listRecentLifecycleCommands } from "@/lib/workers/workerLifecycleStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return jsonOk({
    enabled: String(process.env.OTG_WORKER_CONTROL_ENABLED || "").trim() === "1",
    dryRunOnly: true,
    catalog: getWorkerCatalog(),
    commands: listRecentLifecycleCommands(50),
    locks: listResourceLocks(),
  });
}
