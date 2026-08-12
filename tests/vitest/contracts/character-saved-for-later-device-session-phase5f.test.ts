// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/api/characters/saved-for-later/route.ts",
  ),
  "utf8",
);

describe(
  "Saved for Later Character device session Phase 5f",
  () => {
    it("does not introduce a separate owner session requirement", () => {
      expect(route).not.toContain(
        "getOwnerContext",
      );

      expect(route).not.toContain(
        "SessionInvalidError",
      );
    });

    it("uses the same Character device header contract as the UI", () => {
      expect(route).toContain(
        'request.headers.get("x-otg-device-id")',
      );

      expect(route).toContain(
        "deviceIdForRequest",
      );
    });

    it("bridges the device id into a same-origin cookie for img requests", () => {
      expect(route).toContain(
        "otg_character_device_id",
      );

      expect(route).toContain(
        "response.cookies.set",
      );

      expect(route).toContain(
        'sameSite: "lax"',
      );

      expect(route).toContain(
        'path: "/"',
      );
    });

    it("keeps saved assets outside the normal Gallery", () => {
      expect(route).toContain(
        '"characters",\n  "saved-for-later"',
      );

      expect(route).not.toContain(
        "/api/gallery",
      );
    });
  },
);
