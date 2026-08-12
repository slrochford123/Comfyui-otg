import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(process.cwd(), "app/api/background-angle-plate/route.ts"),
  "utf8",
);

describe("Background Studio angle-plate configured backend", () => {
  it("uses the configured Linux multiview/image backend before loopback", () => {
    expect(routeSource).toContain("OTG_BACKGROUND_ANGLE_PLATE_CONFIGURED_BACKEND_V36AL");
    const multiview = routeSource.indexOf("process.env.OTG_ANGLES_MULTIVIEW_COMFY_URL");
    const image = routeSource.indexOf("process.env.OTG_ANGLES_IMAGE_COMFY_URL");
    const loopback = routeSource.indexOf('"http://127.0.0.1:8188"');
    expect(multiview).toBeGreaterThan(-1);
    expect(image).toBeGreaterThan(-1);
    expect(loopback).toBeGreaterThan(multiview);
    expect(loopback).toBeGreaterThan(image);
  });

  it("reports the exact upload and prompt endpoint when a fetch fails", () => {
    expect(routeSource).toContain("Could not reach angle-plate ComfyUI upload endpoint");
    expect(routeSource).toContain("Could not reach angle-plate ComfyUI prompt endpoint");
    expect(routeSource).toContain("error?.cause?.message");
  });
});
