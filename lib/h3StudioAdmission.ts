import { qualificationEnvironment } from "@/lib/runtime/configPaths";

/** Ordinary PROD generation is not a TEST experiment or a qualification run. */
export function h3StudioProduction() { return qualificationEnvironment() === "prod"; }
export function assertH3StudioAvailable() {
  if (!["test", "prod"].includes(qualificationEnvironment() || "")) {
    throw Object.assign(new Error("H3 Studio deployment is not configured."), { status: 404 });
  }
}
