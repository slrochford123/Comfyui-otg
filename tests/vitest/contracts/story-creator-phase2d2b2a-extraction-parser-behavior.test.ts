import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseStoryBibleExtractionText,
} from "../../../lib/storyCreator/extraction";

const json = (
  value: unknown,
) => JSON.stringify(value);

describe(
  "Story Creator Phase 2D2B2A pure extraction parser behavior",
  () => {
    it(
      "accepts and normalizes valid suggestions and unknowns",
      () => {
        const result =
          parseStoryBibleExtractionText(
            json({
              entities: [
                {
                  ref: " e1 ",
                  entityType:
                    " character ",
                  name:
                    " Lena Hart ",
                },
              ],
              facts: [
                {
                  subjectRef: "E1",
                  predicate:
                    " residence ",
                  valueText:
                    " Springfield ",
                  canonStatus:
                    " Suggestion ",
                },
                {
                  subjectRef: "e1",
                  predicate:
                    "exact_age",
                  valueText: "",
                  canonStatus:
                    "unknown",
                },
              ],
            }),
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.value.entities,
        ).toEqual([
          {
            ref: "e1",
            entityType:
              "character",
            name: "Lena Hart",
          },
        ]);

        expect(
          result.value.facts,
        ).toHaveLength(2);

        expect(
          result.value.facts[0],
        ).toMatchObject({
          subjectRef: "e1",
          predicate:
            "residence",
          valueText:
            "Springfield",
          canonStatus:
            "suggestion",
        });

        expect(
          result.value.facts[1],
        ).toMatchObject({
          subjectRef: "e1",
          predicate:
            "exact_age",
          valueText: "",
          canonStatus:
            "unknown",
        });

        expect(
          result.value.rejectedEntities,
        ).toBe(0);

        expect(
          result.value.rejectedFacts,
        ).toBe(0);
      },
    );

    it(
      "accepts one exact JSON fence",
      () => {
        const body =
          json({
            entities: [],
            facts: [],
          });

        const result =
          parseStoryBibleExtractionText(
            "```json\n" +
              body +
              "\n```",
          );

        expect(result.ok).toBe(true);
      },
    );

    it(
      "rejects prose around fenced JSON",
      () => {
        const body =
          json({
            entities: [],
            facts: [],
          });

        expect(
          parseStoryBibleExtractionText(
            "Here is the extraction:\n" +
              "```json\n" +
              body +
              "\n```",
          ).ok,
        ).toBe(false);

        expect(
          parseStoryBibleExtractionText(
            "```json\n" +
              body +
              "\n```\nDone.",
          ).ok,
        ).toBe(false);
      },
    );

    it(
      "rejects malformed top-level JSON shapes",
      () => {
        expect(
          parseStoryBibleExtractionText(
            "not json",
          ).ok,
        ).toBe(false);

        expect(
          parseStoryBibleExtractionText(
            "[]",
          ).ok,
        ).toBe(false);

        expect(
          parseStoryBibleExtractionText(
            '{"entities":[]}',
          ).ok,
        ).toBe(false);

        expect(
          parseStoryBibleExtractionText(
            json({
              entities: {},
              facts: [],
            }),
          ).ok,
        ).toBe(false);
      },
    );

    it(
      "filters Canon and malformed facts",
      () => {
        const result =
          parseStoryBibleExtractionText(
            json({
              entities: [
                {
                  ref: "e1",
                  entityType:
                    "character",
                  name:
                    "Lena Hart",
                },
              ],
              facts: [
                {
                  subjectRef: "e1",
                  predicate:
                    "residence",
                  valueText:
                    "Springfield",
                  canonStatus:
                    "canon",
                },
                {
                  subjectRef: "e1",
                  predicate:
                    "goal",
                  valueText:
                    "Find her brother",
                  canonStatus:
                    "suggestion",
                },
                {
                  subjectRef: "e1",
                  predicate: 123,
                  valueText:
                    "bad",
                  canonStatus:
                    "suggestion",
                },
              ],
            }),
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.value.facts,
        ).toHaveLength(1);

        expect(
          result.value.facts[0]
            .predicate,
        ).toBe("goal");

        expect(
          result.value.rejectedFacts,
        ).toBe(2);

        expect(
          result.value.facts.some(
            (fact) =>
              (
                fact.canonStatus as string
              ) === "canon",
          ),
        ).toBe(false);
      },
    );

    it(
      "normalizes allowed entity types and rejects unknown types",
      () => {
        const result =
          parseStoryBibleExtractionText(
            json({
              entities: [
                {
                  ref: "e1",
                  entityType:
                    " Character ",
                  name: "Lena",
                },
                {
                  ref: "e2",
                  entityType:
                    "spaceship_person_thing",
                  name: "Bad Type",
                },
              ],
              facts: [],
            }),
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.value.entities,
        ).toEqual([
          {
            ref: "e1",
            entityType:
              "character",
            name: "Lena",
          },
        ]);

        expect(
          result.value.rejectedEntities,
        ).toBe(1);
      },
    );

    it(
      "rejects oversized fields rather than truncating them",
      () => {
        const result =
          parseStoryBibleExtractionText(
            json({
              entities: [
                {
                  ref: "e1",
                  entityType:
                    "x".repeat(81),
                  name: "Bad",
                },
                {
                  ref: "e2",
                  entityType:
                    "character",
                  name:
                    "x".repeat(161),
                },
                {
                  ref: "e3",
                  entityType:
                    "character",
                  name: "Good",
                },
              ],
              facts: [
                {
                  subjectRef: "e3",
                  predicate:
                    "x".repeat(161),
                  valueText: "bad",
                  canonStatus:
                    "suggestion",
                },
                {
                  subjectRef: "e3",
                  predicate:
                    "description",
                  valueText:
                    "x".repeat(
                      100_001,
                    ),
                  canonStatus:
                    "suggestion",
                },
                {
                  subjectRef: "e3",
                  predicate:
                    "mood",
                  valueText:
                    "uneasy",
                  canonStatus:
                    "suggestion",
                },
              ],
            }),
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.value.entities,
        ).toHaveLength(1);

        expect(
          result.value.entities[0].ref,
        ).toBe("e3");

        expect(
          result.value.rejectedEntities,
        ).toBe(2);

        expect(
          result.value.facts,
        ).toHaveLength(1);

        expect(
          result.value.rejectedFacts,
        ).toBe(2);
      },
    );

    it(
      "rejects facts pointing at unknown local refs",
      () => {
        const result =
          parseStoryBibleExtractionText(
            json({
              entities: [
                {
                  ref: "e1",
                  entityType:
                    "character",
                  name: "Lena",
                },
              ],
              facts: [
                {
                  subjectRef:
                    "missing",
                  predicate: "goal",
                  valueText:
                    "Escape",
                  canonStatus:
                    "suggestion",
                },
                {
                  subjectRef: "e1",
                  predicate: "goal",
                  valueText:
                    "Escape",
                  canonStatus:
                    "suggestion",
                },
              ],
            }),
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.value.facts,
        ).toHaveLength(1);

        expect(
          result.value.rejectedFacts,
        ).toBe(1);
      },
    );

    it(
      "allows only server-approved existing entity ids",
      () => {
        const result =
          parseStoryBibleExtractionText(
            json({
              entities: [],
              facts: [
                {
                  subjectEntityId:
                    "known-lena",
                  predicate: "goal",
                  valueText:
                    "Escape",
                  canonStatus:
                    "suggestion",
                },
                {
                  subjectEntityId:
                    "fabricated",
                  predicate: "goal",
                  valueText:
                    "Escape",
                  canonStatus:
                    "suggestion",
                },
              ],
            }),
            {
              knownEntityIds: [
                "known-lena",
              ],
            },
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.value.facts,
        ).toHaveLength(1);

        expect(
          result.value.facts[0]
            .subjectEntityId,
        ).toBe("known-lena");

        expect(
          result.value.rejectedFacts,
        ).toBe(1);
      },
    );

    it(
      "rejects conflicting local and existing references",
      () => {
        const result =
          parseStoryBibleExtractionText(
            json({
              entities: [
                {
                  ref: "e1",
                  entityType:
                    "character",
                  name: "Lena",
                },
              ],
              facts: [
                {
                  subjectRef: "e1",
                  subjectEntityId:
                    "known-lena",
                  predicate: "goal",
                  valueText:
                    "Escape",
                  canonStatus:
                    "suggestion",
                },
              ],
            }),
            {
              knownEntityIds: [
                "known-lena",
              ],
            },
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.value.facts,
        ).toHaveLength(0);

        expect(
          result.value.rejectedFacts,
        ).toBe(1);
      },
    );

    it(
      "requires suggestions to contain a value or object while allowing empty unknowns",
      () => {
        const result =
          parseStoryBibleExtractionText(
            json({
              entities: [
                {
                  ref: "e1",
                  entityType:
                    "character",
                  name: "Lena",
                },
              ],
              facts: [
                {
                  subjectRef: "e1",
                  predicate:
                    "residence",
                  valueText: "",
                  canonStatus:
                    "suggestion",
                },
                {
                  subjectRef: "e1",
                  predicate:
                    "residence",
                  valueText: "",
                  canonStatus:
                    "unknown",
                },
              ],
            }),
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.value.facts,
        ).toHaveLength(1);

        expect(
          result.value.facts[0]
            .canonStatus,
        ).toBe("unknown");

        expect(
          result.value.rejectedFacts,
        ).toBe(1);
      },
    );

    it(
      "rejects duplicate local refs case-insensitively",
      () => {
        const result =
          parseStoryBibleExtractionText(
            json({
              entities: [
                {
                  ref: "Hero",
                  entityType:
                    "character",
                  name: "Lena",
                },
                {
                  ref: "hero",
                  entityType:
                    "character",
                  name:
                    "Different Lena",
                },
              ],
              facts: [],
            }),
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.value.entities,
        ).toHaveLength(1);

        expect(
          result.value.rejectedEntities,
        ).toBe(1);
      },
    );
  },
);
