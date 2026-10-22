import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(
    path.join(root, relativePath),
    "utf8",
  );
}

const v2Dir = path.join(
  root,
  "app/app/components/storyCreatorV2",
);

const componentFiles = [
  "StoryCreatorHeader.tsx",
  "StoryCreatorStageTabs.tsx",
  "StoryStudioShell.tsx",
  "IdeasTab.tsx",
  "BibleTab.tsx",
  "DesignTab.tsx",
  "WriteTab.tsx",
  "ProductionPlanner.tsx",
  "ProduceTab.tsx",
  "CanonApprovalQueue.tsx",
  "ConflictReviewPanel.tsx",
  "CharacterDesignPanel.tsx",
  "VoiceDesignPanel.tsx",
  "StoryAssetGrid.tsx",
] as const;

const panel = read(
  "app/app/components/StoryCreatorPanel.tsx",
);

const tabs = read(
  "app/app/components/storyCreatorV2/StoryCreatorStageTabs.tsx",
);

const studioShell = read(
  "app/app/components/storyCreatorV2/StoryStudioShell.tsx",
);

const ideas = read(
  "app/app/components/storyCreatorV2/IdeasTab.tsx",
);

const bible = read(
  "app/app/components/storyCreatorV2/BibleTab.tsx",
);

const design = read(
  "app/app/components/storyCreatorV2/DesignTab.tsx",
);

const write = read(
  "app/app/components/storyCreatorV2/WriteTab.tsx",
);

const planner = read(
  "app/app/components/storyCreatorV2/ProductionPlanner.tsx",
);

const produce = read(
  "app/app/components/storyCreatorV2/ProduceTab.tsx",
);

const store = read("lib/storyCreator/store.ts");

const v2Sources = componentFiles
  .map((file) => read(`app/app/components/storyCreatorV2/${file}`))
  .join("\n");

describe("Story Creator V2 shell contract", () => {
  it("creates the V2 component directory", () => {
    expect(fs.existsSync(v2Dir)).toBe(true);

    for (const file of componentFiles) {
      expect(
        fs.existsSync(path.join(v2Dir, file)),
      ).toBe(true);
    }
  });

  it("retains the legacy five-stage definitions for compatibility", () => {
    expect(tabs).toContain("export type StoryCreatorStage");
    expect(tabs).toContain('| "ideas"');
    expect(tabs).toContain('| "bible"');
    expect(tabs).toContain('| "design"');
    expect(tabs).toContain('| "write"');
    expect(tabs).toContain('| "produce"');

    const orderedLabels = [
      'label: "Ideas"',
      'label: "Bible"',
      'label: "Design"',
      'label: "Write"',
      'label: "Produce"',
    ];

    const positions = orderedLabels.map((label) =>
      tabs.indexOf(label),
    );

    expect(positions.every((index) => index >= 0)).toBe(true);
    expect(positions).toEqual(
      [...positions].sort((a, b) => a - b),
    );
  });

  it("keeps StoryCreatorPanel as the selected-project controller", () => {
    expect(panel).toContain(
      "const [selectedProjectId, setSelectedProjectId]",
    );
    expect(panel).toContain(
      "const selectedProject = useMemo",
    );
    expect(panel).toContain(
      'useState<StoryCreatorStage>("ideas")',
    );
    expect(panel).toContain("<StoryStudioShell");
    expect(panel).toContain(
      "project={selectedProject}",
    );
    expect(panel).not.toContain(
      "selectedIdeasProjectId",
    );
    expect(panel).not.toContain(
      "selectedBibleProjectId",
    );
  });

  it("presents one unified Story Studio instead of five primary tabs", () => {
    expect(panel).not.toContain("<StoryCreatorStageTabs");
    expect(studioShell).toContain("Story Director");
    expect(studioShell).toContain("Story Memory");
    expect(studioShell).toContain("Production Studio");
    expect(studioShell).toContain('id: "automatic"');
    expect(studioShell).toContain('id: "assisted"');
    expect(studioShell).toContain('id: "manual"');
    expect(studioShell).toContain("Paid or GPU-intensive work still");
    expect(studioShell).toContain('aria-label="Close Story Memory"');
  });

  it("keeps Ideas connected to existing Story Director behavior", () => {
    expect(panel).toContain("/api/story-creator/messages");
    expect(panel).toContain("persistMessage");
    expect(panel).toContain("loadStoryMessages");
    expect(panel).toContain("/api/ollama-ai/chat");
    expect(panel).toContain('"story-helper"');
    expect(ideas).toContain("Story Director Conversation");
    expect(ideas).toContain("Review Story Details");
    expect(ideas).toContain("Open Questions");
  });

  it("keeps Bible connected to existing Bible state and APIs", () => {
    expect(panel).toContain("/api/story-creator/bible?projectId=");
    expect(panel).toContain("loadStoryBible");
    expect(panel).toContain("storyBibleEntities");
    expect(panel).toContain("storyBibleFacts");
    expect(panel).toContain("storyBibleFactsByStatus.canon");
    expect(panel).toContain("storyBiblePendingFacts");
    expect(panel).not.toContain("CanonApprovalQueue");

    expect(bible).toContain("Characters");
    expect(bible).toContain("Locations");
    expect(bible).toContain("Organizations and factions");
    expect(bible).toContain("Powers and abilities");
    expect(bible).toContain("Timeline");
    expect(bible).toContain("Canon Library");
    expect(bible).toContain("Back to Story Director");

    expect(
      fs.existsSync(
        path.join(
          root,
          "app/api/story-creator/bible/write/route.ts",
        ),
      ),
    ).toBe(true);
  });

  it("keeps Design and Produce shells while Write is functional", () => {
    expect(design).toContain("CharacterDesignPanel");
    expect(design).toContain("StoryAssetGrid");
    expect(design).toContain("VoiceDesignPanel");
    expect(write).toContain("Story Outline");
    expect(write).toContain("Approved Canon Only");
    expect(write).toContain(
      "Story Creator writing uses approved canon by default",
    );
    expect(write).toContain("Generate from canon");
    expect(produce).toContain("Storyboard");
    expect(produce).toContain("Shot List");
    expect(produce).toContain("Reference Pack");
    expect(produce).toContain("5-Second Preview");
    expect(produce).toContain("Production Handoff");
    expect(produce).toContain("MiniMax H3");
  });

  it("adds reviewable production planning without auto-starting generation", () => {
    expect(studioShell).toContain('label: "Plan & Write"');
    expect(panel).toContain("<ProductionPlanner");
    expect(panel).toContain('/api/story-creator/production-plan');
    expect(planner).toContain("Create AI Plan");
    expect(planner).toContain("Start Manually");
    expect(planner).toContain("Approve Plan");
    expect(planner).toContain("Planning does not generate");
    expect(planner).not.toContain("/api/h3/");
    expect(planner).not.toContain("/api/story-creator/generation");
  });

  it("keeps generation behind explicit V2 APIs", () => {
    expect(v2Sources).toContain("SpeechInputButton");
    expect(v2Sources).toContain("onLoadDesignContext");
    expect(v2Sources).toContain("Generate From Story");
    expect(v2Sources).toContain("Approve as canon");
    expect(v2Sources).not.toContain("/api/story-creator/generation");
  });

  it("keeps existing canon protections intact", () => {
    expect(store).toContain(
      "STORY_BIBLE_ASSISTANT_CANON_FORBIDDEN",
    );
    expect(store).toContain(
      "STORY_BIBLE_SYSTEM_CANON_FORBIDDEN",
    );
    expect(store).toContain(
      "trg_story_facts_non_user_canon",
    );
    expect(store).toContain("NEW.source_role <> 'user'");
    expect(store).toContain(
      "STORY_BIBLE_NON_USER_CANON_FORBIDDEN",
    );
  });
});
