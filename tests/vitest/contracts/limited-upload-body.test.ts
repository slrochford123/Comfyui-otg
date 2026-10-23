import { describe, expect, it } from "vitest";
import { limitedFormData } from "@/lib/limitedRequestBody";
describe("bounded video upload parsing", () => {
  it("accepts valid multipart bytes within the cap", async () => {
    const form = new FormData(); form.set("name", "video.mp4");
    const result = await limitedFormData(new Request("http://example.invalid", { method: "POST", body: form }), 1000);
    expect(result.get("name")).toBe("video.mp4");
  });
  it("rejects declared oversized uploads before parsing", async () => {
    const request = new Request("http://example.invalid", { method: "POST", headers: { "Content-Length": "100000" }, body: "fake" });
    await expect(limitedFormData(request, 1000)).rejects.toThrow(/server limit/);
  });
  it("rejects actual oversized bytes even with a forged Content-Length", async () => {
    const request = new Request("http://example.invalid", { method: "POST", headers: { "Content-Length": "1" }, body: "oversized" });
    await expect(limitedFormData(request, 2)).rejects.toThrow(/server limit/);
  });
});
