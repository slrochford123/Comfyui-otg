import path from "node:path";
import os from "node:os";

/** Deployment-owned paths; never infer a developer account or TEST namespace. */
export function dataRoot() {
  return path.resolve(process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT || path.join(process.cwd(), "data"));
}
export function runtimePath(...parts: string[]) {
  return path.join(process.env.OTG_RUNTIME_ROOT || path.join(dataRoot(), "runtime"), ...parts);
}
export function configurationPath(filename: string) {
  return path.join(process.env.OTG_CONFIG_ROOT || path.join(dataRoot(), "config"), filename);
}
export function voicePython(runtime: string) {
  return runtimePath(runtime, "venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
}
export function sharedVoiceLockPath() {
  // Physical voice workers sharing a GPU must set the same explicit override.
  return process.env.OTG_VOICE_GPU_LOCK_FILE || path.join(os.tmpdir(), "slr-studios-voice-gpu.lock");
}
export function platformRuntimePath(windowsPath: string, ...parts: string[]) {
  return process.platform === "win32" ? windowsPath : runtimePath(...parts);
}
export function qualificationEnvironment(): "test" | "prod" | null {
  if (process.env.OTG_ENV === "test" || process.env.OTG_ENV === "prod") return process.env.OTG_ENV;
  return process.env.NODE_ENV === "test" ? "test" : null;
}
