"use client";
import { useEffect, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Check } from "lucide-react";
import { Button, ListboxSelect } from "@overlay/ui/primitives";
import { SettingsGroup } from "@overlay/modules-react/settings";
import type {
  DesktopBridge,
  Input as BridgeInput,
  Model,
  TranscriptionStatus,
} from "@overlay/desktop-bridge";
import { useDesktopBridge } from "@/components/desktop/DesktopProvider";
import { DesktopRow, DesktopSection } from "./DesktopSettingsParts";

type Props = {
  bridge: DesktopBridge;
  models: Model[];
  devices: { id: string; label: string }[];
  transcription: TranscriptionStatus | null;
  busy: boolean;
  /** The dictation shortcut recorder, when the shell supports hotkeys. */
  shortcut: ReactNode;
  run(action: () => Promise<unknown>): Promise<void>;
};

export function DesktopDictationSettings({
  bridge,
  models,
  devices,
  transcription,
  busy,
  shortcut,
  run,
}: Props) {
  const locked =
    busy || transcription?.recording || transcription?.phase === "processing";
  const missing = [
    transcription && transcription.microphone !== "granted"
      ? "Microphone"
      : null,
    transcription && !transcription.accessibility ? "Accessibility" : null,
  ].filter(Boolean);
  return (
    <>
      <DesktopSection
        title="Dictation"
        description="Speak into any app on your Mac."
      >
        <SettingsGroup>
          {shortcut ? (
            <DesktopRow
              title="Shortcut"
              description="Tap to start and stop, or hold to talk."
              control={shortcut}
            />
          ) : null}
          <DesktopRow
            title="Model"
            description="Cloud is billed to your workspace. Local models run on this Mac, even offline."
            control={
              <ListboxSelect
                className="w-48"
                value={transcription?.model ?? "cloud"}
                options={[
                  { value: "cloud", label: "Cloud" },
                  ...models
                    .filter((m) => m.downloaded || m.id === transcription?.model)
                    .map((m) => ({ value: m.id, label: m.name })),
                ]}
                aria-label="Dictation model"
                disabled={locked}
                onChange={(model) =>
                  void run(() =>
                    bridge.call("transcription.configure", {
                      model:
                        model as BridgeInput<"transcription.configure">["model"],
                    }),
                  )
                }
              />
            }
          />
          {transcription?.inputDeviceId !== undefined ? (
            <DesktopRow
              title="Microphone"
              description="Automatic prefers the built-in microphone."
              control={
                <ListboxSelect
                  className="w-48"
                  aria-label="Dictation microphone"
                  value={transcription.inputDeviceId}
                  disabled={locked}
                  options={[
                    { value: "auto", label: "Automatic" },
                    ...devices.map((device) => ({
                      value: device.id,
                      label: device.label,
                    })),
                    ...(transcription.inputDeviceId !== "auto" &&
                    !devices.some((d) => d.id === transcription.inputDeviceId)
                      ? [
                          {
                            value: transcription.inputDeviceId,
                            label: "Disconnected microphone",
                          },
                        ]
                      : []),
                  ]}
                  onChange={(inputDeviceId) =>
                    void run(() =>
                      bridge.call("transcription.configure", {
                        model:
                          transcription.model as BridgeInput<"transcription.configure">["model"],
                        inputDeviceId,
                      }),
                    )
                  }
                />
              }
            />
          ) : null}
          {transcription ? (
            <DesktopRow
              title="Permissions"
              description={
                missing.length
                  ? `Turn on ${missing.join(" and ")} for Overlay in System Settings → Privacy & Security.`
                  : "Overlay can hear you and type into other apps."
              }
              control={
                <span
                  className={`flex items-center gap-1.5 text-xs ${missing.length ? "text-(--foreground)" : "text-(--muted)"}`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${missing.length ? "bg-amber-500" : "bg-emerald-500"}`}
                  />
                  {missing.length ? "Needs access" : "Allowed"}
                </span>
              }
            />
          ) : null}
        </SettingsGroup>
      </DesktopSection>
      {models.length ? (
        <DesktopSection
          title="Local models"
          description="Download a model to dictate without a connection."
        >
          <SettingsGroup>
            {models.map((model) => (
              <DesktopRow
                key={model.id}
                title={model.name}
                control={
                  model.downloaded ? (
                    <span className="flex items-center gap-1 text-xs text-(--muted)">
                      <Check size={14} strokeWidth={1.75} aria-hidden />
                      Downloaded
                    </span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          bridge.call("transcription.downloadModel", {
                            id: model.id as BridgeInput<"transcription.downloadModel">["id"],
                          }),
                        )
                      }
                    >
                      Download
                    </Button>
                  )
                }
              />
            ))}
          </SettingsGroup>
        </DesktopSection>
      ) : null}
    </>
  );
}

export function useLiveDictationStatus(
  desktop: ReturnType<typeof useDesktopBridge>,
  setTranscription: Dispatch<SetStateAction<TranscriptionStatus | null>>,
  setDevices: Dispatch<SetStateAction<{ id: string; label: string }[]>>,
) {
  useEffect(() => {
    if (!desktop?.info.capabilities.includes("transcription")) return;
    let active = true,
      pending = false;
    const read = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const status = await desktop.bridge.call(
          "transcription.status",
          undefined,
        );
        if (active) {
          setTranscription(status);
          if (status.inputDeviceId !== undefined) {
            const devices = await desktop.bridge.call(
              "transcription.listDevices",
              undefined,
            );
            if (active) setDevices(devices);
          }
        }
      } catch {
        /* A closing native window needs no settings error. */
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(() => void read(), 1000);
    window.addEventListener("focus", read);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, [desktop, setTranscription, setDevices]);
}
