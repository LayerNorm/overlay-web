"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  Button,
  FloatingMenu,
  MenuItem,
} from "@overlay/ui/primitives";
import { SettingsGroup, SettingsToggle } from "@overlay/modules-react/settings";
import {
  DesktopDictationSettings,
  useLiveDictationStatus,
} from "./DesktopDictationSettings";
import {
  DesktopRow,
  DesktopSection,
  ShortcutRecorder,
} from "./DesktopSettingsParts";
import { DesktopLocalComputerSettings } from "./DesktopLocalComputerSettings";
import { DesktopModelKeysSettings } from "./DesktopModelKeysSettings";
import { DesktopLocalMcpSettings } from "./DesktopLocalMcpSettings";
import { useDesktopBridge } from "@/components/desktop/DesktopProvider";
import type {
  DesktopBridge,
  Input as BridgeInput,
  Model,
  TranscriptionStatus,
  UpdateStatus,
} from "@overlay/desktop-bridge";

type HotkeyId = BridgeInput<"hotkeys.set">["id"];
type Run = (action: () => Promise<unknown>) => Promise<void>;

export function DesktopSettings() {
  const desktop = useDesktopBridge();
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [transcription, setTranscription] =
    useState<TranscriptionStatus | null>(null);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState(false);
  const statusVersions = useRef({ update: 0 });
  const refresh = useCallback(async () => {
    if (!desktop) return;
    const { bridge, info } = desktop;
    const updateVersion = ++statusVersions.current.update;
    const tasks = [];
    if (info.capabilities.includes("diagnostics"))
      tasks.push(
        bridge
          .call("diagnostics.status", undefined)
          .then((status) => setDiagnostics(status.enabled)),
      );
    if (info.capabilities.includes("updates"))
      tasks.push(
        bridge.call("updates.status", undefined).then((status) => {
          if (statusVersions.current.update === updateVersion)
            setUpdate(status);
        }),
      );
    if (info.capabilities.includes("hotkeys"))
      tasks.push(bridge.call("hotkeys.list", undefined).then(setKeys));
    if (info.capabilities.includes("transcription"))
      tasks.push(
        bridge.call("transcription.status", undefined).then(setTranscription),
        bridge.call("transcription.listModels", undefined).then(setModels),
        // Older installed shells do not expose device selection.
        bridge
          .call("transcription.listDevices", undefined)
          .then(setDevices)
          .catch(() => {}),
      );
    await Promise.all(tasks);
  }, [desktop]);
  useEffect(() => {
    let active = true;
    const versions = statusVersions.current;
    const bridge = desktop?.bridge;
    const offUpdate = desktop?.info.capabilities.includes("updates")
      ? bridge?.on("updates.status", (status) => {
          statusVersions.current.update++;
          if (active) setUpdate(status);
        })
      : undefined;
    void refresh().catch(() => {
      if (active) setError("Could not read desktop settings.");
    });
    return () => {
      active = false;
      versions.update++;
      offUpdate?.();
    };
  }, [desktop, refresh]);
  useLiveDictationStatus(desktop, setTranscription, setDevices);
  const run: Run = async (action) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Desktop operation failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (!desktop) return null;
  const { bridge, info } = desktop;
  const mac = info.platform === "darwin";
  const can = (capability: (typeof info.capabilities)[number]) =>
    info.capabilities.includes(capability);
  const shortcut = (id: HotkeyId, label: string) =>
    can("hotkeys") ? (
      <ShortcutRecorder
        label={label}
        accelerator={keys[id]}
        mac={mac}
        disabled={busy}
        onChange={(accelerator) =>
          void run(() => bridge.call("hotkeys.set", { id, accelerator }))
        }
        onReset={() => void run(() => bridge.call("hotkeys.reset", { id }))}
      />
    ) : null;
  return (
    <div className="flex flex-col gap-8">
      {error ? (
        <p role="alert" className="px-1 text-sm text-red-500">
          {error}
        </p>
      ) : null}
      {can("transcription") ? (
        <DesktopDictationSettings
          bridge={bridge}
          models={models}
          devices={devices}
          transcription={transcription}
          busy={busy}
          shortcut={shortcut("dictation", "Dictation")}
          run={run}
        />
      ) : null}
      {can("panels") ? (
        <DesktopSection
          title="Floating panels"
          description="Keep chat or notes over your other apps."
        >
          <SettingsGroup>
            {(["chat", "notes"] as const).map((kind) => (
              <DesktopRow
                key={kind}
                title={kind === "chat" ? "Chat" : "Notes"}
                control={
                  <>
                    {shortcut(kind, kind === "chat" ? "Chat" : "Notes")}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void run(() => bridge.call("panels.toggle", { kind }))
                      }
                    >
                      Open
                    </Button>
                    <PanelMenu bridge={bridge} kind={kind} run={run} />
                  </>
                }
              />
            ))}
          </SettingsGroup>
        </DesktopSection>
      ) : null}
      {can("localComputer") && can("agentHost") ? (
        <DesktopLocalComputerSettings bridge={bridge} />
      ) : null}
      {can("localThreads") ? <DesktopModelKeysSettings /> : null}
      {can("localMcp") ? <DesktopLocalMcpSettings bridge={bridge} /> : null}
      <DesktopSection title="About">
        <SettingsGroup>
          <DesktopRow
            title={`Overlay for ${mac ? "Mac" : info.platform} ${info.appVersion}`}
            description={can("updates") ? updateLabel(update) : undefined}
            control={
              can("updates") ? (
                update?.state === "downloaded" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void run(() => bridge.call("updates.install", undefined))
                    }
                  >
                    Restart to update
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() => bridge.call("updates.check", undefined))
                    }
                  >
                    Check for updates
                  </Button>
                )
              ) : null
            }
          />
          {can("notifications") ? (
            <DesktopRow
              title="Notifications"
              description="If nothing appears, allow Overlay in System Settings → Notifications."
              control={
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      bridge.call("notifications.show", {
                        title: "Overlay",
                        body: "Desktop notifications are working.",
                        route: "/app/work",
                      }),
                    )
                  }
                >
                  Send test
                </Button>
              }
            />
          ) : null}
          {can("diagnostics") ? (
            <DesktopRow
              title="Crash reports"
              description="Share redacted diagnostics to help fix desktop crashes."
              control={
                <SettingsToggle
                  aria-label="Send desktop crash reports"
                  checked={diagnostics}
                  disabled={busy}
                  onChange={() =>
                    void run(() =>
                      bridge.call("diagnostics.configure", {
                        enabled: !diagnostics,
                      }),
                    )
                  }
                />
              }
            />
          ) : null}
          <DesktopRow
            title="Local data"
            description="Recordings and data kept from earlier versions of the app."
            control={
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void run(() => bridge.call("window.openDataFolder", undefined))
                }
              >
                Open folder
              </Button>
            }
          />
        </SettingsGroup>
      </DesktopSection>
    </div>
  );
}

function PanelMenu({
  bridge,
  kind,
  run,
}: {
  bridge: DesktopBridge;
  kind: "chat" | "notes";
  run: Run;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const dock = (edge: "right" | "none") => {
    setOpen(false);
    void run(() => bridge.call("panels.setDocked", { kind, edge }));
  };
  return (
    <FloatingMenu
      kind="menu"
      align="end"
      anchorRef={anchor}
      open={open}
      onOpenChange={setOpen}
      className="w-44"
      trigger={
        <Button
          ref={anchor}
          variant="ghost"
          size="icon-sm"
          aria-label={`${kind === "chat" ? "Chat" : "Notes"} panel position`}
        >
          <MoreHorizontal strokeWidth={1.75} />
        </Button>
      }
    >
      <MenuItem onClick={() => dock("right")}>Dock to right edge</MenuItem>
      <MenuItem onClick={() => dock("none")}>Float freely</MenuItem>
    </FloatingMenu>
  );
}

function updateLabel(update: UpdateStatus | null): string {
  if (!update) return "Checking for updates…";
  if (update.state === "downloaded")
    return `Version ${update.version ?? "update"} is ready to install.`;
  if (update.state === "downloading")
    return `Downloading update${update.percent ? ` · ${Math.round(update.percent)}%` : "…"}`;
  if (update.state === "checking") return "Checking for updates…";
  if (update.state === "error") return "Couldn't check for updates.";
  return update.message ?? "You're up to date.";
}
