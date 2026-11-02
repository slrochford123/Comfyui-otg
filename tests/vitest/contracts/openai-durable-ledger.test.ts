import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readLedgerUsage, reserveOpenAIUsage, settleOpenAIUsage, finishUnsettledOpenAIUsage, readOpenAIReservationSummary } from "@/lib/openai/usageLedger";
let root: string;
const request = (ownerKey = "alice") => ({ ownerKey, useCase: "story-helper", reservedUsd: 0.25, userLimit: 0.5, globalLimit: 0.75, maxRequests: 20, windowMs: 60000 });
const record = () => ({ ts: Date.now(), ownerKey: "alice", useCase: "story-helper" as const, model: "gpt-6.1-sol", inputTokens: 1, outputTokens: 2, totalTokens: 3, audioSeconds: 0, approximateCostUsd: 0.1 });
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "openai-ledger-")); vi.stubEnv("OTG_DATA_DIR", root); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
describe("durable OpenAI usage and in-flight budget", () => {
  it("imports legacy usage once and leaves the original ledger untouched", () => {
    const dir = path.join(root, "openai"); fs.mkdirSync(dir); const file = path.join(dir, "usage.json");
    const original = JSON.stringify({ records: [record(), record()] }); fs.writeFileSync(file, original);
    expect(readLedgerUsage()).toHaveLength(2); expect(readLedgerUsage()).toHaveLength(2);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });
  it("fails closed on a corrupt existing ledger", () => {
    fs.mkdirSync(path.join(root, "openai")); fs.writeFileSync(path.join(root, "openai/usage.json"), "broken");
    expect(() => reserveOpenAIUsage(request())).toThrow();
    expect(() => readLedgerUsage()).toThrow();
  });
  it("includes pending requests in both user and global budgets across reopened connections", () => {
    reserveOpenAIUsage(request()); reserveOpenAIUsage(request());
    expect(() => reserveOpenAIUsage(request())).toThrow(/user/);
    reserveOpenAIUsage(request("bob"));
    expect(() => reserveOpenAIUsage(request("carol"))).toThrow(/global/);
  });
  it("settles exactly once and preserves ambiguous outcomes for reconciliation", () => {
    const id = reserveOpenAIUsage(request());
    settleOpenAIUsage(id, record(), "provider-id"); settleOpenAIUsage(id, record(), "provider-id");
    expect(readLedgerUsage()).toHaveLength(1);
    const unknown = reserveOpenAIUsage(request()); finishUnsettledOpenAIUsage(unknown);
    expect(readOpenAIReservationSummary()).toEqual([{ status: "unknown", requests: 1, reservedUsd: 0.25 }]);
    expect(() => reserveOpenAIUsage(request())).toThrow(/user/);
  });
  it("releases a definite rejection without erasing rate-limit history", () => {
    const args = { ...request(), maxRequests: 1 };
    const id = reserveOpenAIUsage(args); finishUnsettledOpenAIUsage(id, true);
    expect(readOpenAIReservationSummary()).toEqual([]);
    expect(() => reserveOpenAIUsage(args)).toThrow(/rate limit/);
  });
});
