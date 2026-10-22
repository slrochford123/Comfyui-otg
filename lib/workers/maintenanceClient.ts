import fs from "node:fs";
import { randomUUID } from "node:crypto";

export type MaintenanceTarget = "3090" | "5060ti";
export type MaintenanceAction = "status" | "reset_comfy" | "free_vram";
export class MaintenanceError extends Error {
  constructor(message: string, public readonly status = 503) { super(message); }
}
export function maintenanceTarget(value: unknown): MaintenanceTarget | null {
  return value === "3090" || value === "5060ti" ? value : null;
}
export function maintenanceConfiguration(target: MaintenanceTarget) {
  const environment = process.env.OTG_ENV;
  if (environment !== "test" && environment !== "prod") throw new MaintenanceError("Set OTG_ENV to test or prod before using maintenance.");
  const prefix = `OTG_MAINTENANCE_${environment.toUpperCase()}_${target.toUpperCase()}`;
  let endpoint: URL;
  try {
    endpoint = new URL(process.env[`${prefix}_URL`] || "");
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
        endpoint.search || endpoint.hash || endpoint.pathname !== "/maintenance") throw Error();
  } catch { throw new MaintenanceError(`Maintenance endpoint is not configured for ${target}.`); }
  let token = process.env[`${prefix}_TOKEN`] || "";
  const file = process.env[`${prefix}_TOKEN_FILE`];
  if (file) {
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077)) throw Error();
      token = fs.readFileSync(file, "utf8").trim();
    } catch { throw new MaintenanceError(`Maintenance credential is unavailable for ${target}.`); }
  }
  if (token.length < 32 || /[\r\n]/.test(token)) throw new MaintenanceError(`Maintenance credential is unavailable for ${target}.`);
  return { environment, endpoint: endpoint.href, token };
}
const stateValues = new Set(["active", "inactive", "failed", "activating", "deactivating", "not-installed", "not-applicable", "unknown"]);
const httpValues = new Set(["ready", "busy", "offline", "unmanaged", "unverified", "not-applicable"]);
function sanitizeStatus(value: any, target: MaintenanceTarget) {
  const expected = target === "3090" ? /\b3090\b/ : /\b5060\s*Ti\b/i;
  if (!value || typeof value.host !== "string" || value.host.length > 128 || !expected.test(String(value.gpu?.name))) throw new MaintenanceError("Maintenance worker identity did not match the selected GPU.");
  const service = (key: string) => {
    const s = value.services?.[key];
    if (!s || !stateValues.has(s.state) || !httpValues.has(s.http)) throw new MaintenanceError("Maintenance returned an invalid worker state.");
    return { state: String(s.state), http: String(s.http) };
  };
  const memory = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
  return { host: value.host, services: { comfy8188: service("comfy8188"), h38189: service("h38189") },
    gpu: { name: String(value.gpu.name).slice(0, 100), usedMiB: memory(value.gpu.usedMiB), totalMiB: memory(value.gpu.totalMiB) } };
}
export async function maintenanceOperation(target: MaintenanceTarget, action: MaintenanceAction) {
  if (!maintenanceTarget(target) || !["status", "reset_comfy", "free_vram"].includes(action)) throw new MaintenanceError("Invalid maintenance operation.", 400);
  if (process.env.OTG_GPU_CONTROLS_ENABLED !== "1") throw new MaintenanceError("GPU maintenance is disabled for this environment.");
  const config = maintenanceConfiguration(target);
  const requestId = randomUUID();
  let result: Response;
  try {
    result = await fetch(config.endpoint, { method: "POST", redirect: "error", cache: "no-store",
      headers: { "content-type": "application/json", Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ environment: config.environment, target, action, requestId }),
      signal: AbortSignal.timeout(action === "status" ? 12000 : 240000) });
  } catch { throw new MaintenanceError("Maintenance service is unavailable or timed out. Check the selected worker."); }
  if (result.status === 409) throw new MaintenanceError("Worker is busy or maintenance is already in progress. No reset was performed.", 409);
  if (!result.ok) throw new MaintenanceError("Maintenance service rejected the operation; check its environment, authentication and health.");
  const body = await result.json().catch(() => null);
  if (!body?.ok || body.target !== target || body.environment !== config.environment || body.requestId !== requestId) throw new MaintenanceError("Maintenance response identity could not be verified.");
  const status = sanitizeStatus(body.status, target);
  if (JSON.stringify(status).includes(config.token)) throw new MaintenanceError("Maintenance returned an invalid worker state.");
  const selectedServices = target === "3090" ? Object.values(status.services) : [status.services.comfy8188];
  if (action === "reset_comfy" && !selectedServices.every(service => service.state === "active" && service.http === "ready")) throw new MaintenanceError("Worker restart did not reach readiness.");
  if (action === "free_vram" && !selectedServices.every(service => service.state === "inactive" && service.http === "offline")) throw new MaintenanceError("Worker did not stop; memory release is not confirmed.");
  return status;
}
