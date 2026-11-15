"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@overlay/ui/primitives";
import { SettingsGroup, SettingsToggle } from "@overlay/modules-react/settings";
import type { DesktopBridge, LocalComputerStatus } from "@overlay/desktop-bridge";
import type { AgentEnvironmentResource } from "@overlay/api-client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useLiveAgentEnvironments } from "@/hooks/use-connections";
import { overlayAppClient } from "@/shared/app/overlay-app-client";
import { DesktopRow, DesktopSection } from "./DesktopSettingsParts";

const CONNECT_TIMEOUT_MS = 3 * 60_000;

function servesLocalTools(environment: AgentEnvironmentResource): boolean {
  const localTools = (environment.capabilities as { localTools?: { version?: unknown } } | undefined)?.localTools;
  return environment.kind === "local" && localTools?.version === 1;
}

/**
 * "This Mac": lets Overlay agents use this Mac's files, apps and browser as a
 * Computer. One click creates a code, starts the bundled host with local tools
 * (no third-party harness), matches the phrase the host printed to its pending
 * enrollment and approves the chosen folders.
 */
export function DesktopLocalComputerSettings({ bridge }: { bridge: DesktopBridge }) {
  const { activeWorkspaceId } = useWorkspace();
  const environments = useLiveAgentEnvironments();
  const [status, setStatus] = useState<LocalComputerStatus | null>(null);
  const [folders, setFolders] = useState("");
  const [connecting, setConnecting] = useState<{ startedAt: number; roots: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[] | null>(null);
  const approving = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await bridge.call("localComputer.status", undefined);
      setStatus(next);
      setFolders((current) => current || next.homeDirectory);
    } catch {
      /* The section stays in its last known state. */
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), connecting ? 1_500 : 5_000);
    const off = bridge.on("agentHost.status", () => void refresh());
    return () => {
      window.clearInterval(timer);
      off();
    };
  }, [bridge, connecting, refresh]);

  const pending = useMemo(
    () => environments?.find((environment) => environment.status === "pending"
      && Boolean(status?.verificationPhrase)
      && environment.verificationPhrase === status?.verificationPhrase),
    [environments, status?.verificationPhrase],
  );
  const connected = useMemo(
    () => [...(environments ?? [])]
      .filter((environment) => servesLocalTools(environment) && environment.status !== "pending" && environment.status !== "revoked")
      .sort((left, right) => (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0))[0],
    [environments],
  );

  // The phrase this Mac's host printed matches its pending enrollment, so it is safe to approve without typing it.
  useEffect(() => {
    if (!connecting || !pending || !activeWorkspaceId || approving.current) return;
    approving.current = true;
    void (async () => {
      try {
        await overlayAppClient.agentEnvironments.approve(activeWorkspaceId, pending.id, { mode: "selected_roots", roots: connecting.roots });
        await bridge.call("localComputer.setKeepAvailable", { enabled: true });
        setConnecting(null);
        await refresh();
      } catch (value) {
        setError(value instanceof Error ? value.message : "Could not approve this Mac.");
        setConnecting(null);
      } finally {
        approving.current = false;
      }
    })();
  }, [activeWorkspaceId, bridge, connecting, pending, refresh]);

  useEffect(() => {
    if (!connecting) return;
    const timer = window.setTimeout(() => {
      setConnecting(null);
      setError("This Mac did not finish connecting. Open the log to see why, then try again.");
    }, Math.max(0, connecting.startedAt + CONNECT_TIMEOUT_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [connecting]);

  const connect = async () => {
    const roots = folders.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
    if (!activeWorkspaceId) return setError("Choose a workspace first.");
    if (roots.length === 0 || roots.some((root) => !root.startsWith("/"))) return setError("Enter at least one full folder path, such as /Users/you/Projects.");
    setBusy(true);
    setError("");
    try {
      const enrollment = await overlayAppClient.agentEnvironments.createEnrollment(activeWorkspaceId, { localTools: true });
      await bridge.call("agentHost.start", { enrollmentCode: enrollment.code, localTools: true });
      setConnecting({ startedAt: Date.now(), roots });
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not connect this Mac.");
    } finally {
      setBusy(false);
    }
  };

  const setAvailable = async (enabled: boolean) => {
    setBusy(true);
    setError("");
    try {
      await bridge.call("localComputer.setKeepAvailable", { enabled });
      if (!enabled) await bridge.call("agentHost.stop", undefined);
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not change this Mac.");
    } finally {
      setBusy(false);
    }
  };

  const toggleLog = async () => {
    if (log) return setLog(null);
    try {
      setLog(await bridge.call("agentHost.logs", undefined));
    } catch {
      setLog([]);
    }
  };

  const allow = async (permission: "accessibility" | "screen_recording") => {
    setError("");
    try {
      setStatus(await bridge.call("localComputer.requestPermission", { permission }));
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not open System Settings.");
    }
  };

  const running = status?.localTools === true && (status.hostState === "running" || status.hostState === "starting");
  const online = running && connected?.status === "online";
  const label = connecting ? "Connecting…" : online ? "Available to your agents" : running ? "Starting…" : connected ? "Off" : "Not connected";
  const dot = online ? "bg-emerald-500" : connecting || running ? "bg-amber-500" : "bg-(--muted-light)";
  const roots = connected?.filesystemGrant?.mode === "selected_roots" ? connected.filesystemGrant.roots : null;

  return (
    <DesktopSection
      title="This Mac"
      description="Let your agents work on this Mac, using its files, apps and browser, as well as in the cloud. Overlay asks before it types, runs commands or submits forms."
    >
      <SettingsGroup>
        <DesktopRow
          title={
            <span className="flex items-center gap-2">
              <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              {label}
            </span>
          }
          description={connected && roots ? `Folders: ${roots.join(", ")}` : undefined}
          control={connected && !connecting ? (
            <>
              <Button variant="ghost" size="sm" aria-expanded={log !== null} onClick={() => void toggleLog()}>
                {log ? "Hide log" : "Log"}
              </Button>
              <SettingsToggle
              checked={status?.keepAvailable === true && running}
              disabled={busy}
              onChange={() => void setAvailable(!(status?.keepAvailable === true && running))}
              aria-label="Keep this Mac available to your agents"
              />
            </>
          ) : (
            <Button variant="secondary" size="sm" disabled={busy || Boolean(connecting)} onClick={() => void connect()}>
              Use this Mac
            </Button>
          )}
        >
          {log?.length ? (
            <pre className="max-h-48 overflow-auto rounded-lg bg-(--surface-subtle) p-3 font-mono text-[11px] leading-relaxed text-(--muted)">
              {log.join("\n")}
            </pre>
          ) : null}
          {!connected && !connecting ? (
            <Input
              aria-label="Folders Overlay can use"
              placeholder="Folders Overlay can use"
              value={folders}
              onChange={(event) => setFolders(event.target.value)}
            />
          ) : null}
        </DesktopRow>
        {connected ? (
          <>
            <PermissionRow
              title="Screen Recording"
              description="Lets agents take screenshots of this Mac."
              granted={status?.permissions.screenRecording === true}
              onAllow={() => void allow("screen_recording")}
            />
            <PermissionRow
              title="Accessibility"
              description="Lets agents click and type in your apps."
              granted={status?.permissions.accessibility === true}
              onAllow={() => void allow("accessibility")}
            />
          </>
        ) : null}
      </SettingsGroup>
      {error ? <p className="px-1 text-xs text-red-500">{error}</p> : null}
    </DesktopSection>
  );
}

function PermissionRow({ title, description, granted, onAllow }: {
  title: string;
  description: string;
  granted: boolean;
  onAllow: () => void;
}) {
  return (
    <DesktopRow
      title={title}
      description={description}
      control={granted
        ? <span className="text-xs text-(--muted-light)">Allowed</span>
        : <Button variant="secondary" size="sm" onClick={onAllow}>Allow</Button>}
    />
  );
}
