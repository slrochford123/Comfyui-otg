import fs from "node:fs";
import path from "node:path";
import {
  describe,
  expect,
  it,
} from "vitest";

const root =
  process.cwd();

function read(
  relativePath: string,
) {
  return fs.readFileSync(
    path.join(
      root,
      relativePath,
    ),
    "utf8",
  );
}

describe(
  "Android PROD root route contract",
  () => {
    it(
      "redirects / to /app on the server instead of rendering a client-only redirect shell",
      () => {
        const page =
          read(
            "app/page.tsx",
          );

        expect(
          page,
        ).toContain(
          'from "next/navigation"',
        );

        expect(
          page,
        ).toContain(
          "redirect(\n    \"/app\"",
        );

        expect(
          page,
        ).not.toContain(
          "\"use client\"",
        );

        expect(
          page,
        ).not.toContain(
          "window.location.replace",
        );
      },
    );
  },
);
