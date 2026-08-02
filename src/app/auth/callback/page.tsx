"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { redactUrlForTelemetry } from "@/shared/security/safe-url";

// Always use overlay:// for deep links (registered in WorkOS for both environments)
const APP_PROTOCOL = 'overlay';

function AuthCallbackContent() {
  const searchParams = useSearchParams();
  const [hasRedirected, setHasRedirected] = useState(false);

  const code = searchParams?.get("code") ?? null;
  const error = searchParams?.get("error") ?? null;
  const errorDescription = searchParams?.get("error_description") ?? null;

  const status = useMemo(() => {
    if (error) return "error" as const;
    if (!code) return "error" as const;
    if (hasRedirected) return "success" as const;
    return "redirecting" as const;
  }, [error, code, hasRedirected]);

  const errorMessage = useMemo(() => {
    if (error) return errorDescription || error || "Authentication failed";
    if (!code) return "No authorization code received";
    return "";
  }, [error, errorDescription, code]);

  useEffect(() => {
    if (code && !error) {
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", redactUrlForTelemetry(window.location.href));
      }
      posthog.capture('auth_callback_success');
      // Redirect to the Electron app via deep link (electron:// in dev, overlay:// in prod)
      const deepLink = `${APP_PROTOCOL}://auth/callback?code=${encodeURIComponent(code)}`;
      window.location.href = deepLink;

      // Show success message after a short delay
      const timer = setTimeout(() => {
        setHasRedirected(true);
      }, 1000);

      return () => clearTimeout(timer);
    } else if (error || !code) {
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", redactUrlForTelemetry(window.location.href));
      }
      posthog.capture('auth_callback_error', {
        failure_class: error ? 'provider_error' : 'missing_code',
      });
    }
  }, [code, error, errorDescription]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#fafafa] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        {status === "redirecting" && (
          <>
            <div className="mb-6">
              <svg
                className="w-12 h-12 mx-auto animate-spin text-[#3b82f6]"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-medium mb-4">Signing you in...</h1>
            <p className="text-[#71717a]">
              Opening Overlay...
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mb-6">
              <svg
                className="w-12 h-12 mx-auto text-green-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-medium mb-4">Authentication successful!</h1>
            <p className="text-[#71717a] mb-6">
              You can now return to the Overlay app.
            </p>
            <p className="text-sm text-[#52525b]">
              If the app didn&apos;t open automatically,{" "}
              <a
                href={`${APP_PROTOCOL}://auth/callback?code=${code}`}
                className="text-[#3b82f6] hover:underline"
              >
                click here
              </a>
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mb-6">
              <svg
                className="w-12 h-12 mx-auto text-red-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 9l-6 6M9 9l6 6"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-medium mb-4">Authentication failed</h1>
            <p className="text-[#71717a] mb-6">{errorMessage}</p>
            <Link
              href="/"
              className="inline-block px-6 py-3 bg-white text-black rounded-full text-sm font-medium hover:bg-[#e4e4e7] transition-colors"
            >
              Return to home
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0a0a] text-[#fafafa] flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto animate-spin text-[#3b82f6]">
              <svg viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            </div>
          </div>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
