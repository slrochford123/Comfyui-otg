"use client";

import React from "react";
import type { Job } from "@/lib/jobs/types";

function statusLabel(status: Job["status"]) {
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "completed") return "Complete";
  return "Failed";
}

function statusStyle(status: Job["status"]) {
  if (status === "queued") return "bg-gray-100 text-gray-700";
  if (status === "running") return "bg-blue-100 text-blue-700";
  if (status === "completed") return "bg-green-100 text-green-700";
  return "bg-red-100 text-red-700";
}

export function JobCard({
  job,
  onRerun,
  onReseed,
  onEdit,
  onDownload,
  onDelete,
}: {
  job: Job;
  onRerun: (job: Job) => void;
  onReseed: (job: Job) => void;
  onEdit: (job: Job) => void;
  onDownload: (job: Job) => void;
  onDelete: (job: Job) => void;
}) {
  const pct = Math.max(0, Math.min(1, job.progress?.pct ?? 0));
  const pctText = Math.round(pct * 100);

  return (
    <div className="rounded-2xl border bg-white shadow-sm p-4 flex gap-4">
      {/* Thumbnail */}
      <div className="w-24 h-24 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center text-xs text-gray-500">
        {job.output?.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={job.output.thumbnailUrl}
            alt="thumbnail"
            className="w-full h-full object-cover"
          />
        ) : (
          "Preview"
        )}
      </div>

      {/* Main */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div
            className={`px-2 py-1 rounded-full text-xs font-medium ${statusStyle(
              job.status
            )}`}
          >
            {statusLabel(job.status)}
          </div>
          <div className="text-xs text-gray-500">{pctText}%</div>
        </div>

        <div className="mt-2 text-sm text-gray-900 line-clamp-2 whitespace-pre-line">
          {job.prompts?.join("\n") ?? ""}
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-2 bg-black" style={{ width: `${pctText}%` }} />
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {job.progress?.message ?? ""}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="px-3 py-1 rounded-lg border text-sm"
            onClick={() => onRerun(job)}
          >
            ▶ Re-run
          </button>
          <button
            className="px-3 py-1 rounded-lg border text-sm"
            onClick={() => onReseed(job)}
          >
            🔁 Re-seed
          </button>
          <button
            className="px-3 py-1 rounded-lg border text-sm"
            onClick={() => onEdit(job)}
          >
            ✏ Edit
          </button>

          <button
            className="px-3 py-1 rounded-lg border text-sm disabled:opacity-50"
            disabled={job.status !== "completed"}
            onClick={() => onDownload(job)}
          >
            ⬇ Download
          </button>

          <button
            className="px-3 py-1 rounded-lg border text-sm"
            onClick={() => onDelete(job)}
          >
            🗑 Delete
          </button>
        </div>

        {job.status === "failed" && job.error?.message && (
          <div className="mt-2 text-xs text-red-600">{job.error.message}</div>
        )}
      </div>
    </div>
  );
}
