import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

function getDataRoot() {
  return process.env.OTG_DATA_DIR
    ? path.resolve(process.env.OTG_DATA_DIR)
    : path.resolve(process.cwd(), "data");
}

const charactersRoot = () => path.join(getDataRoot(), "voices", "characters");

export async function GET() {
  const root = charactersRoot();
  if (!fs.existsSync(root)) {
    return NextResponse.json({ ok: true, characters: [] });
  }

  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  const characters = dirs
    .map((d) => {
      const profilePath = path.join(root, d.name, "profile.json");
      if (!fs.existsSync(profilePath)) return null;
      try {
        const json = JSON.parse(fs.readFileSync(profilePath, "utf8"));
        return {
          characterId: json.characterId ?? d.name,
          characterName: json.characterName ?? d.name,
          createdAt: json.createdAt ?? null,
          sourceAudioId: json.sourceAudioId ?? null,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, characters });
}
