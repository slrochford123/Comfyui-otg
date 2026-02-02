"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Something went wrong</h1>
      <p style={{ marginTop: 8, opacity: 0.8 }}>
        {error?.message || "Unknown error"}
      </p>
      <button
        onClick={() => reset()}
        style={{
          marginTop: 16,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #ccc",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </main>
  );
}
