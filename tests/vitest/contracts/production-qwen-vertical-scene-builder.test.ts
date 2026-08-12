import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.join(process.cwd(), "app/app/components/QwenSceneBuilderPanel.tsx");
const source = fs.readFileSync(sourcePath, "utf8");

describe("Production Qwen scene builder vertical stack and reference UX", () => {
  it("starts with one scene and appends scenes one at a time", () => {
    expect(source).toContain("// OTG_QWEN_DYNAMIC_SCENE_STACK_V1");
    expect(source).toContain("return [createSceneRecord(0)];");
    expect(source).toContain('data-otg-add-scene="true"');
    expect(source).toContain('`+ Add Scene (${scenes.length}/${MAX_SCENES})`');
  });

  it("labels scene upload as an optional completed-scene input", () => {
    expect(source).toContain("Optional: Upload a completed scene");
    expect(source).not.toContain("                    Upload image\n");
  });

  it("loads character, background, and object galleries with the active owner", () => {
    expect(source).toContain("// OTG_QWEN_OWNER_SCOPED_REFERENCE_GALLERIES_V1");
    expect(source).toContain('"x-otg-device-id": ownerKey');
    expect(source).toContain('credentials: ownerKey ? "omit" as const : "same-origin" as const');
    expect(source).toContain('target.searchParams.set("deviceId", ownerKey)');
    expect(source).toContain("Character Gallery");
    expect(source).toContain("Background Gallery");
    expect(source).toContain("Object / Prop Gallery");
  });

  it("serves Linux absolute reference thumbnails through the file API", () => {
    expect(source).toContain('/^\\/(home|opt|var|mnt|srv|tmp)\\//i.test(raw)');
    expect(source).toContain('`/api/file?path=${encodeURIComponent(raw)}`');
  });

  it("moves raw asset bridge controls into a clearly explained advanced section", () => {
    expect(source).toContain('data-otg-qwen-manual-reference-advanced="true"');
    expect(source).toContain("Advanced: Add a manual image reference");
    expect(source).toContain("Type tells Qwen whether the image is a character, background, or object.");
    expect(source).toContain("Add Manual Reference");
    expect(source).toContain("Object / Prop Gallery opens the app's regular Gallery and adds a selected existing image as a reference.");
    expect(source).toContain("Write text instructions in the Scene Prompt box above.");
  });
});
