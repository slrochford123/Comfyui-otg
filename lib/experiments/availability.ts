import { AsyncLocalStorage } from "node:async_hooks";
import { RequestError } from "@/lib/requestError";

// Request-local scope: enabling H3 NSFW must never enable the Testing routes.
const workspace = new AsyncLocalStorage<"nsfw">();
export function nsfwEnabled() {
  return process.env.OTG_ENV === "test" || (process.env.OTG_ENV === "prod" && process.env.OTG_H3_NSFW_ENABLED === "1");
}
export function withNsfwWorkspace<T>(fn: () => T): T {
  if (!nsfwEnabled()) throw new RequestError("Not found.", 404);
  return workspace.run("nsfw", fn);
}
export function productionNsfwScope() {
  return workspace.getStore() === "nsfw" && process.env.OTG_ENV === "prod" && nsfwEnabled();
}
