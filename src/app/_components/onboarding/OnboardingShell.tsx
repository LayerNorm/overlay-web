"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDesktopBridge } from "@/components/desktop/DesktopProvider";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@overlay/ui/primitives";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { OnboardingSessionResponse } from "@/shared/onboarding/session";
import { buildWorkspaceHref } from "@/shared/workspaces/routing";
import {
  OnboardingConversation,
  OnboardingDots,
} from "./OnboardingConversation";
import { OnboardingIntro } from "./OnboardingIntro";
import { OnboardingTour } from "./OnboardingTour";
import { requestOnboarding, skipOnboarding } from "./onboarding-client";
import styles from "./onboarding.module.css";

type ShellProps = { sidebar: ReactNode; children: ReactNode };

export function OnboardingShell(props: ShellProps) {
  const { user } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const desktop = useDesktopBridge();
  const search = useSearchParams();
  const path = usePathname();
  if (
    desktop &&
    (desktop.info.surface === "panel" || search?.get("surface") === "panel") &&
    /\/(chat|notes)$/.test(path ?? "")
  )
    return (
      <main
        data-desktop-panel
        className="app-main min-w-0 flex-1 overflow-hidden rounded-xl border bg-background pt-8"
      >
        <div
          data-desktop-drag
          className="fixed inset-x-0 top-0 h-8 border-b bg-background"
        />
        {props.children}
      </main>
    );
  if (!user || !activeWorkspaceId)
    return (
      <>
        {props.sidebar}
        <main className="app-main min-w-0 flex-1 overflow-hidden pt-14 md:pt-0">
          {props.children}
        </main>
      </>
    );
  return (
    <AuthenticatedOnboardingShell
      key={`${user.id}:${activeWorkspaceId}`}
      {...props}
      workspaceId={activeWorkspaceId}
    />
  );
}

function AuthenticatedOnboardingShell({
  sidebar,
  children,
  workspaceId,
}: ShellProps & { workspaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [result, setResult] = useState<OnboardingSessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [bypass, setBypass] = useState(false);
  const [intro, setIntro] = useState(false);
  const [active, setActive] = useState(false);
  const [showWork, setShowWork] = useState(false);
  const [tour, setTour] = useState(false);
  const conversation = useRef<HTMLDivElement>(null);
  const dismissIntro = useCallback(() => setIntro(false), []);
  const skip = useCallback(() => {
    // If saving fails, still open the workspace for this visit; setup resumes next time.
    void skipOnboarding(workspaceId).then(
      () => {
        setActive(false);
        setTour(false);
      },
      () => setBypass(true),
    );
  }, [workspaceId]);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      let next = await requestOnboarding(workspaceId, undefined, abort.signal);
      if (!next.completed) {
        const fresh = !next.session;
        next = await requestOnboarding(
          workspaceId,
          { action: "start" },
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setActive(true);
          setIntro(fresh);
        }
      }
      if (!abort.signal.aborted) setResult(next);
    })().catch((value) => {
      if (!abort.signal.aborted)
        setError(
          value instanceof Error ? value.message : "Could not load onboarding.",
        );
    });
    return () => abort.abort();
  }, [workspaceId, retry]);
  const taskId = result?.session?.taskId;
  const openWork = useCallback(() => {
    if (!taskId) return;
    setShowWork(true);
    setTour(true);
    router.push(
      `${buildWorkspaceHref(workspaceId, "/app/work")}?task=${encodeURIComponent(taskId)}&scope=personal`,
    );
  }, [taskId, router, workspaceId]);
  useEffect(() => {
    if (!active || !result?.completed || showWork) return;
    const timer = window.setTimeout(openWork, 1400);
    return () => window.clearTimeout(timer);
  }, [active, result?.completed, showWork, openWork]);
  const locked = !bypass && (!result || (active && !result.completed));
  const atWork = pathname?.endsWith("/work");
  const showConversation =
    !bypass && active && result?.session && (!showWork || !atWork);
  return (
    <>
      <div
        className={styles.chrome}
        data-hidden={locked}
        inert={locked}
        aria-hidden={locked}
      >
        {sidebar}
      </div>
      <main
        data-onboarding-locked={locked}
        className={`app-main ${styles.main} ${locked ? "" : "pt-14 md:pt-0"}`}
      >
        {!bypass && !result ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="max-w-sm space-y-4 text-center">
              {error ? (
                <>
                  <p role="alert" className="text-sm text-muted-foreground">
                    {error}
                  </p>
                  <div className="flex justify-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setRetry((value) => value + 1)}
                    >
                      Retry
                    </Button>
                    <Button variant="ghost" onClick={() => setBypass(true)}>
                      Open workspace
                    </Button>
                  </div>
                </>
              ) : (
                <OnboardingDots />
              )}
            </div>
          </div>
        ) : showConversation && result?.session ? (
          <div
            ref={conversation}
            className={styles.conversation}
            data-hidden={intro}
            inert={intro}
          >
            <OnboardingConversation
              session={result.session}
              onChange={setResult}
              onShowWork={openWork}
              onSkip={skip}
            />
          </div>
        ) : (
          children
        )}
        {intro ? <OnboardingIntro onDone={dismissIntro} /> : null}
        {tour && atWork && result?.session?.taskId ? (
          <OnboardingTour
            workspaceId={workspaceId}
            taskId={result.session.taskId}
            onClose={() => {
              setTour(false);
              setActive(false);
            }}
          />
        ) : null}
      </main>
    </>
  );
}
