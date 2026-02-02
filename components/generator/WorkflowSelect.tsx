'use client';

import React from "react";
import { Chip } from "../ui/Chip";

export type WorkflowOption = {
  id: string;
  label?: string;
  type?: string;
};

export function WorkflowSelect({
  workflows,
  value,
  onChange,
  onSync,
  syncing,
}: {
  workflows: WorkflowOption[];
  value: string;
  onChange: (id: string) => void;
  onSync?: () => void;
  syncing?: boolean;
}) {
  const current = workflows.find((w) => w.id === value);

  return (
    <div className="otg-card">
      <div className="otg-row otg-between otg-center">
        <div>
          <div className="otg-cardTitle">Workflow</div>
          <div className="otg-muted">
            {current?.label ?? current?.id ?? "Select a workflow preset"}
          </div>
        </div>

        {onSync ? (
          <button
            type="button"
            className="otg-btn otg-btnSecondary"
            onClick={onSync}
            disabled={!!syncing}
            title="Refresh workflow list"
          >
            {syncing ? "Syncing..." : "Sync Workflows"}
          </button>
        ) : null}
      </div>

      <div className="otg-row otg-wrap" style={{ marginTop: 10 }}>
        {workflows.map((w) => (
          <Chip key={w.id} active={w.id === value} onClick={() => onChange(w.id)}>
            {w.label ?? w.id}
          </Chip>
        ))}
      </div>
    </div>
  );
}
