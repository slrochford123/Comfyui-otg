import busboy from "busboy";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { RequestError } from "@/lib/requestError";
import { requireStorageHeadroom } from "@/lib/storageAdmission";

/** One bounded file, written with backpressure to an account-private staging directory. */
export async function receiveMediaUpload(request: Request, root: string, maxBytes = 750 * 1024 ** 2) {
  const claimed = Number(request.headers.get("content-length") || 0);
  if (claimed > maxBytes + 16384) throw new RequestError("Choose a media file up to 750 MB.", 413);
  if (!request.body) throw new RequestError("Choose a non-empty media file.", 400);
  requireStorageHeadroom(root, maxBytes * 2);
  let parser: ReturnType<typeof busboy>;
  try { parser = busboy({ headers: Object.fromEntries(request.headers), limits: { files: 1, fields: 2, parts: 3, fieldSize: 1024, fileSize: maxBytes, headerPairs: 32 } }); }
  catch { throw new RequestError("Invalid upload form.", 400); }
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, randomUUID() + ".upload");
  const fields: Record<string, string> = Object.create(null);
  let filename = "", bytes = 0, failure: Error | undefined;
  const writes: Promise<void>[] = [];
  const fail = (message: string, status = 400) => { failure ||= new RequestError(message, status); };
  parser.on("field", (key, value, info) => {
    if (key !== "session" || fields[key] !== undefined || info.valueTruncated || info.nameTruncated) fail("Invalid or duplicate upload field.");
    else fields[key] = value;
  });
  for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const) parser.on(event, () => fail("Upload exactly one media file and its session.", 413));
  parser.on("file", (key, stream, info) => {
    if (key !== "file" || filename || !/\.(mp4|webm|mov|mkv|wav|mp3|flac|ogg|m4a|aac)$/i.test(info.filename)) {
      fail("Choose one supported audio or video file."); stream.resume(); return;
    }
    filename = path.basename(info.filename).slice(0, 180);
    stream.on("limit", () => fail("Choose a media file up to 750 MB.", 413));
    writes.push(pipeline(stream, fs.createWriteStream(file, { flags: "wx", mode: 0o600 }), { signal: request.signal })
      .catch(error => { failure ||= error; parser.destroy(error); }));
  });
  const counter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > maxBytes + 16384) callback(new RequestError("Upload exceeds the server limit.", 413));
    else callback(null, chunk);
  } });
  const cleanup = () => fsp.unlink(file).catch(error => { if (error.code !== "ENOENT") throw error; });
  try {
    await pipeline(Readable.fromWeb(request.body as never), counter, parser, { signal: request.signal });
    await Promise.all(writes);
    if (failure) throw failure;
    if (!filename || !fields.session || !(await fsp.stat(file)).size) throw new RequestError("Choose a non-empty file and an existing session.", 400);
    return { file, filename, fields, cleanup };
  } catch (error) {
    await Promise.all(writes); await cleanup();
    if (failure instanceof RequestError) throw failure;
    if (error instanceof RequestError) throw error;
    throw new RequestError(request.signal.aborted ? "Upload canceled. Your existing media was retained." : "Upload interrupted or invalid. Retry the upload.", 400);
  }
}
