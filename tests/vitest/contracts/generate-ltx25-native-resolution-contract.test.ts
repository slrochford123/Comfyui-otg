import { describe, expect, it } from "vitest";

import {
  VIDEO_GENERATE_FPS,
  VIDEO_GENERATE_SIZES,
} from "../../../lib/videoGenerateWorkflows";

describe("LTX 2.5 native Generate resolution contract", () => {
  it("uses native 64-aligned 720-class landscape dimensions", () => {
    expect(VIDEO_GENERATE_SIZES.landscape).toMatchObject({
      width: 1280,
      height: 704,
    });

    expect(VIDEO_GENERATE_SIZES.landscape.width % 64).toBe(0);
    expect(VIDEO_GENERATE_SIZES.landscape.height % 64).toBe(0);
  });

  it("uses native 64-aligned 720-class portrait dimensions", () => {
    expect(VIDEO_GENERATE_SIZES.portrait).toMatchObject({
      width: 704,
      height: 1280,
    });

    expect(VIDEO_GENERATE_SIZES.portrait.width % 64).toBe(0);
    expect(VIDEO_GENERATE_SIZES.portrait.height % 64).toBe(0);
  });

  it("keeps the canonical LTX 2.5 frame rate at 24 FPS", () => {
    expect(VIDEO_GENERATE_FPS).toBe(24);
  });
});
