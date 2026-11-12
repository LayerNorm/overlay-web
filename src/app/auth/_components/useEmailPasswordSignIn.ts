'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { postVerifyEmail, readAuthErrorMessage } from './EmailVerification'

export function useEmailPasswordSignIn({
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
  const [loading, setLoading] = useState(false);
  const [verificationTicket, setVerificationTicket] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  const signIn = async () => {
    // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check
    const response = await fetch("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json().catch(() => null);

    if (data?.pendingEmailVerification) {
      const ticket = typeof data.verificationTicket === "string" ? data.verificationTicket : "";
      if (ticket) {
        setVerificationTicket(ticket);
      } else {
        setError(readAuthErrorMessage(data, "Please verify your email before signing in."));
      }
      return false;
    }

    if (!response.ok) {
      setError(readAuthErrorMessage(data, "Sign in failed"));
      return false;
    }

    await refreshSession();

    if (redirectUrl.startsWith("overlay://")) {
      window.location.href = redirectUrl;
    } else {
      window.location.replace(redirectUrl);
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signIn();
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationTicket) return;
    setVerifying(true);
    setError(null);
    try {
      const result = await postVerifyEmail(
        { ticket: verificationTicket, code: verificationCode },
        "Verification failed",
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setVerificationTicket(null);
      setVerificationCode("");
      await signIn();
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setVerifying(false);
    }
  };

  const handleResendCode = async () => {
    if (!verificationTicket) return;
    setResending(true);
    setError(null);
    const result = await postVerifyEmail(
      { ticket: verificationTicket, action: "resend" },
      "Failed to resend code",
    );
    if (result.error) setError(result.error);
    setResending(false);
  };

  return {
    signIn,
    handleSubmit,
    loading,
    verification: verificationTicket
      ? {
          code: verificationCode,
          verifying,
          resending,
          onCodeChange: setVerificationCode,
          onVerify: handleVerifyCode,
          onResend: handleResendCode,
        }
      : null,
  };
}
