import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
const ACTIVE_FILE = path.join(DATA_DIR, "active_device.json");

export async function setActiveDevice(deviceId: string) {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      ACTIVE_FILE,
      JSON.stringify({ deviceId, updatedAt: Date.now() }, null, 2),
      "utf-8"
    );
  } catch {}
}

export async function getActiveDevice(): Promise<string> {
  try {
    const raw = await fs.readFile(ACTIVE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return String(parsed.deviceId || "local");
  } catch {
    return "local";
  }
}
