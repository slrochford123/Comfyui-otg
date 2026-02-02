"use client";

import React from "react";
import type { Job } from "@/lib/jobs/types";
import { JobCard } from "./JobCard";

export function JobList({
  jobs,
  onRerun,
  onReseed,
  onEdit,
  onDownload,
  onDelete,
}: {
  jobs: Job[];
  onRerun: (job: Job) => void;
  onReseed: (job: Job) => void;
  onEdit: (job: Job) => void;
  onDownload: (job: Job) => void;
  onDelete: (job: Job) => void;
}) {
  if (!jobs.length) {
    return <div className="text-sm text-gray-500">No jobs yet. Start a generation.</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {jobs.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          onRerun={onRerun}
          onReseed={onReseed}
          onEdit={onEdit}
          onDownload={onDownload}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
