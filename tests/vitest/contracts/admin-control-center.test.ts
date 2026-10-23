import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { checkService, getServiceRegistry } from "@/lib/services/registry";
afterEach(() => vi.unstubAllGlobals());
describe("Admin truthful health classification", () => {
  it("optional unconfigured services are not probed or falsely DOWN", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const registry = getServiceRegistry({});
    for (const id of ["hunyuan", "indextts2", "bg-remove", "omnivoice"] as const) expect((await checkService(registry[id])).state).toBe("NOT CONFIGURED");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("disabled is distinct from offline", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const registry = getServiceRegistry({ HUNYUAN_URL: "http://example.invalid", OTG_SERVICE_HUNYUAN_ENABLED: "false" });
    expect((await checkService(registry.hunyuan)).state).toBe("DISABLED"); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([[200, "HEALTHY"], [429, "DEGRADED"], [503, "DOWN"]])("HTTP %s classifies as %s", async (code, state) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: code })));
    expect((await checkService(getServiceRegistry({ HUNYUAN_URL: "http://example.invalid" }).hunyuan)).state).toBe(state);
  });
  it("connection failure is DOWN for a configured service", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    expect((await checkService(getServiceRegistry({ HUNYUAN_URL: "http://example.invalid" }).hunyuan)).state).toBe("DOWN");
  });
});
describe("mobile Admin and trim layout boundaries", () => {
  it("billing stacks columns rather than imposing a 320px second column", () => {
    const css = fs.readFileSync("app/app/admin/Admin.module.css", "utf8"), component = fs.readFileSync("app/app/admin/openai-billing/OpenAIBillingClient.tsx", "utf8");
    expect(css).toContain("max-width: 800px"); expect(css).toContain("grid-template-columns: minmax(0, 1fr)"); expect(component).not.toContain("minmax(320px"); expect(component).not.toContain('environment: "test"'); expect(component).toContain("Not configured"); expect(component).toContain("does not buy credits");
  });
  it("both logical GPU cards remain explicit and destructive maintenance confirmed", () => {
    const health = fs.readFileSync("app/admin/health/HealthClient.tsx", "utf8"), controls = fs.readFileSync("app/app/components/AdminGpuControls.tsx", "utf8");
    expect(health).toContain('fixedTarget="3090"'); expect(health).toContain('fixedTarget="5060ti"'); expect(controls).toContain("window.confirm(warning)"); expect(controls).toContain("operationRef.current");
  });
  it("legacy Admin pages use the same server-side guard", () => expect(fs.readFileSync("app/admin/layout.tsx", "utf8")).toContain("@/app/app/admin/layout"));
  it("trim UI has mobile-sized controls and does not replace native H3 workflow", () => {
    const component = fs.readFileSync("app/app/components/H3VideoEditPanel.tsx", "utf8");
    expect(component).toContain("Trim Selection"); expect(component).toContain("Use Full Video"); expect(component).toContain("min-h-11"); expect(component).not.toContain("Trim longer clips before selecting");
  });
});
