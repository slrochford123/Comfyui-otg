import {
  describe,
  expect,
  it,
} from "vitest";
import fs from "node:fs";
import path from "node:path";

const routeSource = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/api/background-angle-plate/route.ts",
  ),
  "utf8",
);

const workflowPathCandidates = [
  path.join(
    process.cwd(),
    "workflows/backgrounds/qwen-background-angle-plate.json",
  ),
  path.join(
    process.cwd(),
    "app/workflows/backgrounds/qwen-background-angle-plate.json",
  ),
];

const workflowPath = workflowPathCandidates.find(
  (candidate) => fs.existsSync(candidate),
);

if (!workflowPath) {
  throw new Error(
    "Background angle workflow was not found.",
  );
}

const workflow = JSON.parse(
  fs.readFileSync(workflowPath, "utf8"),
);

function nodeInput(
  nodeId: string,
  inputName: string,
) {
  return workflow?.[nodeId]?.inputs?.[inputName];
}

describe(
  "Background canonical direction geometry",
  () => {
    it(
      "maps the actual Left output to the Left branch",
      () => {
        expect(nodeInput("47", "images")).toEqual(
          ["65:40:107", 0],
        );
        expect(
          nodeInput("65:40:111", "prompt"),
        ).toEqual(["72", 0]);

        expect(routeSource).toContain(
          'left: {\n    nodeId: "47",\n    promptNodeId: "72",',
        );
        expect(routeSource).toContain(
          "Rotate camera yaw exactly 90 degrees to the left.",
        );
        expect(routeSource).toContain(
          "physical left-hand side visible at the left edge of Front",
        );
      },
    );

    it(
      "maps the actual Right output to the Right branch without reversal",
      () => {
        expect(nodeInput("38", "images")).toEqual(
          ["65:39:98", 0],
        );
        expect(
          nodeInput("65:39:102", "prompt"),
        ).toEqual(["68", 0]);

        expect(routeSource).toContain(
          'right: {\n    nodeId: "38",\n    promptNodeId: "68",',
        );
        expect(routeSource).toContain(
          "Rotate camera yaw exactly 90 degrees to the right.",
        );
        expect(routeSource).toContain(
          "physical right-hand side visible at the right edge of Front",
        );
      },
    );

    it(
      "chains Back through the generated Left decode before pruning",
      () => {
        expect(nodeInput("34", "images")).toEqual(
          ["65:35:80", 0],
        );
        expect(
          nodeInput("65:35:84", "prompt"),
        ).toEqual(["67", 0]);

        expect(routeSource).toContain(
          "OTG_BACKGROUND_CANONICAL_DIRECTION_GEOMETRY_PP06_V1",
        );
        expect(routeSource).toContain(
          'setNodeInput(\n    workflow,\n    "65:35:82",\n    "image",\n    ["65:40:107", 0],',
        );

        const rewireIndex = routeSource.indexOf(
          "applyCanonicalDirectionalSourceGraphV1(workflow);",
        );
        const pruneIndex = routeSource.indexOf(
          "retainCanonicalDirectionalOutputsV36C(workflow)",
        );

        expect(rewireIndex).toBeGreaterThanOrEqual(0);
        expect(pruneIndex).toBeGreaterThan(rewireIndex);

        expect(routeSource).toContain(
          "input image is already the physical Left 90-degree view",
        );
        expect(routeSource).toContain(
          "true opposite direction from the original Front",
        );
        expect(routeSource).toContain(
          "Do not produce a diagonal remix or a slightly reframed Front.",
        );
      },
    );

    it(
      "keeps Up as fixed-position upward pitch",
      () => {
        expect(nodeInput("41", "images")).toEqual(
          ["65:42:116", 0],
        );
        expect(
          nodeInput("65:42:120", "prompt"),
        ).toEqual(["70", 0]);

        expect(routeSource).toContain(
          'up: {\n    nodeId: "41",\n    promptNodeId: "70",',
        );
        expect(routeSource).toContain(
          "Pitch only the camera lens upward.",
        );
        expect(routeSource).toContain(
          "Keep yaw unchanged and roll at 0 degrees.",
        );
      },
    );

    it(
      "makes Down a fixed-position lens pitch and explicitly rejects aerial relocation",
      () => {
        expect(nodeInput("43", "images")).toEqual(
          ["65:44:125", 0],
        );
        expect(
          nodeInput("65:44:128", "prompt"),
        ).toEqual(["71", 0]);

        expect(routeSource).toContain(
          'down: {\n    nodeId: "43",\n    promptNodeId: "71",',
        );
        expect(routeSource).toContain(
          "Keep the camera at the exact same physical position and standing eye height",
        );
        expect(routeSource).toContain(
          "Pitch only the camera lens downward approximately 45-60 degrees",
        );
        expect(routeSource).toContain(
          "Do not fly, rise, crane, orbit, strafe, translate, zoom out",
        );
        expect(routeSource).toContain(
          "aerial, drone, bird's-eye, or top-down camera view",
        );
        expect(routeSource).not.toContain(
          "Turn the camera to a bird's-eye top-down view",
        );
      },
    );

    it(
      "keeps Front untouched as the accepted source rather than a generated branch",
      () => {
        expect(nodeInput("25", "image")).toBeTruthy();
        expect(routeSource).toContain(
          'setNodeInput(workflow, "25", "image", upload.name);',
        );
        expect(routeSource).toContain(
          "frontUsesMaster: true",
        );
        expect(
          Object.values(
            {
              left: "47",
              right: "38",
              rear: "34",
              up: "41",
              down: "43",
            },
          ),
        ).not.toContain("25");
      },
    );

    it(
      "strengthens only the Multiple-Angles LoRA control",
      () => {
        expect(nodeInput("48:20", "lora_name")).toContain(
          "Multiple-angles",
        );
        expect(routeSource).toMatch(
          /"48:20",\s*"strength_model",\s*1\.25/,
        );
      },
    );
  },
);
