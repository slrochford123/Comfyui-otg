import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TranscribeResult = {
  ok: boolean;
  text?: string;
  transcript?: string;
  error?: string;
  detail?: string;
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function pythonCandidates(): string[] {
  const explicit = cleanText(process.env.OTG_TRANSCRIBE_PYTHON);
  const candidates = [
    explicit,
    process.platform === "win32" ? "py" : "",
    "python",
    "python3",
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}

function runPythonTranscriber(audioPath: string, repoRoot: string): Promise<TranscribeResult> {
  const scriptPath = path.join(repoRoot, "scripts", "python", "transcribe_audio.py");
  const model = cleanText(process.env.OTG_TRANSCRIBE_MODEL) || "base";
  const timeoutMs = Math.max(15000, Number(process.env.OTG_TRANSCRIBE_TIMEOUT_MS || 120000));

  return new Promise(async (resolve) => {
    const candidates = pythonCandidates();
    let lastError = "";

    for (const pythonExe of candidates) {
      const args = pythonExe === "py"
        ? ["-3", scriptPath, audioPath, "--model", model]
        : [scriptPath, audioPath, "--model", model];

      try {
        const child = spawn(pythonExe, args, {
          cwd: repoRoot,
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
          },
        });

        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString("utf8");
        });

        const code = await new Promise<number | null>((done) => {
          child.on("error", (error) => {
            lastError = error.message;
            done(-1);
          });
          child.on("close", (exitCode) => done(exitCode));
        });

        clearTimeout(timer);

        if (code === 0) {
          const parsed = JSON.parse(stdout || "{}");
          const text = cleanText(parsed.text || parsed.transcript);
          if (text) {
            resolve({ ok: true, text, transcript: text });
            return;
          }
          lastError = "Transcriber returned no text.";
        } else {
          lastError = cleanText(stderr) || cleanText(stdout) || `${pythonExe} exited with ${code}`;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    resolve({
      ok: false,
      error: "Local transcription failed.",
      detail: lastError || "No Python transcriber could run.",
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  let tempDir = "";

  try {
    const formData = await request.formData();
    const file = formData.get("audio");

    if (!(file instanceof File)) {
      return Response.json(
        { ok: false, error: "Missing audio file field named audio." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    if (!arrayBuffer.byteLength) {
      return Response.json(
        { ok: false, error: "Uploaded audio file is empty." },
        { status: 400 }
      );
    }

    tempDir = path.join(os.tmpdir(), `otg-transcribe-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });

    const safeName = cleanText(file.name).replace(/[^\w.\-]+/g, "_") || "voice-actor-input.webm";
    const audioPath = path.join(tempDir, safeName);
    await writeFile(audioPath, Buffer.from(arrayBuffer));

    const repoRoot = process.cwd();
    const result = await runPythonTranscriber(audioPath, repoRoot);

    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          error: result.error || "Transcription failed.",
          detail:
            result.detail ||
            "Install local transcription dependencies: py -3 -m pip install faster-whisper",
        },
        { status: 500 }
      );
    }

    return Response.json({
      ok: true,
      text: result.text,
      transcript: result.transcript || result.text,
      provider: "local-python-whisper",
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Transcription failed.",
      },
      { status: 500 }
    );
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
