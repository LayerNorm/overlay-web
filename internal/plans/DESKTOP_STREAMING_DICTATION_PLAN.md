# Streaming desktop dictation

Status: Proposed. This plan does not enable a provider, introduce an endpoint or change billing.

## Goal

Recognize speech while the user is talking, so releasing the shortcut only flushes
the remaining audio and finalizes delivery. Keep the microphone closed until the
shortcut is invoked. Measure release-to-insertion separately from microphone
startup; a provisional warm-path goal is 300–500 ms for short utterances on a good
connection, subject to provider benchmarks and real-device QA.

## Current path and immediate changes

Cloud dictation currently sends the complete WAV after release to the existing
authenticated transcription endpoint, which reserves budget, calls Groq Whisper
Turbo, validates trusted usage and settles billing before returning text.
Microphone-choice caching and per-take native admission reuse remove avoidable
startup work and a possible extra round trip. They do not overlap recognition
with speech and cannot by themselves deliver the streaming experience.

## Proposed path

1. On shortcut invocation, open the microphone and request a bounded streaming
   session in parallel. Keep the existing bounded local recovery buffer; send no
   audio until server admission succeeds.
2. Server admission binds the session to the authenticated user and workspace,
   verifies entitlements and reserves budget under an idempotent session identity.
   The server owns provider credentials and the upstream connection.
3. Send small PCM batches during speech. Retain stable transcript segments in
   memory; do not repeatedly paste partial text into the destination app.
4. On release, flush the worklet and explicitly finalize the provider stream,
   rather than waiting for a silence detector. Commit authoritative usage and
   deliver the completed text through the existing guarded paste/copy flow.
5. Cancel/sign-out/disconnect closes upstream work, fences late results and
   reconciles the reservation. Enforce duration, bytes and backpressure limits on
   the server. Client-supplied duration is not billing evidence. Keep existing
   batch Groq and local modes as explicit recoverable alternatives; avoid duplicate
   provider work or charging during fallback.

## Provider and deployment proof

- Benchmark a real incremental recognizer, including technical vocabulary,
  punctuation, noise, multilingual accuracy, connection setup, first partial and
  finalization latency. Deepgram's live API and explicit Finalize message are one
  candidate; choose the provider from measured quality/latency/cost results.
- The existing Groq file-transcription call remains a batch path. Streaming only
  its upload does not establish that inference runs while the user is speaking.
- Vercel Functions now support WebSockets on Fluid compute. First prove the
  supported Node/Next routing integration on an isolated Preview, including
  Origin validation, application authentication, maximum connection duration,
  cancellation and upstream shutdown. Keep native Git production deployment and
  existing per-PR isolation/cleanup. Do not assume a Next route-handler signature
  alone implements a WebSocket upgrade.
- Do not issue an unrestricted provider token to desktop and rely on its expiry
  as a recording limit: connection admission and active-session duration are
  different controls. The server must retain authoritative budget and cancellation
  control for the entire session.

## Acceptance

- Separate cold/warm microphone, transport, first partial, release-to-final,
  settlement and paste timings without recording speech/text in timing telemetry.
- Verify first and last words, pauses, long speech, explicit finalize, cancellation,
  sign-out, provider failure, expired sessions, workspace changes and budget limits.
- Test stable text delivery and clipboard recovery on real macOS. Test provider
  work and billing on the current isolated Preview; keep builds and exhaustive
  suites in CI. Report measured distributions rather than an unconditional
  instant/zero-latency claim.

## Primary references

- [Groq speech to text](https://console.groq.com/docs/speech-to-text)
- [Deepgram live audio](https://developers.deepgram.com/reference/speech-to-text/listen-streaming)
- [Deepgram Finalize](https://developers.deepgram.com/docs/finalize)
- [Vercel WebSocket general availability](https://vercel.com/changelog/websocket-support-is-now-generally-available)
