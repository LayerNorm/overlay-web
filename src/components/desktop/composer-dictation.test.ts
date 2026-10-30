import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  createComposerDictation,
  appendDictatedText,
  type AudioCapture,
  type MicrophoneLease,
} from "./composer-dictation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function lease() {
  let stop = () => {};
  let data: (chunk: Blob) => void = () => {};
  const metrics = { released: 0, started: 0, discarded: 0 };
  const capture: AudioCapture = {
    mime: "audio/webm",
    start: () => {
      metrics.started++;
    },
    stop: () => {
      data(new Blob(["audio"]));
      stop();
    },
    discard: () => {
      metrics.discarded++;
      stop = () => {};
    },
    onData: (callback) => {
      data = callback;
    },
    onStop: (callback) => {
      stop = callback;
    },
  };
  return {
    metrics,
    microphone: {
      release: () => {
        metrics.released++;
      },
      createCapture: () => capture,
    } satisfies MicrophoneLease,
  };
}
function harness(
  acquire: () => Promise<MicrophoneLease>,
  transcribe = async () => ({ text: "dictated" }),
) {
  const appended: string[] = [],
    errors: string[] = [],
    phases: string[] = [];
  const controller = createComposerDictation({
    acquire,
    transcribe,
    readModel: async () => "cloud",
    append: (text) => appended.push(text),
    error: (message) => {
      if (message) errors.push(message);
    },
    phase: (value) => phases.push(value),
  });
  return { controller, appended, errors, phases };
}

test("cancelled microphone acquisition releases only its own late stream", async () => {
  const pending = deferred<MicrophoneLease>(),
    old = lease(),
    next = lease();
  let requests = 0;
  const h = harness(() =>
    ++requests === 1 ? pending.promise : Promise.resolve(next.microphone),
  );
  const first = h.controller.start();
  await setImmediate();
  await h.controller.start();
  assert.equal(
    requests,
    1,
    "repeated starts cannot acquire another microphone",
  );
  h.controller.cancel();
  await h.controller.start();
  pending.resolve(old.microphone);
  await first;
  assert.equal(old.metrics.started, 0);
  assert.equal(old.metrics.released, 1);
  assert.equal(next.metrics.started, 1);
  assert.equal(next.metrics.released, 0);
  h.controller.cancel();
  assert.equal(next.metrics.released, 1);
});

test("normal stop releases the microphone before transcription and appends once", async () => {
  const audio = lease();
  const h = harness(
    async () => audio.microphone,
    async () => {
      assert.equal(audio.metrics.released, 1);
      return { text: "hello" };
    },
  );
  await h.controller.start();
  h.controller.toggle();
  await setImmediate();
  assert.deepEqual(h.appended, ["hello"]);
  assert.equal(h.phases.at(-1), "idle");
  assert.equal(audio.metrics.released, 1);
});

test("disposing the old draft discards late transcription text and errors", async () => {
  for (const fail of [false, true]) {
    const audio = lease(),
      result = deferred<{ text: string }>();
    const h = harness(
      async () => audio.microphone,
      () => result.promise,
    );
    await h.controller.start();
    h.controller.toggle();
    await setImmediate();
    h.controller.cancel();
    if (fail) result.reject(new Error("old draft failure"));
    else result.resolve({ text: "belongs to old draft" });
    await setImmediate();
    assert.deepEqual(h.appended, []);
    assert.deepEqual(h.errors, []);
  }
});

test("recorder construction failure releases the acquired microphone", async () => {
  const audio = lease();
  const h = harness(async () => ({
    ...audio.microphone,
    createCapture: () => {
      throw new Error("unsupported");
    },
  }));
  await h.controller.start();
  assert.equal(audio.metrics.released, 1);
  assert.equal(h.errors.length, 1);
  assert.equal(h.phases.at(-1), "idle");
});

test("dictation appends to the latest editor draft with existing whitespace preserved", () => {
  assert.equal(
    appendDictatedText("typed meanwhile", "dictated"),
    "typed meanwhile dictated",
  );
  assert.equal(appendDictatedText("line\n", "dictated"), "line\ndictated");
  assert.equal(appendDictatedText("", "dictated"), "dictated");
});
