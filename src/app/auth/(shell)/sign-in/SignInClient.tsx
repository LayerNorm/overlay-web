"use client";

import { useState, useEffect } from "react";
import { redirect, useRouter, useSearchParams } from 'next/navigation'
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { LandingAuthPageChrome } from "../../_components/AuthPageChrome";
import { sanitizeClientAuthRedirect } from "@/shared/auth/auth-redirect";
import {
  persistMobilePkceChallengeFromUrl,
  resolveCodeChallengeForSso,
} from "@/shared/auth/mobile-auth-client";
import {
  marketingAuthMuted,
  marketingPrimaryField,
  marketingSsoButton,
  marketingSubmitButton,
} from "@/features/landing/lib/landingPageStyles";
import { SsoProviderIcon } from "../../_components/useAuthUiOptions";
import type { ClientAuthUiOptions } from "../../_components/useAuthUiOptions";
import { shouldReuseExistingWebSession } from "@/shared/auth/desktop-auth-handoff";

function useClearExistingSession(isDesktopAuth: boolean, forceLogin: boolean) {
  const [sessionCleared, setSessionCleared] = useState(false);
  const [clearingSession, setClearingSession] = useState(false);

  // One-shot session-clear on mount; guarded by clearingSession/sessionCleared.
  // react-doctor-disable-next-line react-doctor/no-fetch-in-effect, react-doctor/no-set-state-after-await-in-effect
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
}

function useRedirectExistingSession({
  authLoading,
  isAuthenticated,
  forceLogin,
  isDesktopAuth,
  redirectUrl,
}: {
  authLoading: boolean;
  isAuthenticated: boolean;
  forceLogin: boolean;
  isDesktopAuth: boolean;
  redirectUrl: string;
}) {
  const shouldRedirect =
    !authLoading && isAuthenticated && !forceLogin && !isDesktopAuth;

  if (shouldRedirect) {
    redirect(redirectUrl);
  }
}

function useEmailPasswordSignIn({
  email,
  password,
  redirectUrl,
  setError,
}: {
  email: string;
  password: string;
  redirectUrl: string;
  setError: (error: string | null) => void;
}) {
  const { refreshSession } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setPendingVerification(false);

    try {
      // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check
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

  return { handleSubmit, loading, pendingVerification };
}

function useSsoSignIn({
  ssoEnabled,
  isDesktopAuth,
  forceLogin,
  redirectUrl,
  searchParams,
}: {
  ssoEnabled: boolean;
  isDesktopAuth: boolean;
  forceLogin: boolean;
  redirectUrl: string;
  searchParams: ReturnType<typeof useSearchParams>;
}) {
  const [ssoLoading, setSsoLoading] = useState<string | null>(null);

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

  return { ssoLoading, handleSSO };
}

function SignInErrorAlert({
  error,
  pendingVerification,
  email,
}: {
  error: string | null;
  pendingVerification: boolean;
  email: string;
}) {
  if (!error) return null;
  return (
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
  );
}

function SsoProviderButtons({
  providers,
  ssoLoading,
  onSelect,
  className,
}: {
  providers: ClientAuthUiOptions["ssoProviders"];
  ssoLoading: string | null;
  onSelect: (provider: string) => void;
  className: string;
}) {
  return (
    <div className="space-y-3 mb-6">
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          onClick={() => onSelect(provider.id)}
          disabled={ssoLoading !== null}
          className={className}
        >
          <SsoProviderIcon icon={provider.icon} />
          {ssoLoading === provider.id ? "Redirecting..." : provider.label}
        </button>
      ))}
    </div>
  );
}

function SsoEmailDivider() {
  return (
    <div className="relative my-6">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-[var(--border)]" />
      </div>
      <div className="relative flex justify-center text-xs">
        <span className="bg-[var(--background)] px-4 text-[var(--muted)]">
          or continue with email
        </span>
      </div>
    </div>
  );
}

function EmailPasswordForm({
  email,
  password,
  loading,
  supportsPasswordReset,
  styles,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  email: string;
  password: string;
  loading: boolean;
  supportsPasswordReset: ClientAuthUiOptions["supportsPasswordReset"];
  styles: { labelText: string; linkMuted: string; field: string; submit: string };
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className={`block text-sm font-medium mb-2 ${styles.labelText}`}>
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          required
          className={styles.field}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="password" className={`block text-sm font-medium ${styles.labelText}`}>
            Password
          </label>
          {supportsPasswordReset ? (
          <Link href="/auth/forgot-password" className={`text-xs transition-colors ${styles.linkMuted}`}>
            Forgot password?
          </Link>
          ) : null}
        </div>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          required
          className={styles.field}
          placeholder="••••••••"
        />
      </div>

      <button type="submit" disabled={loading} className={styles.submit}>
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

function SignUpPrompt({
  redirectUrl,
  muted,
  createLink,
}: {
  redirectUrl: string;
  muted: string;
  createLink: string;
}) {
  return (
    <p className={`mt-8 text-center text-sm ${muted}`}>
      Don&apos;t have an account?{" "}
      <Link
        href={`/auth/sign-up${redirectUrl !== "/account" ? `?redirect=${encodeURIComponent(redirectUrl)}` : ""}`}
        className={createLink}
      >
        Create one
      </Link>
    </p>
  );
}

export function SignInClient({
  authUiOptions,
  ssoEnabled,
}: {
  authUiOptions: ClientAuthUiOptions;
  ssoEnabled: boolean;
}) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const labelText = "text-[var(--foreground)]";
  const linkMuted = "text-[var(--muted)] hover:text-[var(--foreground)]";
  const createLink = "text-[var(--foreground)] hover:underline font-medium";

  // Auth params intentionally gate first paint; page is client-gated by (shell).
  // react-doctor-disable-next-line react-doctor/no-hydration-branch-on-browser-global
  const redirectUrl = sanitizeClientAuthRedirect(searchParams?.get("redirect"));
  // Auth params intentionally gate first paint; page is client-gated by (shell).
  // react-doctor-disable-next-line react-doctor/no-hydration-branch-on-browser-global
  const forceLogin = searchParams?.get("force") === "true";
  const isDesktopAuth = redirectUrl.startsWith("overlay://");

  const [seenSearchParams, setSeenSearchParams] = useState<ReturnType<typeof useSearchParams> | null>(null);
  if (seenSearchParams !== searchParams) {
    setSeenSearchParams(searchParams);
    const errorParam = searchParams?.get("error");
    if (errorParam) {
      try {
        setError(decodeURIComponent(errorParam));
      } catch {
        setError(errorParam);
      }
    }
  }

  useEffect(() => {
    persistMobilePkceChallengeFromUrl(searchParams);
  }, [searchParams]);

  useClearExistingSession(isDesktopAuth, forceLogin);
  useRedirectExistingSession({
    authLoading,
    isAuthenticated,
    forceLogin,
    isDesktopAuth,
    redirectUrl,
  });
  const { handleSubmit, loading, pendingVerification } = useEmailPasswordSignIn({
    email,
    password,
    redirectUrl,
    setError,
  });
  const { ssoLoading, handleSSO } = useSsoSignIn({
    ssoEnabled,
    isDesktopAuth,
    forceLogin,
    redirectUrl,
    searchParams,
  });

  const muted = marketingAuthMuted();
  const sso = marketingSsoButton();
  const field = marketingPrimaryField();
  const submit = marketingSubmitButton();
  const ssoProviders = authUiOptions.ssoProviders;
  const showSso = Boolean(ssoEnabled && authUiOptions.supportsSso && ssoProviders.length > 0);
  const showPassword = authUiOptions.supportsPasswordSignIn === true;
  const shouldReuseExistingSession = shouldReuseExistingWebSession({
    authLoading,
    isAuthenticated,
    forceLogin,
    isDirectDesktopCallback: isDesktopAuth,
  });

  if (shouldReuseExistingSession) {
    return (
      <LandingAuthPageChrome>
        <div className="flex min-h-40 items-center justify-center">
          <p className="text-sm text-[var(--muted)]">Continuing to Overlay…</p>
        </div>
      </LandingAuthPageChrome>
    );
  }

  return (
    <LandingAuthPageChrome>
      <div>
        <h1 className={`text-2xl font-serif mb-2 ${labelText}`}>
          Welcome back
        </h1>
        <p className={`text-sm mb-8 ${muted}`}>
          Sign in to your overlay account
        </p>

          <SignInErrorAlert error={error} pendingVerification={pendingVerification} email={email} />

          {showSso ? (
            <SsoProviderButtons
              providers={ssoProviders}
              ssoLoading={ssoLoading}
              onSelect={handleSSO}
              className={sso}
            />
          ) : null}

          {showSso && showPassword ? <SsoEmailDivider /> : null}

          {showPassword ? (
            <EmailPasswordForm
              email={email}
              password={password}
              loading={loading}
              supportsPasswordReset={authUiOptions.supportsPasswordReset}
              styles={{ labelText, linkMuted, field, submit }}
              onEmailChange={setEmail}
              onPasswordChange={setPassword}
              onSubmit={handleSubmit}
            />
          ) : null}

          {authUiOptions.supportsPasswordSignUp ? (
            <SignUpPrompt redirectUrl={redirectUrl} muted={muted} createLink={createLink} />
          ) : null}
      </div>
    </LandingAuthPageChrome>
  );
}
