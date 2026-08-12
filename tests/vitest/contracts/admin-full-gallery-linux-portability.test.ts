// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  adminGallerySourceById,
  listAdminGallery,
} from "@/lib/adminGallerySources";

const temporaryRoots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();

  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

describe("Admin Full Gallery dual-Linux transport", () => {
  it("preserves local 3090 plus remote 5060", () => {
    vi.stubEnv(
      "OTG_ADMIN_GALLERY_3090_ROOT",
      "/tmp/local-3090",
    );
    vi.stubEnv(
      "OTG_ADMIN_GALLERY_3090_URL",
      "",
    );
    vi.stubEnv(
      "OTG_ADMIN_GALLERY_5060_ROOT",
      "",
    );
    vi.stubEnv(
      "OTG_ADMIN_GALLERY_5060_URL",
      "http://100.98.212.116:8798",
    );

    expect(
      adminGallerySourceById("comfy-3090").kind,
    ).toBe("local");

    expect(
      adminGallerySourceById("comfy-5060").kind,
    ).toBe("remote-agent");
  });

  it("supports remote 3090 plus local 5060", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "otg-5060-gallery-"),
    );

    temporaryRoots.push(root);

    fs.writeFileSync(
      path.join(root, "local-5060.png"),
      "png",
    );

    vi.stubEnv(
      "OTG_ADMIN_GALLERY_3090_ROOT",
      "",
    );
    vi.stubEnv(
      "OTG_ADMIN_GALLERY_3090_URL",
      "http://100.75.162.64:8798",
    );
    vi.stubEnv(
      "OTG_ADMIN_GALLERY_3090_TOKEN",
      "test-token",
    );
    vi.stubEnv(
      "OTG_ADMIN_GALLERY_5060_URL",
      "",
    );
    vi.stubEnv(
      "OTG_ADMIN_GALLERY_5060_ROOT",
      root,
    );

    expect(
      adminGallerySourceById("comfy-3090").kind,
    ).toBe("remote-agent");

    expect(
      adminGallerySourceById("comfy-5060").kind,
    ).toBe("local");

    const result = await listAdminGallery({
      source: "comfy-5060",
      limit: 20,
    });

    expect(result.ok).toBe(true);
    expect(result.items.map((item) => item.name))
      .toEqual(["local-5060.png"]);
  });
});
