import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3QualificationBridgeRoute } from "@/lib/h3QualificationBridgeRoute";
import { assertH3QualificationSharedAdmission } from "@/lib/h3QualificationSharedAdmission";

const mock = vi.hoisted(() => ({
  read: vi.fn<(handle: string | number) => string>(),
  realpath: vi.fn<(file: string) => string>(),
  lstat: vi.fn(),
  stat: vi.fn(),
  fstat: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));

vi.mock("node:fs", () => ({ default: {
  readFileSync: mock.read, realpathSync: mock.realpath, lstatSync: mock.lstat,
  statSync: mock.stat, fstatSync: mock.fstat, openSync: mock.open, closeSync: mock.close,
  constants: { O_RDONLY: 0, O_NOFOLLOW: 131072, O_NONBLOCK: 2048 },
} }));

const route: H3QualificationBridgeRoute = { build: "isolated-test-build-probe", environment: "TEST", port: 3001, pid: 476 };
const canonical = "/trusted/current-admission.json";
const helper = "/trusted/authority/media-gpu-admission.py";
const ledgerPath = "/trusted/authority/admission.sqlite";
const authorityId = "8d6609dc-1e88-4d3b-8975-dc03313f2709";
const env = (overrides: string[] = []) => ["OTG_ENV=test", "PORT=3001", `OTG_MEDIA_ADMISSION_CONFIG=${canonical}`, "AUTH_SECRET=keep-private", ...overrides].join("\0");
const metadata = () => ({ dev: 1, ino: 2, size: 148, uid: process.getuid?.(), mode: 0o100600, mtimeMs: 3, ctimeMs: 3, isFile: () => true });
const valid = () => JSON.stringify({ mode: "local", authorityId, script: helper });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OTG_ENV", "test");
  vi.stubEnv("OTG_MEDIA_ADMISSION_CONFIG", canonical);
  mock.read.mockImplementation(handle => typeof handle === "number" ? valid() : env());
  mock.realpath.mockImplementation(file => file);
  mock.lstat.mockImplementation(metadata);
  mock.fstat.mockImplementation(metadata);
  mock.stat.mockReturnValue({ isDirectory: () => true });
  mock.open.mockReturnValue(5);
});

afterEach(() => vi.unstubAllEnvs());

describe("exact local qualification admission authority", () => {
  it("accepts the protected authority already named by the verified TEST process", () => {
    expect(assertH3QualificationSharedAdmission(route)).toEqual({ configPath: canonical, authorityId, ledgerPath });
    expect(mock.read).toHaveBeenCalledWith("/proc/476/environ", "utf8");
    expect(mock.close).toHaveBeenCalledWith(5);
  });

  it("fails before reading the live process when the candidate has no authority", () => {
    vi.stubEnv("OTG_MEDIA_ADMISSION_CONFIG", "");
    expect(() => assertH3QualificationSharedAdmission(route)).toThrow(/has not verified/);
    expect(mock.read).not.toHaveBeenCalled();
  });

  it("rejects a copied config or a symlink that can be redirected after verification", () => {
    vi.stubEnv("OTG_MEDIA_ADMISSION_CONFIG", "/isolated/copied.json");
    expect(() => assertH3QualificationSharedAdmission(route)).toThrow(/has not verified/);
    expect(mock.open).not.toHaveBeenCalled();
    mock.realpath.mockImplementation(file => file === canonical ? "/isolated/changed-target.json" : file);
    vi.stubEnv("OTG_MEDIA_ADMISSION_CONFIG", canonical);
    expect(() => assertH3QualificationSharedAdmission(route)).toThrow(/has not verified/);
  });

  it("rejects duplicate canonical config declarations and the wrong environment", () => {
    mock.read.mockReturnValue(env([`OTG_MEDIA_ADMISSION_CONFIG=${canonical}`]));
    expect(() => assertH3QualificationSharedAdmission(route)).toThrow(/has not verified/);
    mock.read.mockReturnValue(env().replace("OTG_ENV=test", "OTG_ENV=prod"));
    expect(() => assertH3QualificationSharedAdmission(route)).toThrow(/has not verified/);
    expect(mock.open).not.toHaveBeenCalled();
  });

  it("rejects malformed or remote authorities and protects private values in errors", () => {
    for (const invalid of [{ mode: "ssh", authorityId, script: helper }, { mode: "local", authorityId: "private-value", script: helper }]) {
      mock.read.mockImplementation(handle => typeof handle === "number" ? JSON.stringify(invalid) : env());
      const expected = "The isolated candidate has not verified the canonical TEST shared RTX 3090 admission authority. No render was submitted.";
      expect(() => assertH3QualificationSharedAdmission(route)).toThrow(expected);
    }
  });

  it("rejects a changed config file and a missing or writeable shared ledger", () => {
    mock.fstat.mockReturnValueOnce({ ...metadata(), ino: 77 });
    expect(() => assertH3QualificationSharedAdmission(route)).toThrow(/has not verified/);
    mock.lstat.mockImplementation((file: string) => file === ledgerPath ? { ...metadata(), mode: 0o100666 } : metadata());
    expect(() => assertH3QualificationSharedAdmission(route)).toThrow(/has not verified/);
    mock.lstat.mockImplementation((file: string) => { if (file === ledgerPath) throw Error("absent"); return metadata(); });
    expect(() => assertH3QualificationSharedAdmission(route)).toThrow(/has not verified/);
  });
});
