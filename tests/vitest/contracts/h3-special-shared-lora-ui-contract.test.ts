import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const panel = fs.readFileSync(
  path.join(process.cwd(), "app/app/components/H3Panel.tsx"),
  "utf8",
);

describe("H3 special-mode shared optional LoRA UI", () => {
  it("loads the LoRA catalog for every mode that supports optional LoRAs", () => {
    expect(panel).toContain(
      "if (!modeCapabilities.supportsOptionalLoras)",
    );
    expect(panel).toContain(
      "/api/h3/loras?mode=${encodeURIComponent(studioMode)}",
    );
  });

  it("renders shared LoRA controls in special H3 modes", () => {
    expect(panel).toContain(
      "{!legacyModeActive ? renderLegacyModelControls() : null}",
    );
    expect(panel).toContain(
      "{!legacyModeActive ? renderCreativeControls() : null}",
    );
  });

  it("does not expose legacy model controls when Turbo/Native is unsupported", () => {
    expect(panel).toContain(
      "{modeCapabilities.supportsTurboNative ? (",
    );
    expect(panel).toContain(
      '? "LoRAs and Creative Controls"',
    );
    expect(panel).toContain(
      ': "Optional H3 LoRAs"',
    );
  });
});
