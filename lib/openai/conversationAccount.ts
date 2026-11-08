import { AsyncLocalStorage } from "node:async_hooks";
import { db, ensureMigrations } from "@/lib/auth/db";
import { requireSessionUser } from "@/lib/sessionUser";
import { isAdminUserId } from "@/lib/auth/admin";
import { resolveOwnerAlias } from "@/lib/ownerAlias";
import { RequestError } from "@/lib/requestError";

export function conversationPolicyEnabled() {
  if (process.env.OTG_OPENAI_CONVERSATION_CREDITS !== "1") return false;
  if (process.env.OTG_ENV === "test") return true;
  if (!["prod","production"].includes(process.env.OTG_ENV || "")) return false;
  // Fail closed on incomplete deployment rather than falling through to the
  // legacy unmetered conversational path.
  if (process.env.OTG_PRODUCTION_ALLOWANCE_READY !== "1" || !process.env.OTG_DATA_DIR ||
      !/^(?:\d+\.?\d*|\.\d+)$/.test(process.env.OPENAI_DAILY_GLOBAL_COST_LIMIT_USD || "") ||
      !Number.isFinite(Number(process.env.OPENAI_DAILY_GLOBAL_COST_LIMIT_USD)) ||
      Number(process.env.OPENAI_DAILY_GLOBAL_COST_LIMIT_USD) <= 0) {
    throw new RequestError("Production conversational billing is not configured.", 503);
  }
  return true;
}
export const isConversationalUseCase = (useCase: string) => ["story-helper", "story-write", "h3-director"].includes(useCase);
export const conversationalFeatures=["story-creator","storyteller","ai-assistants","production-studio","h3-director"] as const;
type Feature=typeof conversationalFeatures[number];
type Scope={id:string;feature?:Feature;requestKey?:string;onRoute?:(provider:"openai"|"local3060",model:string)=>void};
const context = new AsyncLocalStorage<Scope>();
export const conversationFeature=(feature?:string)=>context.getStore()?.feature||feature;
export const conversationRequestKey=(key?:string)=>key||context.getStore()?.requestKey;
export const recordConversationRoute=(provider:"openai"|"local3060",model:string)=>context.getStore()?.onRoute?.(provider,model);

export function withConversationAccount<T>(id: string | undefined, run: () => T, metadata?:Omit<Scope,"id">): T {
  return id ? context.run({id,...metadata},run) : run();
}

export function getConversationAccount(id: string) {
  ensureMigrations();
  const user = db.prepare("SELECT id,username,email FROM users WHERE id=?").get(id) as {id:string;username:string;email:string}|undefined;
  if (!user) throw new RequestError("Sign in to use conversational AI.", 401);
  return {...user, admin:isAdminUserId(id)};
}

export function listConversationAccounts() {
  ensureMigrations();
  return (db.prepare("SELECT id,username,email FROM users ORDER BY username COLLATE NOCASE").all() as Array<{id:string;username:string;email:string}>)
    .map(user => ({...user, admin:isAdminUserId(user.id)}));
}

export async function conversationalAccount(ownerKey: string, accountId?: string) {
  let id = accountId || context.getStore()?.id;
  if (!id) {
    let session;
    try { session = await requireSessionUser(new Request("http://localhost")); }
    catch { throw new RequestError("Sign in to use conversational AI.", 401); }
    if (session.ownerKey !== ownerKey) throw new RequestError("Conversational account does not own this request.", 403);
    id = session.accountId;
  }
  if (!id) throw new RequestError("Sign in to use conversational AI.", 401);
  const account = getConversationAccount(id);
  if (account.username && resolveOwnerAlias(account.username) !== ownerKey)
    throw new RequestError("Conversational account does not own this request.", 403);
  return account;
}
