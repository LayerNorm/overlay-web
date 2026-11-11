# PR469 live-QA follow-up

## Work and new personal chats

Native `work.browse.list/context` call `requireNativeCapability(..., 'work.use')`; their nullable viewer wrapper turns denial into `null`, which mobile displays as unavailable. `chat.personal.submit` checks `conversations.create`. These are role capabilities, not a client-kind claim or workspace opt-in. Missing native deployment policy produces `DEPLOYMENT_FEATURE_ACCESS_DENIED`, not the reported `CAPABILITY_ACCESS_DENIED`.

Web's `AppShellLayout` runs `ensureDefaultUserRole(session.user.id)`. Native bootstrap previously did not. The companion web branch `devin/1794365182-native-bootstrap-role` adds that same initialization to the existing authenticated, rate-limited bootstrap endpoint for verified access-token callers. It uses only `context.auth.userId`; explicit custom roles are preserved by the existing server mutation.

Mobile now requires fresh bootstrap at sign-in and workspace activation, blocks native shell children until it succeeds, and retains Retry/sign-out on failure. A cached bootstrap is not evidence that authorization has initialized. Work also waits for Convex authentication, matching web's readiness gate.

Deploy the companion web change before verifying mobile-only first sign-in. No preview policy, role assignment or other preview data was changed as part of this investigation.

## Agent editor

The editor previously resent every field, including unchanged legacy avatar colors rejected by today's six-digit-hex validator. Update payloads now omit unchanged avatar colors instead of silently rewriting existing identities. Explicit new color selections and agent creation still send their colors normally.

## Android keyboard

Agent threads and rooms previously supplied no Android `KeyboardAvoidingView` behavior. They now use `height` on Android and retain `padding` on iOS. Personal chat uses the same layout owner instead of adding a full keyboard-height spacer as well. Android's Expo configuration explicitly requests `resize` rather than `pan`.

The native configuration change requires a rebuilt Android binary; Fast Refresh only applies the JavaScript avoidance changes. Metro on port 8085 and the QA environment were not restarted or changed. Automated tests verify layout/config wiring, not real IME geometry; recheck composer/send visibility with the keyboard open in agent threads, rooms and personal chat on the QA device, then repeat after a native rebuild.

## Personal agent diagnostic `hd_ll3tn916tuyjk`

The safe message comes from `AUTHORIZATION_REVOKED` in `packages/overlay-agent-runtime/src/harness-diagnostic.ts`. `src/server/harness/harness-diagnostics.ts` maps numerous underlying errors to that code, so the safe message alone cannot identify which check fired.

Source comparison found no unsupported mobile token type or missing client-supplied grant:

- `services/appApi.ts` sends the stored WorkOS access token as Bearer authentication and scopes requests with `x-overlay-workspace-id`.
- `services/agentThreadService.ts` verifies the requested workspace is current, then sends the same basic text-turn fields as web's `DirectMessageExperience.hooks.ts`: conversation/turn IDs, client nonce, user role, act mode, text content/type and mentioned principals. Server-owned authorization grants are not supplied by either caller.
- `src/server/harness/personal-access.ts` explicitly accepts `access-token` as well as browser `session`. It checks `conversations.edit`, tool/connector resource grants, and `memory.use` when memory is enabled. Mobile sends `memoryEnabled: true`; this is a supported value, not an authorization bypass.
- The default member role includes `conversations.create/read/edit`, `tools.use` and `memory.use`. Its absence can therefore explain both the observed personal-chat denial and a later harness permission-revoked diagnostic. The bootstrap fix addresses that missing initialization path.

**Unverified:** the underlying persisted error/run state for `hd_ll3tn916tuyjk` and this preview user's actual role assignments were not retrieved. Missing default-role initialization is source-verified, but cannot be claimed as the confirmed cause of this particular diagnostic. An intentional custom role, revoked resource grant, or changed run/conversation identity can also yield this message. Re-run a new personal agent turn after the web prerequisite deploys and bootstrap succeeds; if it still fails, inspect that run's underlying authorization error and subject roles. Do not weaken checks, forge grants or relabel it as an environment-only failure without that evidence.

## Unsaved-chat model preferences

The model picker called `syncConversationMeta`, which unconditionally renamed the conversation and called native `chat.personal.setPreferences`. A fresh local chat still has a `chat-…` client ID, not a Convex conversation ID. Model selection now updates the local draft only until the conversation exists; `saveChat` also ignores drafts without issuing native writes. First creation receives the selected model, and subsequent preference writes use the adopted durable ID. Regression tests exercise the actual picker/metadata callbacks, creation payload and durable preference writes, plus absent-chat and backend-error cases.

## Verification commands

```sh
npm run check
node --test scripts/*.test.cjs
node scripts/lint-mobile.cjs
```

New bootstrap tests cover fresh/cached startup, failed initialization/retry, stale sign-in completion and authenticated Work subscriptions. Avatar tests cover unchanged legacy/empty/current values and explicit changes. Keyboard tests cover native resize and all three composer layouts. Live preview persistence, native keyboard geometry and the diagnostic's exact originating error remain acceptance checks for the ongoing QA session.
