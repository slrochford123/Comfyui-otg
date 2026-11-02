import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let data: string;
beforeEach(() => {
  vi.resetModules();
  data = fs.mkdtempSync(path.join(os.tmpdir(), "openai-connection-test-"));
  vi.stubEnv("OTG_DATA_DIR", data);
  vi.stubEnv("OPENAI_API_KEY", "test-secret-not-a-real-key");
  vi.stubEnv("OPENAI_KILL_SWITCH", "false");
  vi.stubEnv("OPENAI_ORG_ID", "test-org");
  vi.stubEnv("OPENAI_PROJECT_ID", "test-project");
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  fs.rmSync(data, { recursive: true, force: true });
});

describe("OpenAI connection and truthful billing", () => {
  it("checks only models, carries configured scope, deduplicates and never returns secrets or a claimed balance", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: "gpt-6-luna" }, { id: "gpt-6.1-sol" }] }));
    vi.stubGlobal("fetch", fetcher);
    const { checkOpenAIConnection, openAIConnectionSnapshot } = await import("@/lib/openai/connection");
    expect(openAIConnectionSnapshot().probe).toBeNull();
    const results = await Promise.all([checkOpenAIConnection(), checkOpenAIConnection()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.openai.com/v1/models");
    expect(fetcher.mock.calls[0][1].headers["OpenAI-Project"]).toBe("test-project");
    expect(results[0].probe?.authentication).toBe("verified");
    expect(results[0].creditBalanceUsd).toBeNull();
    expect(JSON.stringify(results)).not.toContain("test-secret-not-a-real-key");
    expect(JSON.stringify(results)).not.toContain("test-project");
    await checkOpenAIConnection(); expect(fetcher).toHaveBeenCalledTimes(1);
    vi.stubEnv("OPENAI_API_KEY", "rotated-test-key");
    expect(openAIConnectionSnapshot().probe).toBeNull();
    await checkOpenAIConnection(); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("respects the kill switch without making an external request", async () => {
    vi.stubEnv("OPENAI_KILL_SWITCH", "true");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const { checkOpenAIConnection } = await import("@/lib/openai/connection");
    expect((await checkOpenAIConnection()).enabled).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports failed credentials without reflecting provider error details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "sensitive upstream detail" } }, { status: 401 })));
    const { checkOpenAIConnection } = await import("@/lib/openai/connection");
    const result = await checkOpenAIConnection();
    expect(result.probe?.authentication).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("sensitive upstream detail");
  });

  it("does not turn absent credits into a zero or negative account balance", async () => {
    const { buildOpenAIBillingSnapshot, addOpenAICreditEvent } = await import("@/lib/openai/billing");
    expect(buildOpenAIBillingSnapshot().overview.estimatedPrepaidBalanceUsd).toBeNull();
    const entry = addOpenAICreditEvent({ type: "starting_balance", amountUsd: 5 });
    expect(entry.verifiedBalanceUsd).toBeNull();
    expect(buildOpenAIBillingSnapshot().overview.estimatedPrepaidBalanceUsd).toBe(5);
    expect(buildOpenAIBillingSnapshot().overview.creditBalanceVerified).toBe(false);
  });
});
