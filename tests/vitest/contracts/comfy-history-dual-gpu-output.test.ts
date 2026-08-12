import { afterEach, describe, expect, it, vi } from "vitest";
import {
  candidateComfyImageBaseUrls,
  extractComfyHistoryImages,
  matchesComfyHistoryImageRequest,
  resolveComfyHistoryImage,
} from "../../../lib/comfyImageOutputLookup";

const ENV_KEYS = [
  "OTG_IMAGE_COMFY_URL",
  "COMFYUI_IMAGE_URL",
  "IMAGE_COMFY_BASE_URL",
  "COMFY_IMAGE_BASE_URL",
  "COMFYUI_IMAGE_BASE_URL",
  "COMFYUI_BASE_URL",
  "COMFY_BASE_URL",
  "NEXT_PUBLIC_COMFY_IMAGE_BASE_URL",
  "NEXT_PUBLIC_COMFY_BASE_URL",
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearConfiguredImageUrls() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("multi-backend ComfyUI image output lookup", () => {
  it("checks local image backends before the installation-specific remotes by default", () => {
    clearConfiguredImageUrls();
    expect(candidateComfyImageBaseUrls()).toEqual([
      "http://127.0.0.1:8188",
      "http://127.0.0.1:8288",
      "http://192.168.1.113:8188",
      "http://100.75.162.64:8188",
    ]);
  });

  it("moves an allowed successful backend to the front for the image proxy request", () => {
    clearConfiguredImageUrls();
    expect(candidateComfyImageBaseUrls("http://100.75.162.64:8188/")).toEqual([
      "http://100.75.162.64:8188",
      "http://127.0.0.1:8188",
      "http://127.0.0.1:8288",
      "http://192.168.1.113:8188",
    ]);
  });

  it("does not accept an arbitrary preferred endpoint", () => {
    clearConfiguredImageUrls();
    expect(candidateComfyImageBaseUrls("http://example.invalid:8188")).toEqual([
      "http://127.0.0.1:8188",
      "http://127.0.0.1:8288",
      "http://192.168.1.113:8188",
      "http://100.75.162.64:8188",
    ]);
  });

  it("keeps configured backends first and deduplicates normalized URLs", () => {
    clearConfiguredImageUrls();
    process.env.OTG_IMAGE_COMFY_URL = "http://configured-image.internal:8188/";
    process.env.COMFY_BASE_URL = "http://configured-image.internal:8188";

    expect(candidateComfyImageBaseUrls()).toEqual([
      "http://configured-image.internal:8188",
      "http://127.0.0.1:8188",
      "http://127.0.0.1:8288",
      "http://192.168.1.113:8188",
      "http://100.75.162.64:8188",
    ]);
  });

  it("extracts and filters output images by node and filename prefix", () => {
    const images = extractComfyHistoryImages(
      {
        "prompt-1": {
          outputs: {
            "33": {
              images: [
                { filename: "Boogu_00001_.png", subfolder: "", type: "output" },
              ],
            },
          },
        },
      },
      "prompt-1",
    );

    expect(images).toHaveLength(1);
    expect(matchesComfyHistoryImageRequest(images[0], {
      nodeId: "33",
      filenamePrefix: "Boogu",
    })).toBe(true);
  });

  it("continues to the second GPU when the first GPU has no image", async () => {
    clearConfiguredImageUrls();
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.startsWith("http://100.75.162.64:8188")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          "prompt-2": {
            outputs: {
              "33": {
                images: [
                  { filename: "Boogu_00002_.png", subfolder: "", type: "output" },
                ],
              },
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveComfyHistoryImage({
      promptId: "prompt-2",
      filters: { nodeId: "33", filenamePrefix: "Boogu" },
    });

    expect(resolved.baseUrl).toBe("http://100.75.162.64:8188");
    expect(resolved.image?.filename).toBe("Boogu_00002_.png");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
