# Owner-funded HTTP idempotency audit

The PR469 `conversation.act` HTTP 428 was caused by sending no `Idempotency-Key` header. The turn ID in the JSON body is not a substitute for the HTTP header.

Mobile now uses web's shared `buildActStreamIdempotencyKey(turnId, variantIndex)` for text generation. The existing pending-turn retry ID stays stable through failures and adoption of the server conversation ID; retries therefore send the same `act:<turn>:<variant>` key. A new turn or variant has a different key. Temporary chats also require a turn ID and send a key, without creating durable messages.

Audit against `src/server/billing/owner-funded-operations.ts`:

| Owner-funded POST | Active mobile caller | Key |
| --- | --- | --- |
| `/api/v1/conversations/act` | `services/aiService.ts` | Web's shared turn/variant key |
| `/api/v1/generate-image` | `services/conversationActionsService.ts` | `image:<turnId>` |
| `/api/v1/generate-video` | `services/conversationActionsService.ts` | `video:<turnId>` |
| `/api/v1/knowledge/search` | `services/knowledgeService.ts` | New request key, or an explicit caller-owned key for retries |
| `/api/v1/transcribe` | `ios/RecordingViewController.swift` | UUID attached when constructing the URLRequest; transport retries reuse that request |
| `/api/v1/generate-title` | No active mobile caller | Not applicable |
| `/api/v1/notebook-agent` | No active mobile caller | Not applicable |

The registry's `GET /api/v1/chat-suggestions` does not require a mutation idempotency key.

Two additional orchestration paths were checked even though they are not entries in that owner-funded registry:

- Agent and room message sends now pass stable nonce-derived keys through the shared API client's supported `idempotencyKey` option, which becomes an HTTP header.
- Automation run-now sends a key. Both automation UIs retain the same pending key after an ambiguous failure and release it after an accepted response; a subsequent intentional run gets a new key. The service also accepts a caller-owned key explicitly.

Tests cover successful and failed generation attempts, retries, separate turns/variants, temporary chats, empty turn IDs, automation/search keys and room nonce forwarding. Existing agent-send transport coverage asserts the new key. Swift source wiring is covered, but the native transcription change was not compiled or executed on iOS; it requires a rebuilt native binary.

Metro and QA environment settings were left unchanged. Live server replay/deduplication and real native transcription remain acceptance checks for the ongoing QA session.
