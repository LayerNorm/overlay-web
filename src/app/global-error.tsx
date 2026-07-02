"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

function errorReportingEnabled(): boolean {
  const value = process.env.NEXT_PUBLIC_OVERLAY_FEATURE_ERROR_REPORTING;
  return !["0", "false", "no", "off"].includes((value ?? "").trim().toLowerCase());
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!errorReportingEnabled()) return;
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#fafafa",
          color: "#0a0a0a",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 500, marginBottom: "1rem" }}>
          something went wrong
        </h1>
        <button
          onClick={reset}
          style={{
            padding: "0.5rem 1.25rem",
            background: "#0a0a0a",
            color: "#fff",
            border: "none",
            borderRadius: "9999px",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          try again
        </button>
      </body>
    </html>
  );
}
