import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function collectSourceFiles(root: string): string[] {
  const absoluteRoot = path.join(ROOT, root);

  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }

  const output: string[] = [];

  for (const entry of fs.readdirSync(absoluteRoot, {
    withFileTypes: true,
  })) {
    const absolute = path.join(absoluteRoot, entry.name);

    if (entry.isDirectory()) {
      output.push(
        ...collectSourceFiles(
          path.relative(ROOT, absolute),
        ),
      );
      continue;
    }

    if (
      entry.isFile() &&
      /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)
    ) {
      output.push(absolute);
    }
  }

  return output;
}

describe("Angles canonical environment routing contract", () => {
  it("uses canonical Background Angle Plate routing variables", () => {
    const source = read(
      "app/api/background-angle-plate/route.ts",
    );

    expect(source).toContain(
      "BACKGROUND_ANGLE_PLATE_COMFYUI_BASE_URL",
    );

    expect(source).toContain(
      "COMFYUI_IMAGE_URL",
    );

    expect(source).not.toContain(
      "OTG_ANGLES_",
    );
  });

  it("uses canonical image routing for Production scene pass", () => {
    const source = read(
      "app/api/production/picture/scene-pass/route.ts",
    );

    expect(source).toContain(
      "COMFYUI_IMAGE_URL",
    );

    expect(source).not.toContain(
      "OTG_ANGLES_",
    );
  });

  it("contains no surviving OTG_ANGLES source references", () => {
    const files = [
      ...collectSourceFiles("app"),
      ...collectSourceFiles("lib"),
    ];

    const offenders = files
      .filter((file) =>
        fs.readFileSync(file, "utf8")
          .includes("OTG_ANGLES_"),
      )
      .map((file) => path.relative(ROOT, file));

    expect(
      offenders,
      `Legacy OTG_ANGLES references remain:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
