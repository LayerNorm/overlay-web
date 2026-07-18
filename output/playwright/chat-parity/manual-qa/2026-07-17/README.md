# Desktop-Web Chat Parity Manual QA — 2026-07-17

**Result:** Not release-approved. The shared transcript implementation and fixture gates are complete, but the live matrix found production/runtime blockers that prevent the Electron and video paths from receiving a full pass.

## Environment

- Root web/shared checkout: `138d17fea912` on `main`.
- Nested desktop checkout: `4e4d1b117785` on `main` (`overlay-desktop` 0.1.23).
- Web runtime: signed-in production session at `https://www.getoverlay.io/app/chat` in Chrome.
- Electron runtime: current source through `npm run dev`, trusted renderer origin `http://localhost:5173`, and production `APP_SERVER_URL=https://www.getoverlay.io`.
- macOS display captured at 1184 × 768.
- A production-preview launch (`npm start -- --skipBuild`) was not used for behavior results because the unpackaged `file://.../out/renderer` origin is rejected by the IPC sender validator. The supported development renderer was used instead.

Status meanings:

- **PASS** — exercised against the live runtime and observed the expected terminal state.
- **PARTIAL** — the relevant boundary worked, but the complete requirement could not be confirmed.
- **FAIL** — exercised and observed an incorrect terminal state.
- **BLOCKED** — a prerequisite failed before the requested behavior could run.

## Live web chat

| Flow | Status | Durable observation |
| --- | --- | --- |
| Send and stream | PASS | A new signed-in chat sent `QA live web send test...` with Muse Spark 1.1 and rendered `web live pass`. |
| Stop before first token | PASS | The stop control was activated immediately after submit; the exchange settled as `Response was interrupted.` without assistant text. |
| Stop during tools | PASS | A knowledge/memory request displayed two sequential `5 tools called` groups; stopping settled the same exchange as interrupted while preserving the tool groups. |
| Retry | FAIL | `Regenerate response` replaced the successful response with `Something went wrong. Please try again.` |
| Reply | PASS | Replying to the interrupted tool exchange produced the `Replying to prior response` composer card and a `Cancel reply` action. |
| Delete turn | PARTIAL | The exchange was removed, but its active reply draft remained and referenced the deleted response until manually cancelled. |
| Real image generation | PASS | Grok Image produced a 1024 × 1024 image. The initial in-memory data URL was persisted; after reload it restored from `/api/v1/files/ks72q2s1fcc436t7r29ybr30sd8ase4m/content`. |
| Real video generation | FAIL | Veo 3.1 stayed in `Creating video`; after reload the durable exchange settled as `Generated 0 videos for the prompt ...` with no `<video>` result. |
| Signed-in media restoration | PASS (image) / FAIL (video) | Reload of conversation `n571310dyngrwdjy0z3hkdvd658arjbr` restored the image through the durable content route and restored the failed zero-video state. |
| Expired output URL restoration | BLOCKED | The live image restored through the durable content proxy, not an expiring signed URL. No safe live URL with a controllable expiry was available, so a real 403/expiry refresh was not manufactured. |

## Live Electron chat

| Flow | Status | Durable observation |
| --- | --- | --- |
| Signed-in restart and text restoration | PASS | After restarting into the current checkout, the chat sidebar restored cloud conversations and the selected historical transcript before the auth failure occurred. |
| Send | FAIL | A dedicated QA conversation settled with `DesktopApiError: {"error":"Unauthorized"}`. Main-process logs show production conversation requests transitioning to `401 Unauthorized` after session refresh/rate limiting. |
| Stop before first token | BLOCKED | The request failed before a successful model stream began, so the stop state could not be exercised honestly. |
| Stop during tools | BLOCKED | No authenticated tool stream could start because the same production API authentication boundary failed first. |
| Retry | BLOCKED | A successful source exchange could not be created; retrying the authorization failure would only repeat the prerequisite failure. |
| Delete turn | PASS (local UI) / PARTIAL (server) | Deleting the dedicated error turn removed its prompt and transcript actions from the renderer. Server durability was not confirmed because conversation persistence requests were returning 401. |
| Reply | BLOCKED | The reply action was present, but the authorization-error exchange did not enter a visible reply-composer state. A successful assistant exchange could not be created in this runtime. |
| Real image/video generation | BLOCKED | Main chat authentication failed before generation could be attempted. Embedded agents also reported missing gateway/API-key configuration. No credits were spent on requests that could not pass their prerequisites. |
| Signed-in media restoration after restart | BLOCKED | Text history restored, but there was no successfully generated desktop media exchange to restore. |
| Local media restoration after restart | BLOCKED | The local chat media cache contained no live media artifact, and generation could not create one in the failing runtime. |

## Native and embedded desktop workflows

| Flow | Status | Durable observation |
| --- | --- | --- |
| Panel transparency | PARTIAL | The full-screen outer window remained transparent and only the panel/control surfaces rendered. The app-scoped capture composites transparency against white, so opacity over a non-white external app was not durably captured. |
| Panel resizing | PASS | Opening browser chat expanded the browser panel from the compact browser width to the browser-plus-chat layout without clipping the web content or compact transcript. Opening notebook chat likewise expanded its panel. |
| Panel movement | PARTIAL | Native panel movement IPC returned success and exact before/after coordinates, then was restored. A pointer drag collided with delayed global-hotkey delivery and was not accepted as a visual pass. |
| File drag/drop | BLOCKED | No safe Finder-to-Electron file drag could be completed through the available automation surface. No synthetic DOM drop is counted as manual evidence. |
| Voice insertion | PARTIAL | The same `sendTextToChatInput` IPC path used by the transcription panel inserted `QA voice insertion transcript` into the live main composer, and the draft was then cleared. Microphone capture and STT were not exercised. |
| Browser chat in workflow | FAIL | Google loaded in the real `WebContentsView`; the compact shared chat opened and accepted a prompt, then rendered `Task failed: AI Gateway API key not configured...`. |
| Notebook chat in workflow | FAIL | A real local note loaded, notebook chat expanded, and the shared compact transcript accepted a prompt, then rendered `Task failed: API key error. Please check your API key in settings.` |

## Release blockers found

1. Fix or reauthenticate the Electron production app-API session so `/api/v1/conversations*` and chat send do not transition to 401 after refresh.
2. Configure and verify the Electron browser/notebook gateway path; both embedded consumers currently reach their shared renderer but fail before model execution.
3. Diagnose Veo 3.1 returning a completed zero-result exchange.
4. Fix web retry replacing a previously successful answer with a generic error.
5. Clear or cancel reply state when its referenced turn is deleted.
6. Run the remaining hardware/OS-dependent checks: real microphone/STT, Finder drag/drop, transparency over a non-white external window, local media creation/restart, and a controllable expired signed output URL.

## Captures

- [Electron main chat authorization failure](electron-main-auth-error.jpeg)
- [Electron browser chat in a real Google workflow](electron-browser-chat.jpeg)
- [Electron notebook chat failure](electron-notebook-chat-error.jpeg)
- [Web real media request before reload](web-real-media-pending.png)
- [Web image restoration and zero-video result after reload](web-media-restored.png)

Automated parity screenshots, boundary guards, render-count evidence, and the 100-exchange/100-chunk stress test remain recorded one directory above this manual evidence set.
