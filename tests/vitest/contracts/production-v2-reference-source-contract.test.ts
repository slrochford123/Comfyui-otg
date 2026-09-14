import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const resolverSource =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "lib/production/referenceResolver.ts",
    ),
    "utf8",
  );

const panelSource =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "app/app/components/ProductionV2Panel.tsx",
    ),
    "utf8",
  );

const domainSource =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "lib/production/v2.ts",
    ),
    "utf8",
  );

describe(
  "Production V2 model-facing reference sources",
  () => {
    it(
      "uses the saved Character Card as the H3 R2V Character source",
      () => {
        expect(
          resolverSource,
        ).toContain(
          "character.characterCardRef",
        );

        expect(
          resolverSource,
        ).toContain(
          '"character-card" as const',
        );

        expect(
          resolverSource,
        ).toContain(
          '"character-card"',
        );
      },
    );

    it(
      "keeps Character selector display separate from its model-facing Character Card",
      () => {
        expect(
          panelSource,
        ).toMatch(
          /visualReference\(\s*"character",\s*item\.id,\s*item\.name,\s*item\.defaultImage,\s*item\.characterCard,?\s*\)/s,
        );

        expect(
          panelSource,
        ).toMatch(
          /displayImage:\s*displayImage\.displayImage\s*\|\|\s*displayImage\.workflowImage/s,
        );

        expect(
          panelSource,
        ).toMatch(
          /workflowImage:\s*generationImage\.workflowImage\s*\|\|\s*generationImage\.displayImage/s,
        );
      },
    );

    it(
      "prevents Character selector images from silently becoming model inputs",
      () => {
        expect(
          domainSource,
        ).toContain(
          "OTG_PRODUCTION_V2_H3_I2V_STARTING_IMAGE_CONTRACT_V1",
        );

        expect(
          domainSource,
        ).toContain(
          "assertProductionV2H3StartingImage(",
        );

        expect(
          domainSource,
        ).toMatch(
          /reference\.sourceKind === "character"[\s\S]*?reference\.generationSourceType[\s\S]*?!== "character-card"/,
        );

        expect(
          domainSource,
        ).toMatch(
          /item\.characterCardRef\.workflowImage\s*\|\|\s*item\.characterCardRef\.displayImage/,
        );
      },
    );

    it(
      "renders Character cards without cropping full-body selector images",
      () => {
        expect(
          panelSource,
        ).toContain(
          'const viewportClass = entityType === "Character" ? "aspect-[2/3]"',
        );

        expect(
          panelSource,
        ).toContain(
          'contain ? "object-contain p-3" : "object-cover"',
        );
      },
    );

    it(
      "uses the saved Asset default image as the deterministic Asset source",
      () => {
        expect(
          domainSource,
        ).toContain(
          "defaultImageRef: ProductionV2EntityImage",
        );

        expect(
          resolverSource,
        ).toContain(
          '"asset-default"',
        );
      },
    );

    it(
      "keeps Background master image and directional catalog assets distinct",
      () => {
        expect(
          domainSource,
        ).toContain(
          "masterImageRef: ProductionV2EntityImage",
        );

        expect(
          resolverSource,
        ).toContain(
          '"background-master"',
        );
      },
    );
  },
);
