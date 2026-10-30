import type { Input } from "@overlay/desktop-bridge";

type Audio = Input<"transcription.transcribe">;
export type DictationPhase = "idle" | "opening" | "recording" | "transcribing";
export type AudioCapture = {
  mime: Audio["mime"];
  start(): void;
  stop(): void;
  discard(): void;
  onData(callback: (chunk: Blob) => void): void;
  onStop(callback: () => void): void;
};
export type MicrophoneLease = {
  release(): void;
  createCapture(): AudioCapture;
};

export function createComposerDictation(deps: {
  readModel(): Promise<Audio["model"]>;
  acquire(): Promise<MicrophoneLease>;
  transcribe(audio: Audio): Promise<{ text: string }>;
  append(text: string): void;
  phase(value: DictationPhase): void;
  error(message: string): void;
}) {
  let epoch = 0;
  let state:
    | { kind: "idle" | "opening" | "transcribing" }
    | {
        kind: "recording" | "stopping";
        capture: AudioCapture;
        release(): void;
      } = { kind: "idle" };
  const idle = () => {
    state = { kind: "idle" };
    deps.phase("idle");
  };
  const cancel = () => {
    epoch++;
    if (state.kind === "recording" || state.kind === "stopping") {
      state.capture.discard();
      state.release();
    }
    idle();
  };
  const start = async () => {
    if (state.kind !== "idle") return;
    const started = ++epoch;
    state = { kind: "opening" };
    deps.phase("opening");
    deps.error("");
    try {
      const model = await deps.readModel();
      if (started !== epoch) return;
      const microphone = await deps.acquire();
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          microphone.release();
        }
      };
      if (started !== epoch) {
        release();
        return;
      }
      try {
        const capture = microphone.createCapture();
        const chunks: Blob[] = [];
        capture.onData((chunk) => {
          if (chunk.size) chunks.push(chunk);
        });
        capture.onStop(() => {
          release();
          if (started !== epoch) return;
          state = { kind: "transcribing" };
          deps.phase("transcribing");
          void (async () => {
            try {
              const audio = new Uint8Array(
                await new Blob(chunks).arrayBuffer(),
              );
              if (started !== epoch) return;
              const result = await deps.transcribe({
                audio,
                mime: capture.mime,
                model,
              });
              if (started === epoch) deps.append(result.text);
            } catch (error) {
              if (started === epoch)
                deps.error(
                  error instanceof Error ? error.message : "Dictation failed.",
                );
            } finally {
              if (started === epoch) idle();
            }
          })();
        });
        state = { kind: "recording", capture, release };
        capture.start();
        deps.phase("recording");
      } catch (error) {
        if (state.kind === "recording") state.capture.discard();
        release();
        throw error;
      }
    } catch {
      if (started !== epoch) return;
      idle();
      deps.error(
        "Could not start dictation. Check microphone permissions in Desktop settings.",
      );
    }
  };
  return {
    start,
    cancel,
    toggle: () => {
      if (state.kind === "opening") cancel();
      else if (state.kind === "recording") {
        const active = state;
        state = { ...active, kind: "stopping" };
        deps.phase("transcribing");
        try {
          active.capture.stop();
        } catch {
          active.capture.discard();
          active.release();
          idle();
          deps.error("Could not stop dictation.");
        }
      } else if (state.kind === "idle") void start();
    },
  };
}

export function appendDictatedText(current: string, text: string): string {
  return `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`;
}
