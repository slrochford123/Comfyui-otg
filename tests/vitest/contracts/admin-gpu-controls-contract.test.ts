import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("admin GPU controls TEST contract", () => {
  const route = read("app/api/admin/gpu-controls/route.ts");
  const panel = read("app/app/components/AdminGpuControls.tsx");
  const app = read("app/app/AppPageClient.tsx");
  const helper = read("scripts/otg-gpu-control");

  it("keeps the API admin-only and TEST-host gated", () => {
    expect(route).toContain("requireAdmin");
    expect(route).toContain("OTG_GPU_CONTROLS_ENABLED");
    expect(route).toContain("OTG_GPU_CONTROLS_HOSTNAME");
    expect(route).toContain("OTG_GPU_CONTROLS_ALLOWED_ORIGINS");
    expect(route).toContain("target === hostname()");
    expect(route).toContain("/usr/local/sbin/otg-gpu-control");
    expect(route).toContain('"/usr/bin/sudo"');
    expect(route).toContain('"-n"');
  });

  it("requires browser-origin protections for destructive actions", () => {
    expect(route).toContain('request.headers.get("origin")');
    expect(route).toContain("allowedOrigins.includes(origin)");
    expect(route).toContain('request.headers.get("x-otg-gpu-control") !== "1"');
    expect(route).toContain('request.headers.get("content-type")');
    expect(route).toContain("same-origin");
    expect(route).toContain("none");
    expect(route).toContain('action !== "free"');
    expect(route).toContain('action !== "reset"');
  });

  it("renders only for admin sessions in both app chrome modes", () => {
    expect(app).toContain('import AdminGpuControls from "./components/AdminGpuControls"');
    expect(app.match(/isAdmin \? <AdminGpuControls \/> : null/g)).toHaveLength(1);
    expect(app).toContain('data-otg="shared-app-header"');
    expect(panel).toContain("/api/admin/gpu-controls");
    expect(panel).toContain("Free VRAM");
    expect(panel).toContain("Reset ComfyUI");
    expect(panel).toContain("Busy workers are refused");
    expect(panel).toContain("Maintenance target GPU");
  });

  it("limits the installed helper to the two intended ComfyUI services", () => {
    expect(helper).toContain("service_core=otg-comfyui.service");
    expect(helper).toContain("service_h3=otg-comfyui-h3.service");
    expect(helper).toContain("comfyui-5060.service");
    expect(helper).toContain("systemctl stop");
    expect(helper).toContain("systemctl start");
    expect(helper).toContain("http://$candidate:$port/system_stats");
    expect(helper).toContain("http_state 8188");
    expect(helper).toContain("http_state 8189");
    expect(helper).toContain("hostname -I");
    expect(helper).toContain("grep -E '^100\\.'");
    expect(helper).not.toMatch(/\bpkill\b/);
    expect(helper).not.toMatch(/\bkillall\b/);
    expect(helper).not.toMatch(/\bnvidia-smi\b.*\|\s*xargs/);
  });

  it("treats the single-service 5060 profile as ready without an 8189 backend", () => {
    expect(helper).toContain("not-installed");
    expect(helper).toContain("not-applicable");
    expect(panel).toContain('services?.h38189.http === "not-applicable"');
  });
});
