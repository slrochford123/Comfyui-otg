import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addOpenAICreditEvent, buildOpenAIBillingSnapshot, readOpenAIBillingState, writeOpenAIBillingState, syncOpenAIOfficialBilling } from "@/lib/openai/billing";
import { openAIAdminConfigured, openAIAdminKeyPath, readOpenAIAdminKey } from "@/lib/openai/adminCredential";

let root: string;
const key = "synthetic-admin-key-not-a-real-credential";
const now = Date.parse("2026-11-02T12:00:00Z");
const page = (data: unknown[] = [], next: string | null = null) => Response.json({ data, has_more: Boolean(next), next_page: next });
const cost = (value: number, start = Date.parse("2026-11-01T00:00:00Z") / 1000) => ({ start_time: start, end_time: start + 86400, results: [{ amount: { value, currency: "usd" }, project_id: "test-project" }] });
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "billing-sync-"));
  vi.stubEnv("OTG_DATA_DIR", root); vi.stubEnv("OPENAI_ADMIN_API_KEY", key); vi.stubEnv("OPENAI_ADMIN_KEY", "");
  vi.useFakeTimers(); vi.setSystemTime(now);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe("Billing connection and accounting correctness", () => {
  it("does not manufacture credits, spending, consumption or rates for an empty installation", () => {
    const view = buildOpenAIBillingSnapshot();
    expect(view.overview.totalPrepaidCreditsUsd).toBeNull();
    expect(view.overview.totalApiSpendingUsd).toBeNull();
    expect(view.overview.consumedPercent).toBeNull();
    expect(view.overview.spendingRate.dailyUsd).toBeNull();
  });
  it("accepts the official admin env name and a private hot-loaded credential, but never exposes it", () => {
    vi.stubEnv("OPENAI_ADMIN_API_KEY", ""); vi.stubEnv("OPENAI_ADMIN_KEY", key);
    expect(openAIAdminConfigured()).toBe(true);
    vi.stubEnv("OPENAI_ADMIN_KEY", ""); fs.mkdirSync(path.join(root, "openai"));
    fs.writeFileSync(openAIAdminKeyPath(), key, { mode: 0o600 });
    expect(readOpenAIAdminKey()).toBe(key);
    expect(JSON.stringify(buildOpenAIBillingSnapshot())).not.toContain(key);
    fs.chmodSync(openAIAdminKeyPath(), 0o644); expect(openAIAdminConfigured()).toBe(false);
    fs.unlinkSync(openAIAdminKeyPath()); fs.writeFileSync(path.join(root, "other"), key, { mode: 0o600 });
    fs.symlinkSync(path.join(root, "other"), openAIAdminKeyPath()); expect(openAIAdminConfigured()).toBe(false);
  });
  it("does not silently reset corrupt saved credits", () => {
    fs.mkdirSync(path.join(root, "openai")); fs.writeFileSync(path.join(root, "openai/billing.json"), "{broken");
    expect(() => buildOpenAIBillingSnapshot()).toThrow("has not been reset");
  });
  it("preserves repeated group_by fields and reads every page; a real zero is available", async () => {
    const fetcher = vi.fn().mockImplementation((url: URL) => {
      if (url.pathname.endsWith("costs")) {
        expect(url.searchParams.getAll("group_by[]")).toEqual(["project_id", "line_item"]);
        return Promise.resolve(url.searchParams.has("page") ? page() : page([], "page2"));
      }
      expect(url.searchParams.getAll("group_by[]")).toEqual(["project_id", "api_key_id", "model"]);
      return Promise.resolve(page());
    });
    vi.stubGlobal("fetch", fetcher);
    expect((await syncOpenAIOfficialBilling()).ok).toBe(true);
    const view = buildOpenAIBillingSnapshot();
    expect(view.overview.officialReportedSpendingUsd).toBe(0);
    expect(view.overview.spendingRate.dailyUsd).toBe(0);
    expect(view.overview.estimatedPrepaidBalanceUsd).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it("retains last successful costs and time after a rejected credential, without reflecting secrets", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page([cost(7)])));
    await syncOpenAIOfficialBilling(); const last = readOpenAIBillingState().settings.lastOfficialSyncAt;
    vi.setSystemTime(now + 120000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: key } }, { status: 403 })));
    expect((await syncOpenAIOfficialBilling()).ok).toBe(false);
    const view = buildOpenAIBillingSnapshot();
    expect(view.overview.officialReportedSpendingUsd).toBe(7);
    expect(view.official.lastSyncAt).toBe(last); expect(view.official.lastAttemptAt).toBe(now + 120000);
    expect(view.official.stale).toBe(true); expect(JSON.stringify(view)).not.toContain(key);
  });
  it.each(["cursor", "schema", "currency"])("rejects incomplete %s responses without claiming success", async failure => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(failure === "cursor"
      ? Response.json({ data: [], has_more: true, next_page: null })
      : failure === "schema" ? Response.json({})
      : page([{ ...cost(1), results: [{ amount: { value: 1, currency: "eur" } }] }]))));
    expect((await syncOpenAIOfficialBilling()).ok).toBe(false);
    expect(buildOpenAIBillingSnapshot().overview.officialReportedSpendingUsd).toBeNull();
  });
  it("keeps usable costs when a usage endpoint is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: URL) => Promise.resolve(url.pathname.endsWith("costs") ? page([cost(14)]) : Response.json({}, { status: 403 }))));
    expect((await syncOpenAIOfficialBilling()).ok).toBe(true);
    const view = buildOpenAIBillingSnapshot(); expect(view.official.usageWarning).toContain("Costs synchronized");
    expect(view.overview.spendingRate.dailyUsd).toBe(2);
    expect(view.overview.spendingRate.projected30DayUsd).toBe(60);
  });
  it("does not subtract organization buckets from a mid-day portal baseline", async () => {
    addOpenAICreditEvent({ type: "starting_balance", amountUsd: 109.58, effectiveAt: now - 3600000 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page([cost(50)])));
    await syncOpenAIOfficialBilling();
    const view = buildOpenAIBillingSnapshot();
    expect(view.overview.estimatedPrepaidBalanceUsd).toBe(109.58);
    expect(view.overview.creditBalanceVerified).toBe(false);
    expect(view.overview.officialReportedSpendingUsd).toBe(50);
  });
  it("honors a portal reconciliation value and later credit adjustments", () => {
    addOpenAICreditEvent({ type: "manual_reconciliation", amountUsd: 0, verifiedBalanceUsd: 100, effectiveAt: now - 10000 });
    addOpenAICreditEvent({ type: "adjustment", amountUsd: -25 });
    expect(buildOpenAIBillingSnapshot().overview.estimatedPrepaidBalanceUsd).toBe(75);
  });
  it("coalesces overlapping syncs and preserves credit edits made while waiting", async () => {
    let release!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; })).mockImplementation(() => Promise.resolve(page()));
    vi.stubGlobal("fetch", fetcher);
    const first = syncOpenAIOfficialBilling(); const second = syncOpenAIOfficialBilling();
    addOpenAICreditEvent({ type: "starting_balance", amountUsd: 10 });
    release(page()); await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(readOpenAIBillingState().credits).toHaveLength(1);
    expect((await syncOpenAIOfficialBilling()).error).toContain("one minute");
  });
  it.each([NaN, 0, 181, 1.5])("rejects invalid days %s without network access", async days => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await syncOpenAIOfficialBilling(days)).ok).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });
});
