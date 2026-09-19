import {
  readFileSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

const panel =
  readFileSync(
    "app/app/components/StoryCreatorPanel.tsx",
    "utf8",
  );

function extractedGenerator() {
  const startToken =
    "function newStoryClientTurnId() {";

  const endToken =
    "function pendingStoryTurnStorageKey(";

  const start =
    panel.indexOf(
      startToken,
    );

  const end =
    panel.indexOf(
      endToken,
      start,
    );

  if (
    start < 0 ||
    end < 0
  ) {
    throw new Error(
      "Could not extract newStoryClientTurnId.",
    );
  }

  const source =
    panel.slice(
      start,
      end,
    );

  return (
    windowValue: unknown,
  ) =>
    new Function(
      "window",
      `${source}
return newStoryClientTurnId();`,
    )(windowValue) as string;
}

describe(
  "Story Creator client turn IDs on HTTP",
  () => {
    it(
      "uses randomUUID when available",
      () => {
        const generate =
          extractedGenerator();

        const expected =
          "12345678-1234-4123-8123-123456789abc";

        expect(
          generate({
            crypto: {
              randomUUID() {
                return expected;
              },

              getRandomValues() {
                throw new Error(
                  "fallback should not run",
                );
              },
            },
          }),
        ).toBe(
          expected,
        );
      },
    );

    it(
      "falls back when randomUUID is unavailable",
      () => {
        const generate =
          extractedGenerator();

        const source =
          Uint8Array.from(
            Array.from(
              { length: 16 },
              (_, index) => index,
            ),
          );

        const result =
          generate({
            crypto: {
              getRandomValues(
                target: Uint8Array,
              ) {
                target.set(source);
                return target;
              },
            },
          });

        expect(
          result,
        ).toBe(
          "00010203-0405-4607-8809-0a0b0c0d0e0f",
        );
      },
    );

    it(
      "falls back when randomUUID throws",
      () => {
        const generate =
          extractedGenerator();

        const source =
          Uint8Array.from(
            Array.from(
              { length: 16 },
              (_, index) => index,
            ),
          );

        const result =
          generate({
            crypto: {
              randomUUID() {
                throw new Error(
                  "secure-context restriction",
                );
              },

              getRandomValues(
                target: Uint8Array,
              ) {
                target.set(source);
                return target;
              },
            },
          });

        expect(
          result,
        ).toBe(
          "00010203-0405-4607-8809-0a0b0c0d0e0f",
        );
      },
    );

    it(
      "fails closed without cryptographic randomness",
      () => {
        const generate =
          extractedGenerator();

        expect(
          () =>
            generate({
              crypto: {},
            }),
        ).toThrow(
          "Secure Story Director request IDs are unavailable in this browser.",
        );
      },
    );

    it(
      "sets UUID v4 version and RFC variant bits",
      () => {
        const generate =
          extractedGenerator();

        const result =
          generate({
            crypto: {
              getRandomValues(
                target: Uint8Array,
              ) {
                target.fill(0xff);
                return target;
              },
            },
          });

        expect(
          result,
        ).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      },
    );
  },
);
