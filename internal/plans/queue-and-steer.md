# Queue and steer in every thread

**Status:** Phase 1 implemented on `codex/queue-and-steer` (chats, agent threads and automation threads). Not yet merged or deployed. Mockup: `mockups/queue-and-steer.html`.

## Behavior

While a chat, agent thread or automation run is responding:

- **Enter queues.** The message goes into a tray above the composer. When the response finishes, queued messages are sent one at a time, in order, as normal user turns. Each row can be edited, removed or promoted with **Steer now**.
- **⌘/Ctrl + Enter steers.** The current output stops, the partial reply is kept with the usual interruption notice, and the message is sent right away.
- An empty composer keeps Stop. A manual Stop pauses the queue until the person sends something. Idle behavior is unchanged.

## What we built, and why not SDK steering yet

`ai` 7.0.154+ has `experimental_createSteering()` with `steer()` and `queue()`. Our runs execute in the durable Workflow harness (`WorkflowAgent` in `src/server/harness/runner.ts`), with checkpoints and handoffs across requests. SDK steering only works inside the process running the loop. Steering across processes and `WorkflowAgent` support are still open upstream (vercel/ai#24448). So phase 1 composes two existing paths:

1. **Queue** (`useComposerQueue`). Queued messages are stored per conversation in `localStorage` (`overlay.queue.v1`), so they survive reloads. They drain through each surface's normal send path once its run is no longer active. A refused send returns to the front and pauses the queue.
2. **Steer**. The message goes to the front of the queue, then the surface's existing Stop runs. Personal and automation chats stop through `conversations/stop`. Agent rooms stop every generating reply, including one that appears after the request. The message sends when the run is terminal.
3. **UI**. `ComposerQueueTray` and the key handling live in the shared `ChatComposer`. Agent-room composers now show Stop while the agent replies.

Only text and mentions can be queued. Attachments, quoted replies, person mentions in personal chats and image/video modes stay in the composer with a notice.

## Progress

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Client queue and stop-then-send steer for chat, automation and agent-room composers | Implemented; PR preview QA pending |
| 2 | Server-side durable queue (drains with the tab closed) and *Steered*/*From queue* transcript tags | Not started |
| 3 | In-loop SDK `steer()`/`queue()` once `WorkflowAgent` supports durable steering; connected-agent host queue | Blocked upstream |

## QA (PR preview)

Queue three messages and check their order. Steer during text and during a tool call. Edit, remove and reload while messages are queued. Press Stop with messages queued and confirm they don't send until the next message. Try to queue with an attachment and confirm the notice. Repeat in an agent thread and an automation thread.
