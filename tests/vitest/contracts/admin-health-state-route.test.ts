import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: vi.fn(), services: vi.fn() }));
vi.mock("@/app/api/admin/_requireAdmin", () => ({ requireAdmin: m.admin }));
vi.mock("@/lib/services/registry", () => ({ getServiceRegistry: () => ({}), checkAllServices: m.services }));
beforeEach(() => vi.clearAllMocks());
describe("Admin health authorization and enabled-service denominator", () => {
  it.each([401, 403])("denies %s before any service probe", async status => {
    m.admin.mockResolvedValue({ ok: false, status, error: "Denied" });
    const { GET } = await import("@/app/api/admin/health/services/route");
    expect((await GET()).status).toBe(status); expect(m.services).not.toHaveBeenCalled();
  });
  it("does not count intentionally disabled/unconfigured services as failed enabled services", async () => {
    m.admin.mockResolvedValue({ ok: true });
    m.services.mockResolvedValue([
      { id: "required", required: true, enabled: true, configured: true, ok: true },
      { id: "optional", enabled: true, configured: false, ok: false },
      { id: "disabled", enabled: false, configured: true, ok: false },
    ]);
    const { GET } = await import("@/app/api/admin/health/services/route"); const result = await (await GET()).json();
    expect(result.summary).toMatchObject({ ok: 1, total: 1, notConfigured: 1, disabled: 1, requiredFailures: 0 });
  });
});
