"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Camera, Mic, Square } from "lucide-react";
import { PromptInputButton } from "@overlay/chat-react";
import { methodSchemas } from "@overlay/desktop-bridge";
import { useDesktopBridge } from "./DesktopProvider";
import {
  createComposerDictation,
  type DictationPhase,
} from "./composer-dictation";

export function DesktopComposerControls({
  onAppendText,
  onImages,
}: {
  onAppendText: (text: string) => void;
  onImages: (files: File[]) => void;
}) {
  const desktop = useDesktopBridge();
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [error, setError] = useState("");
  const current = useRef({ onAppendText, onImages });
  const attachment = useRef<{ active: boolean } | null>(null);
  const dictation = useRef<ReturnType<typeof createComposerDictation> | null>(
    null,
  );
  useLayoutEffect(() => {
    current.current = { onAppendText, onImages };
  }, [onAppendText, onImages]);
  useLayoutEffect(() => {
    if (!desktop) return;
    const capture = createComposerDictation({
      readModel: async () =>
        methodSchemas["transcription.transcribe"].shape.model.parse(
          (await desktop.bridge.call("transcription.status", undefined)).model,
        ),
      acquire: async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        return {
          release: () => stream.getTracks().forEach((track) => track.stop()),
          createCapture: () => {
            const recorder = new MediaRecorder(stream);
            return {
              mime: methodSchemas["transcription.transcribe"].shape.mime.parse(
                recorder.mimeType.split(";")[0],
              ),
              start: () => recorder.start(),
              stop: () => recorder.stop(),
              discard: () => {
                recorder.onstop = null;
                recorder.ondataavailable = null;
                if (recorder.state !== "inactive") recorder.stop();
              },
              onData: (callback: (chunk: Blob) => void) => {
                recorder.ondataavailable = (event) => callback(event.data);
              },
              onStop: (callback: () => void) => {
                recorder.onstop = callback;
              },
            };
          },
        };
      },
      transcribe: (audio) =>
        desktop.bridge.call("transcription.transcribe", audio),
      append: (text) => current.current.onAppendText(text),
      phase: setPhase,
      error: setError,
    });
    dictation.current = capture;
    const ticket = { active: true };
    attachment.current = ticket;
    const off = desktop.bridge.on("transcription.cancel", () =>
      capture.cancel(),
    );
    return () => {
      off?.();
      ticket.active = false;
      capture.cancel();
      dictation.current = null;
    };
  }, [desktop]);
  if (!desktop) return null;
  const { bridge, info } = desktop;
  const capturing = phase === "opening" || phase === "recording";
  return (
    <>
      {info.capabilities.includes("transcription") ? (
        <PromptInputButton
          aria-label={
            capturing
              ? "Stop dictation"
              : phase === "transcribing"
                ? "Transcribing message"
                : "Dictate message"
          }
          disabled={phase === "transcribing"}
          onClick={() => dictation.current?.toggle()}
        >
          {capturing ? <Square size={16} /> : <Mic size={16} />}
        </PromptInputButton>
      ) : null}
      {info.capabilities.includes("capture") ? (
        <PromptInputButton
          aria-label="Attach screenshot"
          onClick={() => {
            setError("");
            const ticket = attachment.current;
            void bridge
              .call("capture.screenshot", {})
              .then(async (shot) => {
                const blob = await (await fetch(shot.dataUrl)).blob();
                if (ticket?.active)
                  current.current.onImages([
                    new File([blob], shot.name, { type: blob.type }),
                  ]);
              })
              .catch(() => {
                if (ticket?.active)
                  setError(
                    "Could not capture the screen. Check Screen Recording permissions in System Settings.",
                  );
              });
          }}
        >
          <Camera size={16} />
        </PromptInputButton>
      ) : null}
      {error ? (
        <span role="alert" className="max-w-64 text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </>
  );
}
