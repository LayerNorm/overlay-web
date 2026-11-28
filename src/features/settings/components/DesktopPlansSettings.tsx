"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@overlay/ui/primitives";
import { SettingsGroup } from "@overlay/modules-react/settings";
import { useLocalPlans } from "@/components/desktop/useLocalThreads";
import { PRIVATE_PLAN_NAMES, PRIVATE_PLAN_PROVIDERS, type PrivatePlanProvider } from "@/shared/agents/private-threads";
import { DesktopRow, DesktopSection } from "./DesktopSettingsParts";

/**
 * Claude and ChatGPT plans for private threads (internal/develop/private-threads.md). Sign-in opens the provider in
 * the browser; the desktop app keeps the tokens in this computer's keychain and the page only learns who is signed in.
 */
export function DesktopPlansSettings() {
  const { plans, signIn, cancelSignIn, signOut } = useLocalPlans();
  const [signing, setSigning] = useState<PrivatePlanProvider | null>(null);
  const [error, setError] = useState("");

  if (!plans?.available) return null;

  const start = async (provider: PrivatePlanProvider) => {
    setSigning(provider);
    setError("");
    try {
      await signIn(provider);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      if (!/cancelled/i.test(message)) setError(message || "Sign-in didn’t finish. Try again.");
    } finally {
      setSigning(null);
    }
  };

  return (
    <DesktopSection
      title="Plans"
      description="Threads that aren’t synced can use a plan you already pay for. You sign in in your browser; the sign-in stays in this computer’s keychain and is never sent to Overlay."
    >
      <SettingsGroup>
        {PRIVATE_PLAN_PROVIDERS.map((provider) => {
          const plan = plans[provider];
          const name = PRIVATE_PLAN_NAMES[provider];
          return (
            <DesktopRow
              key={provider}
              title={name}
              description={signing === provider
                ? "Finish signing in in your browser"
                : plan.signedIn
                  ? `Signed in to ${name}${plan.account ? ` · ${plan.account}` : ""}`
                  : "Not signed in"}
              control={signing === provider ? (
                <>
                  <Loader2 size={14} className="animate-spin text-(--muted)" aria-hidden />
                  <Button variant="ghost" size="sm" onClick={cancelSignIn}>Cancel</Button>
                </>
              ) : plan.signedIn ? (
                <Button variant="ghost" size="sm" disabled={signing !== null} onClick={() => void signOut(provider)}>Sign out</Button>
              ) : (
                <Button variant="ghost" size="sm" disabled={signing !== null} onClick={() => void start(provider)}>Sign in</Button>
              )}
            />
          );
        })}
      </SettingsGroup>
      {error ? <p role="alert" className="px-1 text-xs text-destructive">{error}</p> : null}
    </DesktopSection>
  );
}
