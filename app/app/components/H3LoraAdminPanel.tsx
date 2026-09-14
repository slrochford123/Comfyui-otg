"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { H3LoraCatalogEntry } from "@/lib/h3LoraCatalogServer";
import type { ProductionV2H3BackendId } from "@/lib/production/h3Workflows";

const field =
  "w-full rounded-[6px] border border-white/15 bg-black/45 px-3 py-2 text-sm text-white outline-none focus:border-violet-300/70";
const button =
  "min-h-10 rounded-[6px] border border-white/15 bg-white/[0.06] px-3 py-2 text-sm font-semibold text-white hover:bg-white/[0.11] disabled:opacity-45";
const danger =
  "border-red-400/45 bg-red-500/10 text-red-100 hover:bg-red-500/20";
const BACKEND_LABELS: Record<ProductionV2H3BackendId, string> = {
  rtx5060ti: "RTX 5060 Ti",
  rtx3090: "RTX 3090",
};

type EditableField = Exclude<
  keyof H3LoraCatalogEntry,
  "id" | "filename" | "discoveredOn" | "missingOn"
>;

type EditorState = {
  expandedLoraId: string | null;
  draft: H3LoraCatalogEntry | null;
  dirtyFields: EditableField[];
};

const CLOSED_EDITOR: EditorState = {
  expandedLoraId: null,
  draft: null,
  dirtyFields: [],
};

function cloneEntry(entry: H3LoraCatalogEntry): H3LoraCatalogEntry {
  return {
    ...entry,
    triggerWords: [...entry.triggerWords],
    discoveredOn: [...entry.discoveredOn],
    missingOn: [...entry.missingOn],
  };
}

function reconcileEditor(
  current: EditorState,
  refreshedEntries: H3LoraCatalogEntry[],
  preserveDirtyFields: boolean,
): EditorState {
  if (!current.expandedLoraId) return current;
  const refreshed = refreshedEntries.find(
    (entry) => entry.id === current.expandedLoraId,
  );
  if (!refreshed) return CLOSED_EDITOR;
  if (!current.draft || current.draft.id !== refreshed.id) {
    return {
      expandedLoraId: refreshed.id,
      draft: cloneEntry(refreshed),
      dirtyFields: [],
    };
  }

  const nextDraft = cloneEntry(refreshed);
  if (preserveDirtyFields) {
    for (const fieldName of current.dirtyFields) {
      Object.assign(nextDraft, { [fieldName]: current.draft[fieldName] });
    }
  }
  return {
    expandedLoraId: refreshed.id,
    draft: nextDraft,
    dirtyFields: preserveDirtyFields ? current.dirtyFields : [],
  };
}

function Editor({
  entry,
  onChange,
}: {
  entry: H3LoraCatalogEntry;
  onChange: (patch: Partial<H3LoraCatalogEntry>) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-xs text-white/60">
        Display Name
        <input
          className={`${field} mt-1`}
          value={entry.displayName}
          onChange={(event) => onChange({ displayName: event.target.value })}
        />
      </label>
      <label className="text-xs text-white/60">
        Compatibility
        <select
          className={`${field} mt-1`}
          value={entry.compatibilityStatus}
          onChange={(event) =>
            onChange({
              compatibilityStatus: event.target
                .value as H3LoraCatalogEntry["compatibilityStatus"],
            })
          }
        >
          <option value="review">Review</option>
          <option value="approved">Approved</option>
          <option value="incompatible">Rejected / Incompatible</option>
        </select>
      </label>
      <div className="md:col-span-2">
        <p className="text-xs font-bold text-white/55">Discovered filename</p>
        <p className="mt-1 break-all rounded-[6px] border border-white/10 bg-black/35 p-3 font-mono text-xs text-white/75">
          {entry.filename}
        </p>
        <p className="mt-1 text-[11px] text-white/35">Policy ID: {entry.id}</p>
      </div>
      <label className="text-xs text-white/60">
        Description
        <textarea
          className={`${field} mt-1`}
          value={entry.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </label>
      <label className="text-xs text-white/60">
        Admin Notes
        <textarea
          className={`${field} mt-1`}
          value={entry.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </label>
      {(
        [
          "defaultStrength",
          "minStrength",
          "maxStrength",
          "recommendedMin",
          "recommendedMax",
        ] as const
      ).map((key) => (
        <label key={key} className="text-xs capitalize text-white/60">
          {key.replace(/([A-Z])/g, " $1")}
          <input
            className={`${field} mt-1`}
            type="number"
            step="0.05"
            value={entry[key]}
            onChange={(event) =>
              onChange({ [key]: Number(event.target.value) })
            }
          />
        </label>
      ))}
      <label className="text-xs text-white/60">
        Trigger words
        <input
          className={`${field} mt-1`}
          value={entry.triggerWords.join(", ")}
          onChange={(event) =>
            onChange({
              triggerWords: event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label className="text-xs text-white/60">
        Preview image metadata
        <input
          className={`${field} mt-1`}
          value={entry.previewImage}
          onChange={(event) => onChange({ previewImage: event.target.value })}
        />
      </label>
      <div className="flex flex-wrap gap-3 text-sm text-white/75 md:col-span-2">
        {[
          ["enabled", "Enabled"],
          ["approvedForH3", "Approved for H3"],
          ["approvedForT2V", "T2V"],
          ["approvedForI2V", "I2V"],
          ["approvedForR2V", "R2V"],
          ["triggerRequired", "Trigger required"],
        ].map(([key, label]) => (
          <label key={key} className="flex min-h-10 items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(entry[key as keyof H3LoraCatalogEntry])}
              onChange={(event) => onChange({ [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function DeleteDialog({
  entry,
  busy,
  onCancel,
  onConfirm,
}: {
  entry: H3LoraCatalogEntry;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="h3-delete-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[8px] border border-red-400/35 bg-[#0b0d17] p-5 shadow-2xl">
        <h2 id="h3-delete-title" className="text-xl font-black text-white">
          Delete H3 LoRA file?
        </h2>
        <p className="mt-3 break-all rounded-[6px] border border-white/10 bg-black/35 p-3 font-mono text-sm text-white/80">
          {entry.filename}
        </p>
        <p className="mt-4 text-sm font-bold text-white">Backends</p>
        <ul className="mt-2 space-y-1 text-sm text-white/70">
          {entry.discoveredOn.map((backend) => (
            <li key={backend}>{BACKEND_LABELS[backend]}: Installed</li>
          ))}
        </ul>
        <p className="mt-4 rounded-[6px] border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
          This physically deletes the selected model file from the listed
          backend storage. This cannot be undone from the web app.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button className={button} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`${button} ${danger}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Deleting..." : "Delete File"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EntryCard({
  entry,
  expanded,
  busy,
  onToggle,
  onChange,
  onSave,
  onRevoke,
  onDelete,
}: {
  entry: H3LoraCatalogEntry;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<H3LoraCatalogEntry>) => void;
  onSave: () => void;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  return (
    <details
      open={expanded}
      className="rounded-[8px] border border-white/10 p-3"
    >
      <summary
        className="cursor-pointer"
        aria-expanded={expanded}
        onClick={(event) => {
          event.preventDefault();
          onToggle();
        }}
      >
        <span className="font-semibold text-white">{entry.displayName}</span>
        <span className="mt-1 block break-all font-mono text-xs text-white/45">
          {entry.filename}
        </span>
        <span className="mt-2 flex flex-wrap gap-2 text-xs">
          {(["rtx5060ti", "rtx3090"] as const).map((backend) => (
            <span
              key={backend}
              className={`rounded-[5px] border px-2 py-1 ${entry.discoveredOn.includes(backend) ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100" : "border-white/10 bg-black/25 text-white/40"}`}
            >
              {BACKEND_LABELS[backend]}:{" "}
              {entry.discoveredOn.includes(backend) ? "Installed" : "Missing"}
            </span>
          ))}
        </span>
      </summary>
      <div className="mt-4">
        <Editor entry={entry} onChange={onChange} />
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={button} disabled={busy} onClick={onSave}>
            Save Policy
          </button>
          <button className={button} disabled={busy} onClick={onRevoke}>
            Remove Approval
          </button>
        </div>
        <div className="mt-5 border-t border-red-400/20 pt-4">
          <p className="mb-2 text-xs font-bold uppercase text-red-200/70">
            Destructive file operation
          </p>
          <button
            className={`${button} ${danger}`}
            disabled={busy || !entry.discoveredOn.length}
            onClick={onDelete}
          >
            Delete File...
          </button>
        </div>
      </div>
    </details>
  );
}

export default function H3LoraAdminPanel() {
  const [entries, setEntries] = useState<H3LoraCatalogEntry[]>([]);
  const [maxSelections, setMaxSelections] = useState(3);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<H3LoraCatalogEntry | null>(
    null,
  );
  const [editor, setEditor] = useState<EditorState>(CLOSED_EDITOR);

  function applyCatalog(
    nextEntries: H3LoraCatalogEntry[],
    preserveDirtyFields = true,
  ) {
    setEntries(nextEntries);
    setEditor((current) =>
      reconcileEditor(current, nextEntries, preserveDirtyFields),
    );
    setDeleteTarget((current) =>
      current
        ? nextEntries.find((entry) => entry.id === current.id) || null
        : null,
    );
  }

  async function load() {
    const response = await fetch("/api/admin/h3-loras", {
      cache: "no-store",
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error || "Could not load the H3 LoRA inventory.");
    applyCatalog(Array.isArray(data.entries) ? data.entries : []);
    setMaxSelections(Number(data.maxSelections) || 3);
  }

  useEffect(() => {
    void load().catch((error) => setMessage(error.message));
  }, []);

  async function request(payload: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/h3-loras", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok)
        throw new Error(data.error || "H3 LoRA update failed.");
      return data;
    } finally {
      setBusy(false);
    }
  }

  function toggleEntry(entry: H3LoraCatalogEntry) {
    setEditor((current) =>
      current.expandedLoraId === entry.id
        ? CLOSED_EDITOR
        : {
            expandedLoraId: entry.id,
            draft: cloneEntry(entry),
            dirtyFields: [],
          },
    );
  }

  function updateDraft(patch: Partial<H3LoraCatalogEntry>) {
    setEditor((current) => {
      if (!current.draft) return current;
      const dirtyFields = new Set(current.dirtyFields);
      for (const fieldName of Object.keys(patch) as EditableField[]) {
        dirtyFields.add(fieldName);
      }
      return {
        ...current,
        draft: { ...current.draft, ...patch },
        dirtyFields: [...dirtyFields],
      };
    });
  }

  async function save(entry: H3LoraCatalogEntry) {
    try {
      const data = await request({ action: "upsert", entry });
      if (Array.isArray(data.entries)) applyCatalog(data.entries, false);
      if (data.maxSelections) setMaxSelections(Number(data.maxSelections));
      setMessage(`Saved ${entry.displayName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function revoke(entry: H3LoraCatalogEntry) {
    try {
      const data = await request({ action: "revoke", id: entry.id });
      if (Array.isArray(data.entries)) applyCatalog(data.entries, false);
      if (data.maxSelections) setMaxSelections(Number(data.maxSelections));
      setMessage(
        `Removed ${entry.displayName} from H3 user availability. Its model file was not deleted.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      const data = await request({
        action: "delete-file",
        id: deleteTarget.id,
        backends: deleteTarget.discoveredOn,
      });
      if (Array.isArray(data.entries)) applyCatalog(data.entries, false);
      if (data.maxSelections) setMaxSelections(Number(data.maxSelections));
      setMessage(
        `Deleted ${deleteTarget.filename} from ${deleteTarget.discoveredOn.map((backend) => BACKEND_LABELS[backend]).join(" and ")}.`,
      );
      setDeleteTarget(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const discovered = entries.filter((entry) => entry.discoveredOn.length > 0);
  const missing = entries.filter((entry) => !entry.discoveredOn.length);

  return (
    <details className="mt-4 rounded-[8px] border border-violet-300/20 bg-black/35 p-4">
      <summary className="cursor-pointer font-black text-white">
        H3 LoRA Administration
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-white/60">
          Sync discovers optional model files only inside each backend&apos;s
          MiniMax-H3 folder. New files remain disabled and in Review until
          approved.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-white/60">
            Maximum optional LoRAs
            <input
              className={`${field} mt-1 w-28`}
              type="number"
              min="1"
              max="8"
              value={maxSelections}
              onChange={(event) => setMaxSelections(Number(event.target.value))}
            />
          </label>
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void request({ action: "settings", maxSelections })
                .then((data) => {
                  if (Array.isArray(data.entries)) applyCatalog(data.entries);
                  if (data.maxSelections)
                    setMaxSelections(Number(data.maxSelections));
                  setMessage("H3 LoRA limit saved.");
                })
                .catch((error) => setMessage(error.message))
            }
          >
            Save Limit
          </button>
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void request({ action: "sync" })
                .then((data) => {
                  if (Array.isArray(data.entries)) applyCatalog(data.entries);
                  if (data.maxSelections)
                    setMaxSelections(Number(data.maxSelections));
                  setMessage(
                    `Discovered ${data.backends?.map((backend: { label: string; count: number }) => `${backend.count} on ${backend.label}`).join("; ") || "the H3 backend inventory"}.`,
                  );
                })
                .catch((error) => setMessage(error.message))
            }
          >
            {busy ? "Working..." : "Sync Backends"}
          </button>
        </div>
        {message ? (
          <div className="rounded-[6px] border border-white/10 bg-white/[0.05] p-3 text-sm text-white/75">
            {message}
          </div>
        ) : null}
        <div>
          <h3 className="text-sm font-black uppercase text-violet-200">
            Discovered H3 LoRAs
          </h3>
          <div className="mt-3 space-y-3">
            {discovered.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={
                  editor.expandedLoraId === entry.id && editor.draft
                    ? editor.draft
                    : entry
                }
                expanded={editor.expandedLoraId === entry.id}
                busy={busy}
                onToggle={() => toggleEntry(entry)}
                onChange={updateDraft}
                onSave={() =>
                  void save(
                    editor.expandedLoraId === entry.id && editor.draft
                      ? editor.draft
                      : entry,
                  )
                }
                onRevoke={() => void revoke(entry)}
                onDelete={() => setDeleteTarget(entry)}
              />
            ))}
            {!discovered.length ? (
              <p className="rounded-[6px] border border-dashed border-white/15 p-5 text-sm text-white/45">
                Press Sync Backends to discover installed optional H3 LoRAs.
              </p>
            ) : null}
          </div>
        </div>
        {missing.length ? (
          <details className="rounded-[8px] border border-white/10 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-white/60">
              Previously configured but not discovered ({missing.length})
            </summary>
            <div className="mt-3 space-y-3">
              {missing.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={
                    editor.expandedLoraId === entry.id && editor.draft
                      ? editor.draft
                      : entry
                  }
                  expanded={editor.expandedLoraId === entry.id}
                  busy={busy}
                  onToggle={() => toggleEntry(entry)}
                  onChange={updateDraft}
                  onSave={() =>
                    void save(
                      editor.expandedLoraId === entry.id && editor.draft
                        ? editor.draft
                        : entry,
                    )
                  }
                  onRevoke={() => void revoke(entry)}
                  onDelete={() => setDeleteTarget(entry)}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
      {deleteTarget && typeof document !== "undefined"
        ? createPortal(
            <DeleteDialog
              entry={deleteTarget}
              busy={busy}
              onCancel={() => setDeleteTarget(null)}
              onConfirm={() => void confirmDelete()}
            />,
            document.body,
          )
        : null}
    </details>
  );
}
