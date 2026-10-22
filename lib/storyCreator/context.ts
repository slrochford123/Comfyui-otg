import {
  listPendingStoryBibleFacts,
  listStoryAssets,
  listStoryBibleEntities,
  listStoryBibleFacts,
  listStoryCreatorProjects,
  listStoryOpenQuestions,
  listStoryVisualAssets,
} from "./store";

const DEFAULT_CONTEXT_CHAR_LIMIT = 12_000;
const COMMON_WORDS = new Set([
  "about",
  "after",
  "again",
  "could",
  "from",
  "have",
  "into",
  "make",
  "scene",
  "should",
  "story",
  "that",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
]);

function terms(value: string) {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9'-]{3,}/g)
      ?.filter((word) => !COMMON_WORDS.has(word)) || [],
  );
}

function relevance(value: string, queryTerms: Set<string>) {
  if (!queryTerms.size) return 0;

  const candidateTerms = terms(value);
  let score = 0;
  for (const term of queryTerms) {
    if (candidateTerms.has(term)) score += 3;
    else if (value.toLowerCase().includes(term)) score += 1;
  }
  return score;
}

function ranked<T>(
  items: T[],
  query: string,
  searchable: (item: T) => string,
  updatedAt: (item: T) => number,
) {
  const queryTerms = terms(query);
  return [...items].sort((left, right) => {
    const scoreDifference =
      relevance(searchable(right), queryTerms) -
      relevance(searchable(left), queryTerms);
    if (scoreDifference) return scoreDifference;
    return updatedAt(right) - updatedAt(left);
  });
}

function boundedSections(
  sections: Array<{ title: string; lines: string[] }>,
  maxChars: number,
) {
  const output: string[] = [];
  let used = 0;

  for (const section of sections) {
    if (!section.lines.length) continue;

    const heading = `${section.title}:`;
    if (used + heading.length + 2 > maxChars) break;
    output.push(heading);
    used += heading.length + 1;

    for (const line of section.lines) {
      const next = `- ${line}`;
      if (used + next.length + 1 > maxChars) break;
      output.push(next);
      used += next.length + 1;
    }

    output.push("");
    used += 1;
  }

  return output.join("\n").trim();
}

export function buildStoryDirectorProjectContext(input: {
  ownerKey: string;
  projectId: string;
  query: string;
  maxChars?: number;
}) {
  const projects = listStoryCreatorProjects(input.ownerKey);
  const project = projects.find((item) => item.id === input.projectId);
  if (!project) {
    const error = new Error("Story project was not found.") as Error & {
      status?: number;
      code?: string;
    };
    error.status = 404;
    error.code = "STORY_PROJECT_NOT_FOUND";
    throw error;
  }

  const entities = listStoryBibleEntities(input);
  const facts = listStoryBibleFacts(input);
  const pendingFacts = listPendingStoryBibleFacts(input);
  const assets = listStoryAssets(input);
  const visualAssets = listStoryVisualAssets(input);
  const openQuestions = listStoryOpenQuestions({
    ...input,
    status: "open",
  });
  const entityNames = new Map(
    entities.map((entity) => [entity.id, entity.name]),
  );

  const factText = (fact: (typeof facts)[number]) => {
    const subject = fact.subjectEntityId
      ? entityNames.get(fact.subjectEntityId) || "Unknown entity"
      : "Story";
    const object = fact.objectEntityId
      ? entityNames.get(fact.objectEntityId) || "Unknown entity"
      : "";
    const value = object || fact.valueText;
    return `${subject} | ${fact.predicate}${value ? ` | ${value}` : ""}`;
  };

  const canon = ranked(
    facts.filter((fact) => fact.canonStatus === "canon"),
    input.query,
    factText,
    (fact) => fact.updatedAt,
  );
  const proposals = ranked(
    pendingFacts,
    input.query,
    factText,
    (fact) => fact.updatedAt,
  );
  const unknowns = ranked(
    facts.filter((fact) => fact.canonStatus === "unknown"),
    input.query,
    factText,
    (fact) => fact.updatedAt,
  );
  const rankedAssets = ranked(
    assets,
    input.query,
    (asset) => `${asset.assetType} ${asset.name} ${asset.prompt}`,
    (asset) => asset.updatedAt,
  );
  const rankedQuestions = ranked(
    openQuestions,
    input.query,
    (question) => question.question,
    (question) => question.updatedAt,
  );

  const context = boundedSections(
    [
      {
        title: "PROJECT",
        lines: [
          `Title | ${project.title}`,
          ...(project.format ? [`Format | ${project.format}`] : []),
          ...(project.genre ? [`Genre | ${project.genre}`] : []),
        ],
      },
      {
        title: "APPROVED CANON - authoritative; preserve exactly",
        lines: canon.map(factText),
      },
      {
        title: "PROPOSED DETAILS - not canon unless the user approves",
        lines: proposals.slice(0, 30).map(factText),
      },
      {
        title: "UNKNOWN DETAILS - unresolved; do not invent answers",
        lines: unknowns.slice(0, 20).map(factText),
      },
      {
        title: "PROJECT ASSETS - references available to production",
        lines: rankedAssets.slice(0, 30).map(
          (asset) =>
            `${asset.assetType} | ${asset.name} | ${asset.status}`,
        ),
      },
      {
        title: "APPROVED VISUAL REFERENCES - preserve identity and appearance",
        lines: visualAssets.flatMap((asset) =>
          asset.versions
            .filter((version) => version.status === "approved")
            .map((version) => {
              const targets = asset.bindings
                .filter((binding) => binding.versionId === version.id)
                .map((binding) => [binding.bindingType, binding.role, binding.entityId, binding.sceneId, binding.shotId].filter(Boolean).join("/"))
                .join(", ");
              return `${asset.visualKind} | ${asset.name} | version ${version.version}${targets ? ` | ${targets}` : ""}`;
            }),
        ).slice(0, 40),
      },
      {
        title: "OPEN STORY QUESTIONS",
        lines: rankedQuestions
          .slice(0, 20)
          .map((question) => question.question),
      },
    ],
    Math.max(1_000, input.maxChars || DEFAULT_CONTEXT_CHAR_LIMIT),
  );

  return {
    context,
    counts: {
      canon: canon.length,
      proposals: proposals.length,
      unknowns: unknowns.length,
      assets: assets.length,
      openQuestions: openQuestions.length,
    },
  };
}
