"use client";
import { useEffect, type Dispatch, type SetStateAction } from "react";
import { Button, ListboxSelect } from "@overlay/ui/primitives";
import {
  SettingsActionRow,
  SettingsGroup,
} from "@overlay/modules-react/settings";
import type {
  DesktopBridge,
  Input as BridgeInput,
  Model,
  TranscriptionStatus,
} from "@overlay/desktop-bridge";
import { useDesktopBridge } from "@/components/desktop/DesktopProvider";

type Props = {
  bridge: DesktopBridge;
  models: Model[];
  devices: { id: string; label: string }[];
  transcription: TranscriptionStatus | null;
  busy: boolean;
  run(action: () => Promise<unknown>): Promise<void>;
};
export function DesktopDictationSettings({
  bridge,
  models,
  devices,
  transcription,
  busy,
  run,
}: Props) {
  return (
    <SettingsGroup>
      <SettingsActionRow
        icon={null}
        title="Dictation model"
        description="Local models run on your Mac, including offline. Cloud dictation uses your Overlay account."
        action={
          <ListboxSelect
            value={transcription?.model ?? "cloud"}
            options={[
              { value: "cloud", label: "Cloud" },
              ...models.map((m) => ({ value: m.id, label: m.name })),
            ]}
            aria-label="Dictation model"
            disabled={
              busy ||
              transcription?.recording ||
              transcription?.phase === "processing"
            }
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
        <SettingsActionRow
          icon={null}
          title="Dictation microphone"
          description="For the dictation shortcut. Automatic prefers the built-in microphone; a disconnected input falls back to the system default."
          action={
            <ListboxSelect
              aria-label="Dictation microphone"
              value={transcription.inputDeviceId}
              disabled={
                busy ||
                transcription.recording ||
                transcription.phase === "processing"
              }
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
      {models.map((model) => (
        <SettingsActionRow
          icon={null}
          key={model.id}
          title={model.name}
          description={
            model.downloaded ? "Ready on this Mac" : "Download to use offline"
          }
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={busy || model.downloaded}
              onClick={() =>
                void run(() =>
                  bridge.call("transcription.downloadModel", {
                    id: model.id as BridgeInput<"transcription.downloadModel">["id"],
                  }),
                )
              }
            >
              {model.downloaded ? "Downloaded" : "Download"}
            </Button>
          }
        />
      ))}
      <p className="px-4 pb-3 text-xs text-muted-foreground">
        Microphone: {transcription?.microphone ?? "checking"} · Accessibility:{" "}
        {transcription?.accessibility
          ? "allowed"
          : "enable in System Settings for dictation into other apps"}
      </p>
    </SettingsGroup>
  );
}

export function useLiveDictationStatus(
  desktop: ReturnType<typeof useDesktopBridge>,
  setTranscription: Dispatch<SetStateAction<TranscriptionStatus | null>>,
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
        if (active) setTranscription(status);
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
  }, [desktop, setTranscription]);
}
