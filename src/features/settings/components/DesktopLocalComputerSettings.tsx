"use client";

import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { Button } from "@overlay/ui/primitives";
import { SettingsGroup, SettingsToggle } from "@overlay/modules-react/settings";
import type { DesktopBridge } from "@overlay/desktop-bridge";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { folderName } from "@/components/desktop/this-computer";
import { useThisComputer } from "@/components/desktop/useThisComputer";
import { DesktopRow, DesktopSection } from "./DesktopSettingsParts";

const message = (value: unknown, fallback: string) => (value instanceof Error ? value.message : fallback);

/**
 * "This computer": agent threads can run on the computer the desktop app is open on, in the folders its owner
 * chooses (internal/develop/thread-folders.md). Connecting needs no code: the app starts the bundled host and
 * approves the enrollment it just created. Folders are chosen in the system's folder dialog.
 */
export function DesktopLocalComputerSettings({ bridge }: { bridge: DesktopBridge }) {
  const { activeWorkspaceId } = useWorkspace();
  const computer = useThisComputer(activeWorkspaceId);
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[] | null>(null);
  const { status, environment } = computer;

  const attempt = async (action: () => Promise<unknown>, fallback: string) => {
    setError("");
    try {
      await action();
    } catch (value) {
      setError(message(value, fallback));
    }
  };

  const setAvailable = (enabled: boolean) => attempt(async () => {
    await bridge.call("localComputer.setKeepAvailable", { enabled });
    if (!enabled) await bridge.call("agentHost.stop", undefined);
    await computer.refresh();
  }, "Could not change this computer.");

  const toggleLog = async () => {
    if (log) return setLog(null);
    try {
      setLog(await bridge.call("agentHost.logs", undefined));
    } catch {
      setLog([]);
    }
  };

  const allow = (permission: "accessibility" | "screen_recording") => attempt(async () => {
    await bridge.call("localComputer.requestPermission", { permission });
    await computer.refresh();
  }, "Could not open System Settings.");

  const connecting = computer.busy && !environment;
  const label = connecting ? "Connecting…" : computer.online ? "Ready" : computer.running ? "Starting…" : environment ? "Off" : "Not connected";
  const dot = computer.online ? "bg-emerald-500" : connecting || computer.running ? "bg-amber-500" : "bg-(--muted-light)";

  return (
    <>
      <DesktopSection
        title="This computer"
        description="Agents can run threads on this computer. Overlay asks before it runs commands, types in apps or submits forms. Only you can use it, never your teammates."
      >
        <SettingsGroup>
          <DesktopRow
            title={
              <span className="flex items-center gap-2">
                <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                {label}
              </span>
            }
            description={computer.name ?? undefined}
            control={environment ? (
              <>
                <Button variant="ghost" size="sm" aria-expanded={log !== null} onClick={() => void toggleLog()}>
                  {log ? "Hide log" : "Log"}
                </Button>
                <SettingsToggle
                  checked={status?.keepAvailable === true && computer.running}
                  disabled={computer.busy}
                  onChange={() => void setAvailable(!(status?.keepAvailable === true && computer.running))}
                  aria-label="Let agents run threads on this computer"
                />
              </>
            ) : (
              <Button variant="secondary" size="sm" disabled={computer.busy} onClick={() => void attempt(computer.connect, "Could not connect this computer.")}>
                Use this computer
              </Button>
            )}
          >
            {log?.length ? (
              <pre className="max-h-48 overflow-auto rounded-lg bg-(--surface-subtle) p-3 font-mono text-[11px] leading-relaxed text-(--muted)">
                {log.join("\n")}
              </pre>
            ) : null}
          </DesktopRow>
          <DesktopRow
            title="Local threads"
            description="Saved to your Overlay account, so you can read them on any device. They continue only on this computer."
          />
        </SettingsGroup>
        {error ? <p className="px-1 text-xs text-red-500">{error}</p> : null}
      </DesktopSection>
      {environment ? (
        <>
          <DesktopSection title="Folders" description="Folders on this computer that threads can work in. Nothing is uploaded.">
            <SettingsGroup>
              {computer.folders.map((path) => (
                <DesktopRow
                  key={path}
                  title={folderName(path)}
                  description={<span className="font-mono text-[11px]">{path}</span>}
                  control={
                    <Button variant="ghost" size="sm" disabled={computer.busy} onClick={() => void attempt(() => computer.removeFolder(path), "Could not remove that folder.")}>
                      Remove
                    </Button>
                  }
                />
              ))}
              <DesktopRow
                title="Add a folder"
                control={
                  <Button variant="secondary" size="sm" disabled={computer.busy} onClick={() => void attempt(computer.chooseFolder, "Could not add that folder.")}>
                    <FolderPlus size={14} />Choose folder…
                  </Button>
                }
              />
            </SettingsGroup>
          </DesktopSection>
          <DesktopSection title="System permissions">
            <SettingsGroup>
              <PermissionRow
                title="Screen Recording"
                description="Lets agents take screenshots of this computer."
                granted={status?.permissions.screenRecording === true}
                onAllow={() => void allow("screen_recording")}
              />
              <PermissionRow
                title="Accessibility"
                description="Lets agents click and type in your apps."
                granted={status?.permissions.accessibility === true}
                onAllow={() => void allow("accessibility")}
              />
            </SettingsGroup>
          </DesktopSection>
        </>
      ) : null}
    </>
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
