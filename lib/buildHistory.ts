import history from "@/config/build-history.json";

export const BUILD_VERSION = history.current;
export const BUILD_HISTORY = history.builds;
export type BuildIdentity = {
  buildVersion: string;
  softwareVersion: string;
  commit: string | null;
  releaseName: string | null;
  builtAt: string | null;
  history: typeof BUILD_HISTORY;
};
