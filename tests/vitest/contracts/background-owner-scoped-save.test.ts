import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  resolve(process.cwd(), "app/app/components/CharactersPanel.tsx"),
  "utf8",
);
const storeSource = readFileSync(
  resolve(process.cwd(), "lib/backgrounds/store.ts"),
  "utf8",
);
const routeSource = readFileSync(
  resolve(process.cwd(), "app/api/backgrounds/route.ts"),
  "utf8",
);

describe("Background Studio owner-scoped persistence", () => {
  it("uses the active profile owner header without forwarding a stale session cookie", () => {
    expect(panelSource).toContain("OTG_BACKGROUND_OWNER_SCOPED_PERSISTENCE_V36AO");
    expect(panelSource).toContain("backgroundLibraryRequestHeadersV36AO");
    expect(panelSource).toContain('"x-otg-device-id": ownerKey');
    expect(panelSource).toContain('credentials: "omit"');
  });

  it("persists the establishing image separately from the completed angle plate", () => {
    expect(panelSource).toContain("establishingImage:");
    expect(panelSource).toContain("panoramaImage:");
    expect(panelSource).toContain("workflowImage && workflowImage !== displayImage");
  });

  it("rejects metadata-only records and filters legacy placeholders from listing", () => {
    expect(storeSource).toContain("OTG_BACKGROUND_STORE_REJECT_METADATA_ONLY_V36AO");
    expect(storeSource).toContain("hasUsableBackgroundImageV36AO");
    expect(storeSource).toContain("Background save rejected: at least one usable display or workflow image is required.");
    expect(storeSource).toContain(".filter((item) => hasUsableBackgroundImageV36AO(item))");
  });

  it("logs the resolved owner and image-bearing save result", () => {
    expect(routeSource).toContain("OTG_BACKGROUND_OWNER_SCOPED_ROUTE_LOGGING_V36AO");
    expect(routeSource).toContain('[background-library] save');
    expect(routeSource).toContain("ownerKey: owner.ownerKey");
    expect(routeSource).toContain("hasWorkflowImage");
  });
});
