"use client";

import * as React from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>Something went wrong</h1>

      <p style={{ marginBottom: 12, color: "#444" }}>
        {error?.message ?? "Unknown error"}
      </p>

      {error?.digest ? (
        <p style={{ marginBottom: 12, color: "#666", fontSize: 12 }}>
          Digest: {error.digest}
        </p>
      ) : null}

      <button
        onClick={() => reset()}
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid #ccc",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </main>
  );
}
