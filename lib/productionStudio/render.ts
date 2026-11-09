import { spawn, execFile } from "node:child_process";
import {promisify} from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import {
  deliveryDimensions,
  timelineDuration,
  type ExportSettings,
  type Timeline,
} from "./model";
import { StudioError, type StudioStore, validateTimeline } from "./store";
import { assertAssetIntact, probe } from "./media";
import {activeAudio, audioFilters, audioPlacement, nativeVolume} from "./audioMix";

export function validateExport(value: unknown): ExportSettings {
  const v = value as ExportSettings;
  if (
    !v ||
    !["landscape", "portrait", "square"].includes(v.aspect) ||
    ![720, 1080].includes(v.resolution) ||
    ![24, 30].includes(v.fps) ||
    !["mp4", "webm"].includes(v.format)
  )
    throw new StudioError(
      "Choose a supported delivery size, frame rate and format.",
    );
  return {
    ...v,
    filename:
      String(v.filename || "production")
        .replace(/[^a-zA-Z0-9 _.-]/g, "_")
        .slice(0, 120)
        .replace(/\.(mp4|webm)$/i, "") || "production",
  };
}
/** CPU final rendering. Sources remain immutable; all edits live in a timeline snapshot. */
export async function renderTimeline(
  s: StudioStore,
  owner: string,
  project: string,
  timeline: Timeline,
  settings: ExportSettings,
  directory: string,
  report: (p: number) => void,
  canceled: () => boolean,
  audioOnly = false,
  originalComparison = false,
) {
  validateTimeline(
    timeline,
    new Set(s.assets(owner, project).map((a) => a.id)),
  );
  validateExport(settings);
  if (!timeline.clips.length)
    throw new StudioError("Add at least one clip to the timeline.");
  const duration = timelineDuration(timeline);
  if (duration > 7200)
    throw new StudioError(
      "This rendering worker currently supports exports up to two hours.",
    );
  const [w, h] = deliveryDimensions(settings),
    args: string[] = [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-threads",
      "2",
      "-filter_complex_threads",
      "1",
    ],
    filters: string[] = [];
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [i, c] of timeline.clips.entries()) {
    const entry = await assertAssetIntact(s, owner, project, c.assetId);
    if (!["image", "video"].includes(entry.asset.kind))
      throw new StudioError(
        "A picture or video is required for each visual clip.",
      );
    const p = await probe(entry.path),
      length = c.out - c.in;
    if (entry.asset.kind === "video" && Number(p.format.duration) + 0.1 < c.out)
      throw new StudioError(`Trim extends beyond ${entry.asset.name}.`);
    if (entry.asset.kind === "image")
      args.push(
        "-loop",
        "1",
        "-framerate",
        String(settings.fps),
        "-t",
        String(length),
      );
    else args.push("-ss", String(c.in), "-t", String(length));
    args.push("-protocol_whitelist", "file,pipe", "-i", entry.path);
    if (!audioOnly) filters.push(
      `[${i}:v]trim=duration=${length},setpts=PTS-STARTPTS,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${settings.fps},format=yuv420p,settb=AVTB[v${i}]`,
    );
    filters.push(
      p.streams.some((s) => s.codec_type === "audio")
        ? `[${i}:a]atrim=duration=${length},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${nativeVolume(timeline,c.id)},apad,atrim=duration=${length}[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${length}[a${i}]`,
    );
  }
  let v = "v0",
    a = "a0",
    elapsed = timeline.clips[0].out - timeline.clips[0].in;
  for (let i = 1; i < timeline.clips.length; i++) {
    const c = timeline.clips[i],
      length = c.out - c.in,
      nv = `joinv${i}`,
      na = `joina${i}`;
    if (c.transition !== "cut" && c.transitionSeconds > 0) {
      if(!audioOnly)filters.push(`[${v}][v${i}]xfade=transition=${c.transition === "fade" ? "fadeblack" : "fade"}:duration=${c.transitionSeconds}:offset=${elapsed - c.transitionSeconds}[${nv}]`);
      filters.push(`[${a}][a${i}]acrossfade=d=${c.transitionSeconds}:c1=tri:c2=tri[${na}]`);
      elapsed += length - c.transitionSeconds;
    } else {
      filters.push(audioOnly ? `[${a}][a${i}]concat=n=2:v=0:a=1[${na}]` : `[${v}][${a}][v${i}][a${i}]concat=n=2:v=1:a=1[${nv}][${na}]`);
      elapsed += length;
    }
    v = nv;
    a = na;
  }
  const dialogue: string[] = [],
    music: string[] = [],
    other: string[] = [];
  for (const [i, c] of timeline.audio.entries()) {
    const entry = await assertAssetIntact(s, owner, project, c.assetId),
      p = await probe(entry.path);
    if (!p.streams.some((s) => s.codec_type === "audio"))
      throw new StudioError("An audio track has no readable audio.");
    if (Number(p.format.duration) + 0.1 < c.out)
      throw new StudioError(`Audio trim extends beyond ${entry.asset.name}.`);
    let audioSource=entry.path;
    if(c.loop){
      // Reuse the existing FFmpeg offline mixer, with actual overlapping loop
      // joins rather than restarting a track at every video boundary.
      const count=Math.ceil((c.length!)/(c.out-c.in-(c.loopCrossfade||0)));
      const loopFile=path.join(directory,`loop-${i}.wav`),loopArgs=["-v","error","-nostdin","-y","-threads","2","-filter_complex_threads","1"];
      const n=Math.max(1,count),parts=Array.from({length:n},(_,k)=>`[${k}:a]atrim=start=${c.in}:end=${c.out},asetpts=PTS-STARTPTS[l${k}]`);
      for(let k=0;k<n;k++)loopArgs.push('-i',entry.path);
      let last="l0";
      for(let k=1;k<n;k++){const next=`loopjoin${k}`;parts.push(c.loopCrossfade ? `[${last}][l${k}]acrossfade=d=${c.loopCrossfade}:c1=tri:c2=tri[${next}]` : `[${last}][l${k}]concat=n=2:v=0:a=1[${next}]`);last=next;}
      const script=path.join(directory,`loop-${i}.txt`);await fs.writeFile(script,parts.join(";\n"),{mode:0o600});
      await promisify(execFile)("ffmpeg",[...loopArgs,"-filter_complex_script",script,"-map",`[${last}]`,"-t",String(c.length),"-ar","48000","-c:a","pcm_f32le",loopFile],{timeout:180000});audioSource=loopFile;
    }
    args.push(
      "-ss", String(c.loop?0:c.in),
      "-t", String(c.loop?c.length:c.out-c.in),
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      audioSource,
    );
    const label = `sound${i}`;
    const filter=audioFilters(timeline,c,`[${timeline.clips.length+i}:a]asetpts=PTS-STARTPTS,`,label,duration);
    if(!activeAudio(timeline,c)||!audioPlacement(timeline,c)||!filter){filters.push(`[${timeline.clips.length+i}:a]anullsink`);continue;}
    filters.push(filter);
    (c.track === "dialogue"
      ? dialogue
      : c.track === "music"
        ? music
        : other
    ).push(label);
  }
  const mix = (labels: string[], target: string) => {
    filters.push(
      labels.map((x) => `[${x}]`).join("") +
        `amix=inputs=${labels.length}:duration=longest:normalize=0[${target}]`,
    );
    return target;
  };
  const sounds = [a, ...other];
  if (dialogue.length && music.length && timeline.duckMusic) {
    const d = mix(dialogue, "dialoguemix"),
      m = mix(music, "musicmix");
    filters.push(
      `[${d}]asplit=2[dialogueout][duckcontrol]`,
      `[${m}][duckcontrol]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=300[duckedmusic]`,
    );
    sounds.push("dialogueout", "duckedmusic");
  } else sounds.push(...dialogue, ...music);
  a = mix(sounds, "mixed");
  filters.push(
    `[${a}]${originalComparison?'anull':'alimiter=limit=0.794:level=0:latency=1'},apad,atrim=duration=${duration}[audioout]`,
  );
  for (const [i, t] of (audioOnly?[]:timeline.titles).entries()) {
    const file = path.join(directory, `title-${i}.txt`);
    await fs.writeFile(file, t.text, { mode: 0o600 });
    const next = `titlev${i}`,
      y =
        t.position === "top"
          ? "h*0.08"
          : t.position === "center"
            ? "(h-text_h)/2"
            : "h*0.86-text_h";
    // Text is read from a generated private file, never interpolated into filter syntax.
    filters.push(
      `[${v}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile='${file}':expansion=none:fontsize=${Math.round(h * 0.04)}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8:x=(w-text_w)/2:y=${y}:enable='between(t,${t.start},${t.end})'[${next}]`,
    );
    v = next;
  }
  const graph = path.join(directory, "filter.txt");
  await fs.writeFile(graph, filters.join(";\n"), { mode: 0o600 });
  const output = path.join(directory, audioOnly ? "mix.wav" : `result.${settings.format}`);
  args.push(
    "-filter_complex_script",
    graph,
    "-map",
    audioOnly ? "[audioout]" : `[${v}]`,
    ...(!audioOnly?["-map","[audioout]"]:[]),
    "-t",
    String(duration),
    "-r",
    String(settings.fps),
  );
  if(audioOnly)args.push("-vn","-c:a","pcm_s24le","-ar","48000");
  else args.push(
    ...(settings.format === "mp4"
      ? [
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "19",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
        ]
      : [
          "-c:v",
          "libvpx-vp9",
          "-deadline",
          "realtime",
          "-cpu-used",
          "6",
          "-crf",
          "30",
          "-b:v",
          "0",
          "-c:a",
          "libopus",
          "-b:a",
          "160k",
        ]),
  );
  args.push(
    "-progress",
    "pipe:1",
    "-nostats",
    output,
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let log = "",
      partial = "",
      settled = false;
    const timer = setInterval(() => {
      if (canceled()) child.kill("SIGTERM");
    }, 500);
    const timeout = setTimeout(() => child.kill("SIGKILL"), 4 * 60 * 60 * 1000);
    child.stdout.on("data", (chunk) => {
      partial += chunk.toString();
      const lines = partial.split("\n");
      partial = lines.pop() || "";
      for (const line of lines) {
        const m = /^out_time_us=(\d+)$/.exec(line);
        if (m) report(Math.min(98, (Number(m[1]) / 1e6 / duration) * 100));
      }
    });
    child.stderr.on("data", (chunk) => {
      log = (log + chunk.toString()).slice(-16000);
    });
    const done = async (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(timeout);
      await fs.writeFile(path.join(directory, "render.log"), log, {
        mode: 0o600,
      });
      if (error) reject(error);
      else resolve();
    };
    child.on("error", () => void done(new Error("FFmpeg could not start.")));
    child.on(
      "close",
      (code) =>
        void done(
          code === 0
            ? undefined
            : new Error(
                canceled()
                  ? "Canceled"
                  : "FFmpeg export failed. The private render log is available to administrators.",
              ),
        ),
    );
  });
  const result = await probe(output),
    stream = result.streams.find((s) => s.codec_type === "video");
  if (!audioOnly && (
    stream?.width !== w ||
    stream.height !== h ||
    stream.avg_frame_rate !== `${settings.fps}/1`
  ))
    throw new Error("Output dimensions or frame rate failed validation.");
  return output;
}
