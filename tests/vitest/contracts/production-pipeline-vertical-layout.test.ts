import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.join(process.cwd(), "app/app/components/StoryboardPanel.tsx");
const source = fs.readFileSync(sourcePath, "utf8");
const pipelineSource = source.slice(source.indexOf('data-otg-production-pipeline-vertical="true"'));

describe("Production pipeline compact vertical mobile layout", () => {
  it("keeps the TEST Production pipeline width-bounded and vertical", () => {
    expect(source).toContain("// OTG_PRODUCTION_VERTICAL_STACK_V1");
    expect(source).toContain("// OTG_PRODUCTION_COMPACT_ROTATING_STAGE_NAV_V1");
    expect(source).toContain('data-otg-production-pipeline-vertical="true"');
    expect(source).toContain("w-full max-w-full overflow-x-hidden");
  });

  it("uses a compact current stage with four rotating square stage buttons", () => {
    expect(source).toContain('data-otg-production-stage-rotating-rail="true"');
    expect(source).toContain('data-otg-production-rotating-stage-squares="true"');
    expect(source).toContain('className="mt-3 grid grid-cols-4 gap-2"');
    expect(source).toContain("...stages.slice(activeIndex + 1)");
    expect(source).toContain("...stages.slice(0, activeIndex)");
    expect(source).not.toContain('{stage.description}');
  });

  it("keeps bottom navigation compact with five named square buttons", () => {
    expect(source).toContain('data-otg-production-stage-bottom-compact="true"');
    expect(source).toContain('data-otg-production-stage-square-row="true"');
    expect(source).toContain('className="grid grid-cols-5 gap-2"');
    expect(source).toContain('{stage.label}');
  });

  it("retains scene creation and existing eight-scene limit", () => {
    expect(pipelineSource).toContain('`+ Add Scene (${scenes.length}/${MAX_PRODUCTION_SCENES})`');
    expect(pipelineSource).toContain('`Maximum ${MAX_PRODUCTION_SCENES} scenes reached`');
    expect(pipelineSource).toContain("disabled={scenes.length >= MAX_PRODUCTION_SCENES}");
  });
});
