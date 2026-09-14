import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const migratedTargets = [
  "app/api/ollama-ai/chat/route.ts",
  "app/api/ollama-ai/plan/route.ts",
  "app/api/ollama-ai/write/route.ts",
  "app/api/storyboard/batch-generate/route.ts",
  "app/api/storyboard/format/route.ts",
  "app/api/vision-prompt/route.ts",
  "app/api/format-prompt/route.ts",
  "app/api/enhance/route.ts",
  "app/api/enhance-prompt/route.ts",
  "app/api/characters/enhance-description/route.ts",
  "lib/storyboard/ollama.ts",
];

function walkTsFiles(
  root: string,
): string[] {
  const output: string[] = [];

  function visit(
    directory: string,
  ) {
    for (
      const entry
      of fs.readdirSync(
        directory,
        {
          withFileTypes: true,
        },
      )
    ) {
      const absolute =
        path.join(
          directory,
          entry.name,
        );

      if (
        entry.isDirectory()
      ) {
        visit(
          absolute,
        );

        continue;
      }

      if (
        entry.isFile()
        && entry.name.endsWith(
          ".ts",
        )
      ) {
        output.push(
          absolute,
        );
      }
    }
  }

  visit(
    path.join(
      process.cwd(),
      root,
    ),
  );

  return output;
}

describe(
  "application Qwen durable caller migration",
  () => {
    it(
      "routes Batch A Qwen callers through qwenDurableFetch",
      () => {
        for (
          const relative
          of migratedTargets
        ) {
          const source =
            fs.readFileSync(
              path.join(
                process.cwd(),
                relative,
              ),
              "utf8",
            );

          expect(
            source,
            relative,
          ).toContain(
            'from "@/lib/workers/qwenDurableFetch"',
          );

          expect(
            source,
            relative,
          ).toContain(
            "qwenDurableFetch(",
          );

          expect(
            source,
            relative,
          ).not.toContain(
            "qwenClusterFetch(",
          );
        }
      },
    );

    it(
      "leaves direct cluster execution only at the physical router primitive",
      () => {
        const allowed = [
          "lib/workers/qwenClusterRouter.ts",
        ].sort();

        const direct =
          [
            ...walkTsFiles(
              "app",
            ),
            ...walkTsFiles(
              "lib",
            ),
          ]
            .filter(
              (absolute) => {
                const source =
                  fs.readFileSync(
                    absolute,
                    "utf8",
                  );

                return source.includes(
                  "qwenClusterFetch(",
                );
              },
            )
            .map(
              (absolute) =>
                path.relative(
                  process.cwd(),
                  absolute,
                ),
            )
            .sort();

        expect(
          direct,
        ).toEqual(
          allowed,
        );
      },
    );
  },
);
