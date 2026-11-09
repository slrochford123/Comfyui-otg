"use client";
/* eslint-disable @next/next/no-img-element -- Owner-authenticated media must not enter the shared image optimizer cache. */
import { useEffect, useState } from "react";
import SharedTools from "./SharedTools";
import { useStoredDraft } from "./useStoredDraft";
import type { useStudio } from "./useStudio";
import { Button, Field, Section, inputClass, mediaUrl } from "./Controls";
type S = ReturnType<typeof useStudio>;
type Catalog = {
  characters: Array<{ id: string; name: string; hasRefMod: boolean }>;
  locations: Array<{ id: string; name: string }>;
  props: Array<{ id: string; name: string }>;
  voices: Array<{ id: string; name: string }>;
  audio: Array<{ id: string; name: string }>;
  stories: Array<{ id: string; title: string }>;
};
export { default as Plan } from "./Plan";
export function Cast({
  s,
  run,
}: {
  s: S;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const p = s.project!;
  const { request: api, url, setError: reportError } = s;
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [kind, setKind] = useState("character"),
    [selected, setSelected] = useState(""),
    [name, setName] = useStoredDraft(s.scopeKey + ":voice-name", ""),
    [prompt, setPrompt] = useStoredDraft(s.scopeKey + ":voice-prompt", ""),
    [text, setText] = useStoredDraft(
      s.scopeKey + ":voice-text",
      "Welcome. It is good to see you again.",
    ),
    [voice, setVoice] = useStoredDraft(s.scopeKey + ":voice-reference", ""),
    [speaker, setSpeaker] = useStoredDraft(s.scopeKey + ":voice-speaker", "");
  const selectedVoice = speaker ? p.characterVoices?.[speaker] || "" : voice;
  useEffect(() => {
    let active = true;
    void api(url + "/catalog")
      .then((c) => {
        if (active) setCatalog(c);
      })
      .catch((e) => reportError(e.message));
    return () => {
      active = false;
    };
  }, [api, url, reportError]);
  const choices =
    kind === "character"
      ? catalog?.characters
      : kind === "location"
        ? catalog?.locations
        : kind === "prop"
          ? catalog?.props
          : kind === "audio"
            ? catalog?.audio
            : catalog?.voices;
  return (
    <div className="space-y-4">
      <Section title="Cast & World">
        <p className="text-sm text-white/60">
          Imported media are private, fingerprinted copies. Approve the exact
          version you want this production to use.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Library">
            <select
              className={inputClass}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setSelected("");
              }}
            >
              {["character", "location", "prop", "voice", "audio"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Saved asset">
            <select
              className={inputClass}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose an asset</option>
              {choices?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button
          disabled={!selected}
          onClick={() =>
            run(async () => {
              await s.request(s.url + "/catalog", {
                method: "POST",
                body: JSON.stringify({ kind, sourceId: selected }),
              });
              await s.refresh();
            })
          }
        >
          Import pinned copy
        </Button>
        <Field label="Upload characters, environments, wardrobe, props, music or sound">
          <input
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            className={inputClass}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              run(async () => {
                for (const file of files) {
                  const form = new FormData();
                  form.set("file", file);
                  await s.request(s.url + "/assets", {
                    method: "POST",
                    body: form,
                  });
                }
                await s.refresh();
              });
            }}
          />
        </Field>
      </Section>
      <SharedTools
        characters={catalog?.characters || []}
        onSaved={() =>
          run(async () => {
            setCatalog(await s.request(s.url + "/catalog"));
            await s.refresh();
          })
        }
      />
      <Section title="Qwen3 character voice">
        <Field label="Speaker">
          <select
            className={inputClass}
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
          >
            <option value="">New audition / unassigned dialogue</option>
            {s.assets
              .filter((a) => a.kind === "character")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Voice name">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Approved voice reference">
          <select
            className={inputClass}
            value={selectedVoice}
            disabled={!!speaker}
            onChange={(e) => setVoice(e.target.value)}
          >
            <option value="">Design a new voice</option>
            {s.assets
              .filter(
                (a) =>
                  a.kind === "audio" &&
                  p.bindings.some((b) => b.assetId === a.id && b.approved),
              )
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        {speaker && !selectedVoice && (
          <p className="text-amber-200">
            Assign an approved voice to this character below first.
          </p>
        )}
        <Field
          label={selectedVoice ? "Delivery direction" : "Describe the voice"}
        >
          <textarea
            className={inputClass}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
          />
        </Field>
        <Field label="Exact spoken words">
          <textarea
            className={inputClass}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
          />
        </Field>
        <Button
          disabled={!name || !text || !s.saved || (!!speaker && !selectedVoice)}
          onClick={() => {
            if (
              confirm(
                selectedVoice
                  ? "Generate dialogue with this approved voice reference using Qwen3?"
                  : "Create a Qwen3 voice audition? You will listen and approve it before reuse.",
              )
            )
              run(() =>
                s.job({
                  kind: "voice",
                  name,
                  prompt,
                  text,
                  voiceReferenceId: selectedVoice || null,
                  characterId: speaker || null,
                }),
              );
          }}
        >
          {selectedVoice ? "Generate dialogue" : "Create voice audition"}
        </Button>
        <p className="text-sm text-white/60">
          Approved voices are reused from recordings, not recreated from
          descriptions. Add dialogue recordings to the Edit dialogue track.
          Exact lip synchronization with H3 is not guaranteed.
        </p>
      </Section>
      <Section title="Production assets">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {s.assets
            .filter((a) => !a.metadata.proxyFor)
            .map((a) => (
              <article
                key={a.id}
                className="min-w-0 rounded-xl border border-white/10 p-3 space-y-2"
              >
                <p className="break-words font-medium">{a.name}</p>
                {a.kind === "character" && (
                  <Field label={`Approved voice for ${a.name}`}>
                    <select
                      className={inputClass}
                      value={p.characterVoices?.[a.id] || ""}
                      onChange={(e) =>
                        s.change({
                          type: "character.voice",
                          characterId: a.id,
                          voiceId: e.target.value,
                        })
                      }
                    >
                      <option value="">No assigned dialogue voice</option>
                      {s.assets
                        .filter(
                          (v) =>
                            v.kind === "audio" &&
                            p.bindings.some(
                              (b) => b.assetId === v.id && b.approved,
                            ),
                        )
                        .map((v) => (
                          <option value={v.id} key={v.id}>
                            {v.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                {a.mime.startsWith("image/") ? (
                  <img
                    src={mediaUrl(p.id, a.id)}
                    alt={a.name}
                    loading="lazy"
                    className="h-28 w-full object-contain rounded-lg"
                  />
                ) : a.kind === "audio" ? (
                  <audio
                    className="w-full"
                    controls
                    preload="none"
                    src={mediaUrl(p.id, a.id)}
                  />
                ) : a.kind === "video" ? (
                  <video
                    className="h-28 w-full"
                    controls
                    preload="none"
                    src={mediaUrl(p.id, a.id)}
                  />
                ) : (
                  <p className="text-sm">Pinned RefMod bundle</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      s.change({
                        type: "asset.bind",
                        assetId: a.id,
                        role:
                          a.kind === "audio" ? "voice or soundtrack" : a.kind,
                        approved: !p.bindings.find((b) => b.assetId === a.id)
                          ?.approved,
                      })
                    }
                  >
                    {p.bindings.find((b) => b.assetId === a.id)?.approved
                      ? "Approved ✓"
                      : "Approve asset"}
                  </Button>
                  <a
                    className="p-2 text-sm underline"
                    href={mediaUrl(p.id, a.id) + "?download=1"}
                  >
                    Download
                  </a>
                </div>
              </article>
            ))}
        </div>
        {!s.assets.length && (
          <p className="text-sm text-white/60">
            Import or upload your first production asset.
          </p>
        )}
      </Section>
    </div>
  );
}
