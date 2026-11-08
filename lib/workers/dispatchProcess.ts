import fs from "node:fs";

/** Linux process identity, not just a reusable PID or a wall-clock timeout. */
export type DispatchProcess = { pid: number; startTicks: string; bootId: string };

export function readDispatchProcess(pid = process.pid): DispatchProcess {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  // comm may contain spaces or parentheses; field 22 follows the final ')'.
  const startTicks = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
  const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  if (!Number.isSafeInteger(pid) || pid < 1 || !/^\d+$/.test(startTicks) || !/^[a-f0-9-]{36}$/.test(bootId))
    throw Error("The submitting process identity could not be verified.");
  return { pid, startTicks, bootId };
}

/** Unreadable evidence never authorizes takeover of an in-flight submission. */
export function dispatchProcessState(saved: DispatchProcess): "alive" | "stopped" | "unknown" {
  if (!Number.isSafeInteger(saved.pid) || saved.pid < 1 || !/^\d+$/.test(saved.startTicks) || !/^[a-f0-9-]{36}$/.test(saved.bootId)) return "unknown";
  try {
    const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    if (bootId !== saved.bootId) return "stopped";
    const current = readDispatchProcess(saved.pid);
    return current.startTicks === saved.startTicks ? "alive" : "stopped";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "stopped" : "unknown";
  }
}
