import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { RequestError } from "@/lib/requestError";
import type { OpenAIUsageRecord } from "@/lib/openai/provider";
import { newYorkBudgetDayStart, productionBudgetEnabled } from "./budgetDay";

function withLedger<T>(fn: (db: Database.Database) => T): T {
  const root = process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT || path.join(os.homedir(), "AI/runtime/test/data");
  const dir = path.join(root, "openai");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "usage.sqlite");
  const db = new Database(file);
  try {
    fs.chmodSync(file, 0o600);
    db.pragma("busy_timeout = 5000"); db.pragma("journal_mode = WAL"); db.pragma("synchronous = FULL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS ledger_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_records (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, owner TEXT NOT NULL, cost REAL NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_owner_time ON usage_records(owner, ts);
      CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, owner TEXT NOT NULL, use_case TEXT NOT NULL, cost REAL NOT NULL, status TEXT NOT NULL, provider_id TEXT);
      CREATE INDEX IF NOT EXISTS reservation_owner_time ON reservations(owner, ts);
      CREATE TABLE IF NOT EXISTS conversation_credit_events (
        account TEXT NOT NULL, event_key TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
        nanos INTEGER NOT NULL, actor TEXT NOT NULL, note TEXT NOT NULL, PRIMARY KEY(account,event_key)
      );
      CREATE TABLE IF NOT EXISTS conversation_allowance_requests (
        reservation TEXT PRIMARY KEY, account TEXT NOT NULL, request_key TEXT, reserved_nanos INTEGER NOT NULL,
        actual_nanos INTEGER, model TEXT NOT NULL, price_version TEXT NOT NULL,
        UNIQUE(account,request_key)
      );
      CREATE INDEX IF NOT EXISTS conversation_account ON conversation_allowance_requests(account);
      CREATE TABLE IF NOT EXISTS conversation_request_features (reservation TEXT PRIMARY KEY, feature TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_provider (
        account TEXT NOT NULL, feature TEXT NOT NULL, provider TEXT NOT NULL, reason TEXT,
        ts INTEGER NOT NULL, PRIMARY KEY(account,feature)
      );
    `);
    db.transaction(() => {
      if (db.prepare("SELECT 1 FROM ledger_meta WHERE key='legacy_import'").get()) return;
      const legacy = path.join(dir, "usage.json");
      if (fs.existsSync(legacy)) {
        // A corrupt or unreadable ledger must block spending, not reset it.
        const parsed = JSON.parse(fs.readFileSync(legacy, "utf8"));
        if (!Array.isArray(parsed?.records)) throw new Error("Invalid legacy OpenAI usage ledger; repair required before spending.");
        const insert = db.prepare("INSERT OR IGNORE INTO usage_records VALUES (?, ?, ?, ?, ?)");
        parsed.records.forEach((record: OpenAIUsageRecord, index: number) => {
          if (!record || typeof record.ownerKey !== "string" || !Number.isFinite(record.ts) || !Number.isFinite(record.approximateCostUsd) || record.approximateCostUsd < 0) throw new Error("Invalid legacy OpenAI usage record; repair required before spending.");
          const json = JSON.stringify(record);
          insert.run("legacy-" + createHash("sha256").update(index + ":" + json).digest("hex"), record.ts, record.ownerKey, record.approximateCostUsd, json);
        });
      }
      db.prepare("INSERT INTO ledger_meta VALUES ('legacy_import', ?)").run(new Date().toISOString());
    }).immediate();
    return fn(db);
  } finally { db.close(); }
}

export function readLedgerUsage(): OpenAIUsageRecord[] {
  return withLedger(db => (db.prepare("SELECT record FROM usage_records ORDER BY ts, id").all() as Array<{ record: string }>).map(row => JSON.parse(row.record)));
}

export class ConversationCreditInsufficient extends RequestError {
  constructor() { super("Insufficient OpenAI allowance for this request.", 402); }
}

export class OpenAIGlobalBudgetReached extends RequestError {
  constructor() { super("Daily OpenAI global cost limit reached, including in-flight requests.", 429); }
}

export type ConversationFallbackReason = "allowance" | "global-budget";
type Account = {id:string;admin:boolean};
type Allowance = {account:Account;nanos:number;model:string;priceVersion:string;feature:string;requestKey?:string};

function initialize(db: Database.Database, account: Account) {
  if (!account.admin) db.prepare("INSERT OR IGNORE INTO conversation_credit_events VALUES (?,?,?,?,?,?,?)")
    .run(account.id,"initial-v1",Date.now(),"initial",10_000_000_000,"system","One-time conversational allowance");
}

function balance(db: Database.Database, account: Account) {
  const {credit} = db.prepare("SELECT COALESCE(SUM(nanos),0) AS credit FROM conversation_credit_events WHERE account=?").get(account.id) as {credit:number};
  const {spent,held} = db.prepare(`SELECT COALESCE(SUM(a.actual_nanos),0) AS spent,
    COALESCE(SUM(CASE WHEN r.status IN ('pending','unknown') THEN a.reserved_nanos ELSE 0 END),0) AS held
    FROM conversation_allowance_requests a JOIN reservations r ON r.id=a.reservation WHERE a.account=?`).get(account.id) as {spent:number;held:number};
  return {availableNanos:account.admin ? null : Math.max(0,credit-spent-held), creditNanos:credit, spentNanos:spent, heldNanos:held};
}

export function conversationCreditStatus(account: Account, feature?: string) {
  return withLedger(db => db.transaction(() => {
    initialize(db,account);
    return {...balance(db,account), admin:account.admin,
      lastRoute: db.prepare(`SELECT provider,reason,ts FROM conversation_provider WHERE account=?
        AND (? IS NULL OR feature=?) ORDER BY ts DESC LIMIT 1`).get(account.id,feature||null,feature||null) || null,
      requested: Boolean(db.prepare("SELECT 1 FROM conversation_credit_events WHERE account=? AND kind='request' AND rowid>(SELECT COALESCE(MAX(rowid),0) FROM conversation_credit_events WHERE account=? AND nanos>0)").get(account.id,account.id))};
  }).immediate());
}

export function noteConversationProvider(account: Account, feature: string, provider: "openai"|"local3060", reason?: ConversationFallbackReason|"selected") {
  withLedger(db => db.prepare("INSERT OR REPLACE INTO conversation_provider VALUES (?,?,?,?,?)")
    .run(account.id,feature,provider,reason||null,Date.now()));
}

export function requestConversationCredit(account: Account) {
  return withLedger(db => db.transaction(() => {
    initialize(db,account);
    if (account.admin) return;
    const pending = db.prepare("SELECT 1 FROM conversation_credit_events WHERE account=? AND kind='request' AND rowid>(SELECT COALESCE(MAX(rowid),0) FROM conversation_credit_events WHERE account=? AND nanos>0)").get(account.id,account.id);
    if (!pending) db.prepare("INSERT INTO conversation_credit_events VALUES (?,?,?,?,?,?,?)")
      .run(account.id,randomUUID(),Date.now(),"request",0,account.id,"Requested additional credit");
  }).immediate());
}

export function adjustConversationCredit(args: {account:Account;actor:string;key:string;kind:string;amountUsd:number;note:string}) {
  const {account,actor,key,kind,amountUsd,note} = args;
  const nanos = Math.round(amountUsd*1e9);
  if (account.admin || !/^[\w-]{16,100}$/.test(key) || key==="initial-v1" || !["complimentary","purchase","adjustment"].includes(kind)
    || !Number.isSafeInteger(nanos) || !nanos || Math.abs(amountUsd)>10_000 || (kind!=="adjustment" && nanos<0) || !note.trim())
    throw new RequestError("Provide a valid credit adjustment, reason, and unique submission key.",400);
  return withLedger(db => db.transaction(() => {
    initialize(db,account);
    const prior = db.prepare("SELECT actor,kind,nanos,note FROM conversation_credit_events WHERE account=? AND event_key=?")
      .get(account.id,key) as {actor:string;kind:string;nanos:number;note:string}|undefined;
    if (prior) {
      if(prior.actor!==actor || prior.kind!==kind || prior.nanos!==nanos || prior.note!==note) throw new RequestError("This submission key is already in use.",409);
      return balance(db,account);
    }
    if(nanos<0 && -nanos>(balance(db,account).availableNanos||0)) throw new RequestError("Adjustment exceeds unreserved credit.",409);
    db.prepare("INSERT INTO conversation_credit_events VALUES (?,?,?,?,?,?,?)").run(account.id,key,Date.now(),kind,nanos,actor,note);
    return balance(db,account);
  }).immediate());
}

export function conversationAdminLedger() {
  return withLedger(db => {
    db.prepare("UPDATE reservations SET status='unknown' WHERE status='pending' AND ts<? AND id IN (SELECT reservation FROM conversation_allowance_requests)").run(Date.now()-15*60_000);
    return {
      events:db.prepare("SELECT account,event_key,ts,kind,nanos,actor,note FROM conversation_credit_events ORDER BY ts DESC LIMIT 500").all(),
      unknown:db.prepare(`SELECT a.account,a.model,a.reservation,a.reserved_nanos,r.ts,r.use_case,r.provider_id FROM conversation_allowance_requests a
        JOIN reservations r ON r.id=a.reservation WHERE r.status='unknown' ORDER BY r.ts DESC LIMIT 200`).all(),
    };
  });
}

export function markOpenAIResponse(id:string,providerId:string) {
  withLedger(db=>db.prepare("UPDATE reservations SET provider_id=? WHERE id=? AND status IN ('pending','unknown')").run(providerId,id));
}

export function releaseUnbilledConversationHold(id: string, actor: string, note: string) {
  return withLedger(db => db.transaction(() => {
    const row = db.prepare("SELECT account FROM conversation_allowance_requests WHERE reservation=?").get(id) as {account:string}|undefined;
    if (!row || !note.trim()) throw new RequestError("Select a hold and document the provider reconciliation.",400);
    const changed=db.prepare("UPDATE reservations SET status='reconciled-unbilled' WHERE id=? AND status='unknown'").run(id);
    if (!changed.changes) throw new RequestError("The reservation is no longer awaiting reconciliation.",409);
    db.prepare("INSERT INTO conversation_credit_events VALUES (?,?,?,?,?,?,?)").run(row.account,"unbilled-"+id,Date.now(),"release",0,actor,note);
  }).immediate());
}

export function readUncertainConversationRequest(id:string) {
  return withLedger(db=>db.prepare(`SELECT r.owner,r.use_case AS useCase,r.provider_id AS providerId,a.account,a.model,f.feature
    FROM reservations r JOIN conversation_allowance_requests a ON a.reservation=r.id
    LEFT JOIN conversation_request_features f ON f.reservation=r.id
    WHERE r.id=? AND r.status='unknown'`).get(id) as {owner:string;useCase:OpenAIUsageRecord["useCase"];providerId:string|null;account:string;model:string;feature:string|null}|undefined);
}

export function reserveOpenAIUsage(args: { ownerKey: string; useCase: string; reservedUsd: number; userLimit: number; globalLimit: number; maxRequests: number; windowMs: number; allowance?:Allowance }) {
  if (!args.ownerKey || !Number.isFinite(args.reservedUsd) || args.reservedUsd < 0) throw new RequestError("Invalid OpenAI request budget.", 400);
  return withLedger(db => db.transaction(() => {
    const now = Date.now(), since = now - 86400000;
    const a = args.allowance;
    if (a) {
      initialize(db,a.account);
      if (a.requestKey && db.prepare("SELECT 1 FROM conversation_allowance_requests WHERE account=? AND request_key=?").get(a.account.id,a.requestKey))
        throw new RequestError("This conversational request was already submitted. Check the original response.",409);
      if (!a.account.admin && a.nanos>(balance(db,a.account).availableNanos||0)) throw new ConversationCreditInsufficient();
    }
    const requests = db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE owner=? AND use_case=? AND ts>=?").get(args.ownerKey, args.useCase, now - args.windowMs) as { count: number };
    if (requests.count >= args.maxRequests) throw new RequestError("OpenAI rate limit reached. Please wait and retry.", 429);
    const totals = db.prepare(`SELECT SUM(cost) AS total, SUM(CASE WHEN owner=? THEN cost ELSE 0 END) AS own FROM (
      SELECT owner,cost FROM usage_records WHERE ts>=? UNION ALL
      SELECT owner,cost FROM reservations WHERE ts>=? AND status IN ('pending','unknown')
    )`).get(args.ownerKey, since, since) as { total: number | null; own: number | null };
    if (args.userLimit > 0 && Number(totals.own || 0) + args.reservedUsd > args.userLimit) throw new RequestError("Daily OpenAI cost limit reached for this user, including in-flight requests.", 429);
    if (args.globalLimit > 0) {
      if (productionBudgetEnabled()) {
        const dayStart = newYorkBudgetDayStart(now);
        const { nanos } = db.prepare(`SELECT COALESCE(SUM(nanos),0) AS nanos FROM (
          SELECT CAST(ROUND(u.cost * 1000000000) AS INTEGER) AS nanos FROM usage_records u
          LEFT JOIN reservations r ON r.id=u.id WHERE COALESCE(r.ts,u.ts)>=?
          UNION ALL
          SELECT CAST(ROUND(cost * 1000000000) AS INTEGER) FROM reservations
          WHERE ts>=? AND status IN ('pending','unknown')
        )`).get(dayStart,dayStart) as {nanos:number};
        if (nanos + Math.round(args.reservedUsd * 1e9) > Math.round(args.globalLimit * 1e9))
          throw new OpenAIGlobalBudgetReached();
      } else if (Number(totals.total || 0) + args.reservedUsd > args.globalLimit) {
        throw new OpenAIGlobalBudgetReached();
      }
    }
    const id = randomUUID();
    db.prepare("INSERT INTO reservations (id,ts,owner,use_case,cost,status) VALUES (?,?,?,?,?,'pending')").run(id, now, args.ownerKey, args.useCase, args.reservedUsd);
    if (a) {
      db.prepare("INSERT INTO conversation_allowance_requests VALUES (?,?,?,?,NULL,?,?)")
        .run(id,a.account.id,a.requestKey||null,a.account.admin?0:a.nanos,a.model,a.priceVersion);
      db.prepare("INSERT INTO conversation_request_features VALUES (?,?)").run(id,a.feature);
    }
    return id;
  }).immediate());
}

export function settleOpenAIUsage(id: string, record: OpenAIUsageRecord, providerId?: string, reconciledBy?: string) {
  if (!Number.isFinite(record.approximateCostUsd) || record.approximateCostUsd < 0) throw new Error("Invalid OpenAI usage cost.");
  withLedger(db => db.transaction(() => {
    const reservation = db.prepare("SELECT owner,status FROM reservations WHERE id=?").get(id) as { owner: string;status:string } | undefined;
    if (!reservation || reservation.owner !== record.ownerKey) throw new Error("OpenAI reservation owner mismatch.");
    if(reconciledBy&&reservation.status!=="unknown")throw new RequestError("The reservation was already reconciled.",409);
    const a = db.prepare("SELECT account,price_version FROM conversation_allowance_requests WHERE reservation=?").get(id) as {account:string;price_version:string}|undefined;
    db.prepare("INSERT OR IGNORE INTO usage_records VALUES (?,?,?,?,?)").run(id, record.ts, record.ownerKey, record.approximateCostUsd, JSON.stringify({ ...record, requestId: id, providerRequestId: providerId,
      ...(a?{accountId:a.account,priceVersion:a.price_version}:{}) }));
    if (a) db.prepare("UPDATE conversation_allowance_requests SET actual_nanos=? WHERE reservation=? AND actual_nanos IS NULL")
      .run(Math.round(record.approximateCostUsd*1e9),id);
    if(a&&reconciledBy)db.prepare("INSERT INTO conversation_credit_events VALUES (?,?,?,?,?,?,?)")
      .run(a.account,"reconciled-"+id,Date.now(),"verified-usage",0,reconciledBy,"Settled from OpenAI response "+providerId);
    db.prepare("UPDATE reservations SET status='settled', provider_id=? WHERE id=?").run(providerId || null, id);
  }).immediate());
}

export function finishUnsettledOpenAIUsage(id: string, definitelyRejected = false) {
  withLedger(db => db.prepare("UPDATE reservations SET status=? WHERE id=? AND status='pending'").run(definitelyRejected ? "rejected" : "unknown", id));
}

export function readOpenAIReservationSummary() {
  return withLedger(db => db.prepare("SELECT status, COUNT(*) AS requests, SUM(cost) AS reservedUsd FROM reservations WHERE ts>=? AND status IN ('pending','unknown') GROUP BY status").all(Date.now() - 86400000) as Array<{status: "pending" | "unknown"; requests: number; reservedUsd: number}>);
}
