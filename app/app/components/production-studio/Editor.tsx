"use client";
import { useState } from "react";
import AudioMixer from "./AudioMixer";
import { newClientRequestId } from "@/lib/client/requestId";
import { useStoredDraft } from "./useStoredDraft";
import {
  allShots,
  timelineDuration,
  type Clip,
  type ExportSettings,
} from "@/lib/productionStudio/model";
import type { useStudio } from "./useStudio";
import { Button, Field, Section, inputClass, mediaUrl } from "./Controls";
type S = ReturnType<typeof useStudio>;
export function Editor({
  s,
  run,
}: {
  s: S;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const p = s.project!,
    t = p.timeline;
  const [asset, setAsset] = useState(""),
    [split, setSplit] = useState(1),
    [drag, setDrag] = useState<number | null>(null),
    [original, setOriginal] = useState<string | null>(null);
  const save = (timeline: typeof t) =>
    s.change({ type: "timeline.set", timeline });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= t.clips.length || from === to) return;
    const clips = [...t.clips],
      [c] = clips.splice(from, 1);
    clips.splice(to, 0, c);
    save({ ...t, clips });
  };
  const patch = (id: string, patch: Partial<Clip>) =>
    save({
      ...t,
      ...(patch.assetId ? {audio:t.audio.map(a=>a.parentClipId===id?{...a,muted:true}:a)} : {}),
      clips: t.clips.map((c) => (c.id === id ? { ...c, ...patch,...(patch.assetId?{audioMode:'original' as const}:{}) } : c)),
    });
  const add = (id: string, shotId?: string) => {
    const a = s.assets.find((a) => a.id === id);
    if (!a) return;
    save({
      ...t,
      clips: [
        ...t.clips,
        {
          id: newClientRequestId(),
          assetId: id,
          shotId,
          in: Number(a.metadata.trimIn) || 0,
          out: Number(a.metadata.trimOut) || (shotId ? allShots(p).find(s=>s.id===shotId)?.plannedDurationSeconds : undefined) || Number(a.metadata.duration) || 5,
          transition: "cut",
          transitionSeconds: 0,
          volume: 1,
        },
      ],
    });
  };
  return (
    <div className="space-y-4">
      <Section title={`Edit · ${timelineDuration(t).toFixed(1)} seconds`}>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!p.history.length}
            onClick={() => s.change({ type: "timeline.undo" })}
          >
            Undo
          </Button>
          <Button
            disabled={!p.future.length}
            onClick={() => s.change({ type: "timeline.redo" })}
          >
            Redo
          </Button>
          <Button
            disabled={!t.clips.length || !s.saved}
            onClick={() =>
              run(() =>
                s.job({
                  kind: "export",
                  settings: {
                    aspect: p.brief.aspect,
                    resolution: 720,
                    fps: 24,
                    format: "mp4",
                    filename: p.name + " edit preview",
                  },
                }),
              )
            }
          >
            Render edit preview · 720p
          </Button>
        </div>
        <p className="text-sm text-white/60">
          Edits never overwrite source clips. Drag clips on desktop or use
          Earlier/Later on your phone. Preview renders appear in Jobs.
        </p>
        <details><summary className="cursor-pointer py-3">Video assembly, trims & order</summary>
        <div className="flex flex-wrap gap-2">
          {allShots(p)
            .filter((shot) => p.shots[shot.id]?.approvedTakeId)
            .map((shot) => {
              const settings = p.shots[shot.id],
                take = shot.takes.find((t) => t.id === settings.approvedTakeId);
              return (
                <Button
                  key={shot.id}
                  onClick={() =>
                    add(settings.finalAssetId || take!.assetId!, shot.id)
                  }
                >
                  + Approved shot {shot.shotNumber}
                </Button>
              );
            })}
        </div>
        <Field label="Add uploaded clip or still">
          <select
            className={inputClass}
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
          >
            <option value="">Choose media</option>
            {s.assets
              .filter((a) => ["video", "image"].includes(a.kind))
              .map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        <Button disabled={!asset} onClick={() => add(asset)}>
          Add to timeline
        </Button>
        <Field label="Split offset from clip start · seconds">
          <input
            className={inputClass}
            type="number"
            min={0.05}
            step={0.1}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
          />
        </Field>
        <ol className="space-y-3">
          {t.clips.map((c, i) => {
            const source = s.assets.find((a) => a.id === c.assetId),
              shot = allShots(p).find((s) => s.id === c.shotId);
            return (
              <li
                key={c.id}
                draggable
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag !== null) move(drag, i);
                  setDrag(null);
                }}
                className="rounded-xl border border-white/15 p-3 space-y-3"
              >
                <p className="break-words font-medium">
                  {i + 1}. {source?.name || "Missing source"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="In · seconds">
                    <input
                      type="number"
                      step={0.01}
                      min={0}
                      className={inputClass}
                      value={c.in}
                      onChange={(e) =>
                        patch(c.id, { in: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label="Out · seconds">
                    <input
                      type="number"
                      step={0.01}
                      className={inputClass}
                      value={c.out}
                      onChange={(e) =>
                        patch(c.id, { out: Number(e.target.value) })
                      }
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!i} onClick={() => move(i, i - 1)}>
                    ← Earlier
                  </Button>
                  <Button
                    disabled={i === t.clips.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    Later →
                  </Button>
                  <Button
                    disabled={split <= 0 || split >= c.out - c.in}
                    onClick={() => {
                      const clips = [...t.clips];
                      clips.splice(
                        i,
                        1,
                        { ...c, out: c.in + split },
                        {
                          ...c,
                          id: newClientRequestId(),
                          in: c.in + split,
                          transition: "cut",
                          transitionSeconds: 0,
                        },
                      );
                      const nextId=clips[i+1].id;
                      save({ ...t, clips, audio:[...t.audio,...t.audio.filter(a=>a.parentClipId===c.id).map(a=>({...a,id:newClientRequestId(),parentClipId:nextId}))] });
                    }}
                  >
                    Split
                  </Button>
                  <Button
                    onClick={() => {
                      const clips = [...t.clips];
                      clips.splice(i + 1, 0, { ...c, id: newClientRequestId() });
                      const nextId=clips[i+1].id;
                      save({ ...t, clips, audio:[...t.audio,...t.audio.filter(a=>a.parentClipId===c.id).map(a=>({...a,id:newClientRequestId(),parentClipId:nextId}))] });
                    }}
                  >
                    Duplicate
                  </Button>
                  <Button
                    onClick={() =>
                      save({
                        ...t,
                        clips: t.clips.filter((x) => x.id !== c.id),
                        audio: t.audio.filter(a=>a.parentClipId!==c.id),
                      })
                    }
                  >
                    Remove
                  </Button>
                  <Button
                    onClick={() =>
                      setOriginal(original === c.assetId ? null : c.assetId)
                    }
                  >
                    Original
                  </Button>
                </div>
                <details>
                  <summary>Transition, audio & alternate takes</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Transition into clip">
                      <select
                        className={inputClass}
                        value={c.transition}
                        onChange={(e) =>
                          patch(c.id, {
                            transition: e.target.value as Clip["transition"],
                            transitionSeconds:
                              e.target.value === "cut"
                                ? 0
                                : Math.min(0.5, (c.out - c.in) / 4),
                          })
                        }
                      >
                        {["cut", "fade", "dissolve"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Transition seconds">
                      <input
                        className={inputClass}
                        type="number"
                        step={0.1}
                        min={0}
                        max={5}
                        value={c.transitionSeconds}
                        onChange={(e) =>
                          patch(c.id, {
                            transitionSeconds: Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                    <Field label="Original clip volume">
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.05}
                        value={c.volume}
                        onChange={(e) =>
                          patch(c.id, { volume: Number(e.target.value) })
                        }
                        className="w-full"
                      />
                    </Field>
                    {shot && (
                      <Field label="Alternate completed take">
                        <select
                          className={inputClass}
                          value={c.assetId}
                          onChange={(e) => {
                            const a = s.assets.find(
                              (a) => a.id === e.target.value,
                            );
                            patch(c.id, {
                              assetId: e.target.value,
                              in: Number(a?.metadata.trimIn) || 0,
                              out:
                                Number(a?.metadata.trimOut) || shot.plannedDurationSeconds || Number(a?.metadata.duration) ||
                                shot.requestedDurationSeconds,
                            });
                          }}
                        >
                          {p.shots[shot.id]?.finalAssetId && (
                            <option value={p.shots[shot.id].finalAssetId}>
                              Finished approved take
                            </option>
                          )}
                          {shot.takes
                            .filter((t) => t.assetId)
                            .map((t) => (
                              <option value={t.assetId!} key={t.id}>
                                Take {t.version}
                                {t.status === "accepted" ? " · approved" : ""}
                              </option>
                            ))}
                        </select>
                      </Field>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
        {original && (
          <div>
            <p>Original source · edits are not applied here</p>
            <video
              controls
              className="w-full max-h-96"
              src={mediaUrl(p.id, original)}
            />
          </div>
        )}
        </details>
      </Section>
      <AudioMixer s={s} run={run} />
      <Section title="Titles & captions">
        <Button
          onClick={() =>
            save({
              ...t,
              titles: [
                ...t.titles,
                {
                  id: newClientRequestId(),
                  text: "New caption",
                  start: 0,
                  end: 3,
                  position: "bottom",
                },
              ],
            })
          }
        >
          + Title or caption
        </Button>
        {t.titles.map((c) => (
          <div
            key={c.id}
            className="space-y-2 rounded-xl border border-white/10 p-3"
          >
            <Field label="Text">
              <textarea
                className={inputClass}
                value={c.text}
                onChange={(e) =>
                  save({
                    ...t,
                    titles: t.titles.map((x) =>
                      x.id === c.id ? { ...x, text: e.target.value } : x,
                    ),
                  })
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {(["start", "end"] as const).map((k) => (
                <Field label={k + " · seconds"} key={k}>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    className={inputClass}
                    value={c[k]}
                    onChange={(e) =>
                      save({
                        ...t,
                        titles: t.titles.map((x) =>
                          x.id === c.id
                            ? { ...x, [k]: Number(e.target.value) }
                            : x,
                        ),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            <Field label="Position">
              <select
                className={inputClass}
                value={c.position}
                onChange={(e) =>
                  save({
                    ...t,
                    titles: t.titles.map((x) =>
                      x.id === c.id
                        ? {
                            ...x,
                            position: e.target.value as typeof x.position,
                          }
                        : x,
                    ),
                  })
                }
              >
                {["top", "center", "bottom"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Button
              onClick={() =>
                save({ ...t, titles: t.titles.filter((x) => x.id !== c.id) })
              }
            >
              Remove title
            </Button>
          </div>
        ))}
      </Section>
    </div>
  );
}
export function Export({
  s,
  run,
}: {
  s: S;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const p = s.project!,
    [settings, setSettings] = useStoredDraft<ExportSettings>(
      s.scopeKey + ":export",
      {
        aspect: p.brief.aspect,
        resolution: 1080,
        fps: 24,
        format: "mp4",
        filename: p.name,
      },
    );
  return (
    <Section title="Export your film">
      <p className="text-sm text-white/60">
        Final rendering uses pinned source media. 1080p delivery is 1920×1080 in
        landscape—not the ~1 MP H3 generation size. Changing delivery size
        scales and pads; it does not regenerate content.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Filename">
          <input
            className={inputClass}
            value={settings.filename}
            onChange={(e) =>
              setSettings((s) => ({ ...s, filename: e.target.value }))
            }
          />
        </Field>
        <Field label="Aspect ratio">
          <select
            className={inputClass}
            value={settings.aspect}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                aspect: e.target.value as ExportSettings["aspect"],
              }))
            }
          >
            {["landscape", "portrait", "square"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Delivery resolution">
          <select
            className={inputClass}
            value={settings.resolution}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                resolution: Number(e.target.value) as 720 | 1080,
              }))
            }
          >
            <option value={720}>720p</option>
            <option value={1080}>1080p</option>
          </select>
        </Field>
        <Field label="Frame rate">
          <select
            className={inputClass}
            value={settings.fps}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                fps: Number(e.target.value) as 24 | 30,
              }))
            }
          >
            <option value={24}>24 FPS</option>
            <option value={30}>30 FPS</option>
          </select>
        </Field>
        <Field label="Video / audio">
          <select
            className={inputClass}
            value={settings.format}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                format: e.target.value as "mp4" | "webm",
              }))
            }
          >
            <option value="mp4">MP4 · H.264 / AAC</option>
            <option value="webm">WebM · VP9 / Opus</option>
          </select>
        </Field>
      </div>
      <p className="text-sm">
        Destination: private production storage, with download to your device
        when ready.
      </p>
      <Button
        disabled={!p.timeline.clips.length || !s.saved}
        onClick={() => run(() => s.job({ kind: "export", settings }))}
      >
        Export film
      </Button>
      <p className="text-xs text-white/60">
        You can leave the app. Progress, output and failures are saved on the
        server.
      </p>
    </Section>
  );
}
