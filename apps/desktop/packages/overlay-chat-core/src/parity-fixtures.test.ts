import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_PARITY_FIXTURE_TIMESTAMP,
  CHAT_PARITY_FIXTURE_VERSION,
  CHAT_PARITY_MEDIA_SCENARIOS,
  CHAT_PARITY_TEXT_SCENARIOS,
  getChatParityScenarioIds,
} from "./parity-fixtures";

test("parity fixtures have stable unique identifiers", () => {
  const ids = getChatParityScenarioIds();
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 9);
  assert.match(CHAT_PARITY_FIXTURE_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  assert.equal(CHAT_PARITY_FIXTURE_TIMESTAMP, 1_721_177_600_000);
});

test("parity fixtures never depend on live or mutable URLs", () => {
  const serialized = JSON.stringify({
    text: CHAT_PARITY_TEXT_SCENARIOS,
    media: CHAT_PARITY_MEDIA_SCENARIOS,
  });
  assert.doesNotMatch(serialized, /localhost|convex\.cloud|api\./);
  assert.match(serialized, /data:video\/mp4;base64/);
});

test("parity fixtures cover loading, streaming, errors, image, and video states", () => {
  assert.ok(
    CHAT_PARITY_TEXT_SCENARIOS.some(
      (scenario) => (scenario.responseVariants?.length ?? 0) > 1,
    ),
  );
  assert.ok(
    CHAT_PARITY_TEXT_SCENARIOS.some((scenario) => scenario.responseInProgress),
  );
  assert.ok(
    CHAT_PARITY_TEXT_SCENARIOS.some((scenario) => scenario.isTextStreaming),
  );
  assert.ok(
    CHAT_PARITY_TEXT_SCENARIOS.some((scenario) => scenario.errorMessage),
  );
  assert.ok(
    CHAT_PARITY_MEDIA_SCENARIOS.some((scenario) => scenario.kind === "image"),
  );
  assert.ok(
    CHAT_PARITY_MEDIA_SCENARIOS.some((scenario) => scenario.kind === "video"),
  );
  assert.ok(
    CHAT_PARITY_MEDIA_SCENARIOS.some((scenario) =>
      scenario.results.some((result) => result.status === "failed"),
    ),
  );
});
