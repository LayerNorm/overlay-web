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
import { useLiveWorkspaceBilling } from "@/hooks/use-billing";
import type { OnboardingSession, OnboardingSessionResponse } from "@/shared/onboarding/session";
import { useWorkspaceHref } from "@/hooks/use-workspace-href";
import { OnboardingWorkHandoff } from "@/components/providers/OnboardingWorkHandoff";
import {
  OnboardingConversation,
  OnboardingDots,
} from "./OnboardingConversation";
import { OnboardingIntro } from "./OnboardingIntro";
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
  const billingSummary = useLiveWorkspaceBilling(workspaceId);
  const { activeWorkspace } = useWorkspace();
  const buildWorkspaceHref = useWorkspaceHref();
  const pathname = usePathname();
  const [result, setResult] = useState<OnboardingSessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [bypass, setBypass] = useState(false);
  const [intro, setIntro] = useState(false);
  const [active, setActive] = useState(false);
  const [handoff, setHandoff] = useState<{ taskId: string; session: OnboardingSession } | null>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const dismissIntro = useCallback(() => setIntro(false), []);
  const skip = useCallback(() => {
    // If saving fails, still open the workspace for this visit; setup resumes next time.
    void skipOnboarding(workspaceId).then(
      () => {
        setActive(false);
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
  const openWork = useCallback((taskId = result?.session?.taskId, replace = false) => {
    if (!taskId) return;
    const href = buildWorkspaceHref(workspaceId, `/app/work?task=${encodeURIComponent(taskId)}&scope=personal`, 'personal');
    if (replace) router.replace(href);
    else router.push(href);
  }, [buildWorkspaceHref, result?.session?.taskId, router, workspaceId]);
  const finishHandoff = useCallback(() => setHandoff(null), []);
  const updateResult = (next: OnboardingSessionResponse) => {
    if (next.completed && next.session?.taskId) {
      setHandoff({ taskId: next.session.taskId, session: result?.session ?? next.session });
      setActive(false);
      openWork(next.session.taskId);
    }
    setResult(next);
  };
  const billingRecovery = pathname?.endsWith('/settings') && result?.session?.step === 'task';
  const locked = !bypass && !billingRecovery && (!result || (active && !result.completed) || Boolean(handoff));
  const visibleSession = handoff?.session ?? result?.session;
  const showConversation =
    !bypass && !billingRecovery && billingSummary && visibleSession && (active || Boolean(handoff));
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
        {!bypass && (!result || (active && !result.completed && !billingSummary)) ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="max-w-sm space-y-4 text-center">
              {error || billingSummary === null ? (
                <>
                  <p role="alert" className="text-sm text-muted-foreground">
                    {error ?? 'Workspace billing is unavailable. Please reload and try again.'}
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
        ) : showConversation && visibleSession ? (
          <div
            ref={conversation}
            className={`${styles.conversation} ${handoff ? "relative z-10 bg-background" : ""}`}
            data-hidden={intro}
            inert={intro || Boolean(handoff)}
          >
            <OnboardingConversation
              session={visibleSession}
              billingSummary={billingSummary!}
              personal={activeWorkspace?.kind === 'personal'}
              workspaceName={activeWorkspace?.name ?? visibleSession.workspaceContext?.workspaceName ?? 'Your workspace'}
              onChange={updateResult}
              onShowWork={() => openWork()}
              onSkip={skip}
            />
          </div>
        ) : null}
        {(!locked && (bypass || result)) || handoff ? <OnboardingWorkHandoff pending={handoff ? { taskId: handoff.taskId, onReady: finishHandoff, onTaskMissing: () => openWork(handoff.taskId, true) } : null}>
          {children}
        </OnboardingWorkHandoff> : null}
        {intro && !billingRecovery && billingSummary ? <OnboardingIntro onDone={dismissIntro} /> : null}
      </main>
    </>
  );
}
