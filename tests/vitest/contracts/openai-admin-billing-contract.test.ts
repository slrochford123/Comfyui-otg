import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { addOpenAICreditEvent, buildOpenAIBillingSnapshot } from "@/lib/openai/billing";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  delete process.env.OTG_DATA_DIR;
});

describe("OpenAI admin billing dashboard contract", () => {
  it("keeps OpenAI billing APIs admin-only and avoids returning secrets", () => {
    const route = read("app/api/admin/openai-billing/route.ts");
    const page = read("app/app/admin/openai-billing/page.tsx");
    const client = read("app/app/admin/openai-billing/OpenAIBillingClient.tsx");
    const admin = read("app/app/admin/page.tsx");
    const quickPanel = read("app/app/components/AdminQuickPanel.tsx");
    const installer = read("scripts/install-openai-admin-key-test.sh");

    expect(route).toContain("requireAdmin");
    expect(route).toContain("OPENAI_ADMIN_API_KEY");
    expect(route).not.toContain("OPENAI_API_KEY");
    expect(route).toContain("Cache-Control");
    expect(page).toContain("OpenAIBillingClient");
    expect(client).toContain("/api/admin/openai-billing");
    expect(client).toContain("Open official OpenAI portal");
    expect(client).toContain("This form does not buy credits");
    expect(client).toContain("officialLocalDiscrepancyUsd");
    expect(client).toContain("Official reported spending");
    expect(client).toContain("Estimated balance");
    expect(client).toContain("https://platform.openai.com/settings/organization/billing/overview");
    expect(admin).toContain("/app/admin/openai-billing");
    expect(quickPanel).toContain("/app/admin/openai-billing");
    expect(quickPanel).toContain("OpenAI Billing");
    expect(installer).toContain("read -r -s admin_key");
    expect(installer).toContain("/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local");
    expect(installer).toContain("OPENAI_ADMIN_API_KEY=");
  });

  it("distinguishes official spend from local feature estimates", () => {
    const billing = read("lib/openai/billing.ts");
    const provider = read("lib/openai/provider.ts");

    expect(billing).toContain("/v1/organization/usage/completions");
    expect(billing).toContain("/v1/organization/usage/audio_transcriptions");
    expect(billing).toContain("/v1/organization/costs");
    expect(billing).toContain("officialUsage");
    expect(billing).toContain("officialLocalDiscrepancyUsd");
    expect(billing).toContain("group_by[]");
    expect(billing).toContain("official_costs_with_local_feature_estimates");
    expect(billing).toContain("local_estimates_only");
    expect(billing).toContain("OPENAI_ADMIN_API_KEY");
    expect(billing).toContain("starting_balance");
    expect(billing).toContain("manual_reconciliation");
    expect(billing).toContain("lowBalanceWarningsUsd: [10, 5]");
    expect(provider).toContain('"gpt-6-luna": { inputUsdPer1M: 0.10, outputUsdPer1M: 0.50 }');
    expect(provider).toContain('"gpt-6.1-sol": { inputUsdPer1M: 2.00, outputUsdPer1M: 10.00 }');
    expect(provider).toContain('"gpt-transcribe": { inputUsdPer1M: 0, outputUsdPer1M: 0, audioUsdPerMinute: 0.0045 }');
  });

  it("calculates prepaid balance without double-counting spend before a starting balance", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "otg-openai-billing-"));
    process.env.OTG_DATA_DIR = tempDir;
    const openaiDir = path.join(tempDir, "openai");
    fs.mkdirSync(openaiDir, { recursive: true });
    fs.writeFileSync(
      path.join(openaiDir, "usage.json"),
      JSON.stringify({
        records: [
          {
            ts: Date.parse("2026-10-13T12:00:00Z"),
            ownerKey: "before-starting-balance",
            useCase: "story-helper",
            model: "gpt-6.1-sol",
            inputTokens: 10,
            outputTokens: 10,
            totalTokens: 20,
            audioSeconds: 0,
            approximateCostUsd: 99,
          },
          {
            ts: Date.parse("2026-10-14T12:00:00Z"),
            ownerKey: "admin-test-user",
            useCase: "story-helper",
            model: "gpt-6.1-sol",
            inputTokens: 0,
            outputTokens: 1275000,
            totalTokens: 1275000,
            audioSeconds: 0,
            approximateCostUsd: 12.75,
          },
        ],
      }),
    );

    addOpenAICreditEvent({
      type: "starting_balance",
      amountUsd: 50,
      effectiveAt: Date.parse("2026-10-14T00:00:00Z"),
      note: "Portal balance entered for test.",
    });
    const snapshot = buildOpenAIBillingSnapshot();

    expect(snapshot.overview.totalPrepaidCreditsUsd).toBe(50);
    expect(snapshot.overview.totalApiSpendingUsd).toBe(12.75);
    expect(snapshot.overview.estimatedPrepaidBalanceUsd).toBe(37.25);
    expect(snapshot.overview.officialLocalDiscrepancyUsd).toBeNull();
  });

  it("re-estimates older zero-cost local usage records from model pricing", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "otg-openai-billing-"));
    process.env.OTG_DATA_DIR = tempDir;
    const openaiDir = path.join(tempDir, "openai");
    fs.mkdirSync(openaiDir, { recursive: true });
    fs.writeFileSync(
      path.join(openaiDir, "usage.json"),
      JSON.stringify({
        records: [
          {
            ts: Date.now(),
            ownerKey: "admin-test-user",
            useCase: "story-helper",
            model: "gpt-6.1-sol",
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            totalTokens: 2_000_000,
            audioSeconds: 0,
            approximateCostUsd: 0,
          },
        ],
      }),
    );

    const snapshot = buildOpenAIBillingSnapshot();

    expect(snapshot.overview.totalApiSpendingUsd).toBe(12);
    expect(snapshot.features[0].estimatedCostUsd).toBe(12);
    expect(snapshot.recentUsage[0].approximateCostUsd).toBe(12);
  });
});

