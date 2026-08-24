"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { LandingAuthBoundary, LandingAuthPageChrome } from "../../_components/AuthPageChrome";
import { sanitizeClientAuthRedirect } from "@/shared/auth/auth-redirect";
import {
  persistMobilePkceChallengeFromUrl,
  resolveCodeChallengeForSso,
} from "@/shared/auth/mobile-auth-client";
import {
  marketingAuthCard,
  marketingAuthMuted,
  marketingDividerLabel,
  marketingPrimaryField,
  marketingSsoButton,
  marketingSubmitButton,
} from "@/features/landing/lib/landingPageStyles";
import { DEFAULT_OVERLAY_CAPABILITIES, type CapabilityCheck } from "@overlay/app-core";
import { SsoProviderIcon, useAuthUiOptions } from "../../_components/useAuthUiOptions";
import { shouldReuseExistingWebSession } from "@/shared/auth/desktop-auth-handoff";

function SignInContent() {
  const { refreshSession, isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [sessionCleared, setSessionCleared] = useState(false);
  const [clearingSession, setClearingSession] = useState(false);
  const [redirectingExistingSession, setRedirectingExistingSession] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState<boolean | null>(null);
  const authUiOptions = useAuthUiOptions();

  const labelText = "text-[var(--foreground)]";
  const linkMuted = "text-[var(--muted)] hover:text-[var(--foreground)]";
  const createLink = "text-[var(--foreground)] hover:underline font-medium";

  const redirectUrl = sanitizeClientAuthRedirect(searchParams?.get("redirect"));
  const forceLogin = searchParams?.get("force") === "true";
  const isDesktopAuth = redirectUrl.startsWith("overlay://");

  useEffect(() => {
    const errorParam = searchParams?.get("error");
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
    }
  }, [searchParams]);

  useEffect(() => {
    persistMobilePkceChallengeFromUrl(searchParams);
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/capabilities", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json();
      })
      .then((payload) => {
        if (!active) return;
        const capabilities = {
          ...DEFAULT_OVERLAY_CAPABILITIES,
          ...((payload?.capabilities ?? {}) as Partial<CapabilityCheck>),
        };
        setSsoEnabled(capabilities.sso);
      })
      .catch(() => {
        if (active) setSsoEnabled(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if ((isDesktopAuth || forceLogin) && !sessionCleared && !clearingSession) {
      setClearingSession(true);
      const signOutExisting = async () => {
        try {
          await fetch("/api/auth/sign-out", { method: "POST" });
        } catch (e) {
          console.error("[SignIn] Failed to clear session:", e);
        } finally {
          setSessionCleared(true);
          setClearingSession(false);
        }
      };
      void signOutExisting();
    }
  }, [isDesktopAuth, forceLogin, sessionCleared, clearingSession]);

  useEffect(() => {
    if (authLoading || !isAuthenticated || forceLogin || isDesktopAuth) return;

    setRedirectingExistingSession(true);
    if (redirectUrl.startsWith("overlay://")) {
      window.location.href = redirectUrl;
    } else {
      router.replace(redirectUrl);
    }
  }, [authLoading, forceLogin, isAuthenticated, isDesktopAuth, redirectUrl, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setPendingVerification(false);

    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (data.pendingEmailVerification) {
        setPendingVerification(true);
        setError(data.error);
        return;
      }

      if (!response.ok) {
        setError(data.error || "Sign in failed");
        return;
      }

      await refreshSession();
      router.refresh();

      if (redirectUrl.startsWith("overlay://")) {
        window.location.href = redirectUrl;
      } else {
        router.replace(redirectUrl);
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleSSO = (provider: string) => {
    if (!ssoEnabled) return;
    setSsoLoading(provider);
    const forceParam = isDesktopAuth || forceLogin ? "&force=true" : "";
    const codeChallenge = resolveCodeChallengeForSso(searchParams);
    const pkceParam = codeChallenge
      ? `&codeChallenge=${encodeURIComponent(codeChallenge)}`
      : "";
    const ssoUrl = `/api/auth/sso/${provider}?redirect=${encodeURIComponent(redirectUrl)}${forceParam}${pkceParam}`;
    window.location.href = ssoUrl;
  };

  const card = marketingAuthCard();
  const muted = marketingAuthMuted();
  const sso = marketingSsoButton();
  const field = marketingPrimaryField();
  const submit = marketingSubmitButton();
  const divLabel = marketingDividerLabel();
  const ssoProviders = authUiOptions?.ssoProviders ?? [];
  const showSso = Boolean(ssoEnabled && authUiOptions?.supportsSso && ssoProviders.length > 0);
  const showPassword = authUiOptions?.supportsPasswordSignIn === true;
  const shouldReuseExistingSession = shouldReuseExistingWebSession({
    authLoading,
    isAuthenticated,
    forceLogin,
    isDirectDesktopCallback: isDesktopAuth,
  });

  if (shouldReuseExistingSession || redirectingExistingSession) {
    return (
      <LandingAuthPageChrome
        mainClassName="relative z-10 flex flex-1 items-center justify-center px-4"
        footerClassName="relative z-10 mt-auto flex justify-center border-t border-[var(--border)] px-8 py-6 text-sm text-[var(--muted)] sm:justify-start"
      >
        <p className="text-sm text-[var(--muted)]">Continuing to Overlay…</p>
      </LandingAuthPageChrome>
    );
  }

  return (
    <LandingAuthPageChrome
      mainClassName="relative z-10 flex flex-1 items-center justify-center px-4 pb-10 pt-28 md:px-6 md:pb-14 md:pt-32"
      footerClassName="relative z-10 mt-auto flex justify-center border-t border-[var(--border)] px-8 py-6 text-sm text-[var(--muted)] sm:justify-start"
    >
      <div className="w-full max-w-md">
        <div className={card}>
            <h1 className={`text-2xl font-serif text-center mb-2 ${labelText}`}>Welcome back</h1>
            <p className={`text-sm text-center mb-8 ${muted}`}>Sign in to your overlay account</p>

            {error && (
              <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
                {error}
                {pendingVerification && (
                  <Link
                    href={`/auth/verify-email?email=${encodeURIComponent(email)}`}
                    className="mt-2 block text-red-600 underline hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    Resend verification email
                  </Link>
                )}
              </div>
            )}

            {showSso ? (
            <div className="space-y-3 mb-6">
              {ssoProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => handleSSO(provider.id)}
                  disabled={ssoLoading !== null}
                  className={sso}
                >
                  <SsoProviderIcon icon={provider.icon} />
                  {ssoLoading === provider.id ? "Redirecting..." : provider.label}
                </button>
              ))}
            </div>
            ) : null}

            {showSso && showPassword ? (
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[var(--border)]" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className={divLabel}>or continue with email</span>
              </div>
            </div>
            ) : null}

            {showPassword ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className={`block text-sm font-medium mb-2 ${labelText}`}>
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={field}
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="password" className={`block text-sm font-medium ${labelText}`}>
                    Password
                  </label>
                  {authUiOptions?.supportsPasswordReset ? (
                  <Link href="/auth/forgot-password" className={`text-xs transition-colors ${linkMuted}`}>
                    Forgot password?
                  </Link>
                  ) : null}
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={field}
                  placeholder="••••••••"
                />
              </div>

              <button type="submit" disabled={loading} className={submit}>
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>
            ) : null}

            {authUiOptions?.supportsPasswordSignUp ? (
            <p className={`mt-6 text-center text-sm ${muted}`}>
              Don&apos;t have an account?{" "}
              <Link
                href={`/auth/sign-up${redirectUrl !== "/account" ? `?redirect=${encodeURIComponent(redirectUrl)}` : ""}`}
                className={createLink}
              >
                Create one
              </Link>
            </p>
            ) : null}
        </div>
      </div>
    </LandingAuthPageChrome>
  );
}

export default function SignInPage() {
  return (
    <LandingAuthBoundary>
      <SignInContent />
    </LandingAuthBoundary>
  );
}
