"use client";
import { useState } from "react";
import type { useStudio } from "./useStudio";
import { Button } from "./Controls";
export default function RevisionHistory({
  s,
}: {
  s: ReturnType<typeof useStudio>;
}) {
  const [rows, setRows] = useState<
    Array<{ revision: number; updatedAt: string }>
  >([]);
  return (
    <details className="rounded-xl border border-white/10 p-3">
      <summary>Revision recovery</summary>
      <p className="my-2 text-sm text-white/60">
        Restore a previous project revision without deleting any media, takes,
        jobs or later revisions.
      </p>
      <Button
        onClick={() =>
          void s
            .request(s.url + "?revisions=1")
            .then((data) => setRows(data.revisions))
            .catch((e) => s.setError(e.message))
        }
      >
        Load saved revisions
      </Button>
      <div className="mt-3 max-h-64 overflow-y-auto">
        {rows.map((r) => (
          <div
            key={r.revision}
            className="flex items-center justify-between gap-2 border-t border-white/10 py-2 text-sm"
          >
            <span>
              Revision {r.revision} · {new Date(r.updatedAt).toLocaleString()}
            </span>
            <Button
              disabled={!s.saved}
              onClick={() => {
                if (
                  confirm(
                    `Restore project revision ${r.revision}? Current work remains recoverable in revision history.`,
                  )
                )
                  s.change({ type: "revision.restore", revision: r.revision });
              }}
            >
              Restore
            </Button>
          </div>
        ))}
      </div>
    </details>
  );
}
