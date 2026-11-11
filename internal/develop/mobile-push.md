# Mobile push notifications

## Contract and deployment order

`pushTokens` is an additive table: `userId`, `expoToken`, `platform` (ios/android),
installation-scoped `deviceId`, `updatedAt`, optional `revokedAt`; indexes are
`by_user` and `by_token`. This is an expand-only schema change: no existing
validator changes, migrations, backfills or destructive cleanup are required.
Deploy the expanded schema/functions to the isolated Preview before testing the
mobile branch. Roll out the backend before mobile. Old clients continue working;
rollback can stop producers/clients without dropping the table or optional fields.
Do not deploy a feature worktree to customer production.

Native-authenticated `notifications/tokens.register` accepts Expo-format tokens
only; it derives the user from Convex identity, deduplicates by token, moves a
re-registered token to its current user, and revokes older tokens for that user's
installation. `unregister({deviceId})` revokes only the caller's bindings.
Re-registering clears revocation and advances the version even within one
millisecond. Account deletion removes all the user's push-token rows.

Devices use a random, persisted installation ID, not hardware identifiers. Raw
APNs/FCM tokens cannot be sent to Expo and must not be uploaded to this API.
An EAS project ID and properly configured native notification credentials are
required to obtain an Expo token. No registration is fabricated when unavailable.

## Producers and eligibility

`convex/lib/mobilePush.ts` wraps new `workspaceNotifications` writes in
`collaboration/directMessages.ts` and `collaboration/channels.ts`, and new
unresolved `agentApprovalRequests` in `agents/connectedAgents.ts`. Each write and
its scheduled action commit atomically. `harness/runs.publishWait` schedules new
input/approval/stuck waits; idempotent updates and already-resolved records do not
schedule duplicate alerts. Needs-you here means agent approval/input waits.
The Work list's derived Needs you filter is not a separate notification producer.

Delivery re-reads the source, workspace, human principal, active membership and
conversation access. Read activity, resolved waits/approvals, terminal runs,
deleted conversations, archived/inactive/removed participants and muted
conversations do not deliver. Mentions-only conversations permit only mentions
and direct requests for user attention. Preferences use the persisted
`workspaceNotificationPreferences`: only `banner` delivers when a preference row
exists; `activity` and `off` remain silent. With no preference row, existing
notification records are eligible. DM/channel messages, thread replies, mentions
and reactions use their matching categories. Approval/input requests use mentions.

Approval recipients resolve through `conversationAgentRuns.externalRunId`;
harness waits resolve through the root's `deliveryAgentRunId`. Sources without a
native conversation run or active human recipient are skipped, not broadcast.

Payloads contain a title, at most 240 characters of the already-existing
notification body preview, and `data: {url}`. Approval/input bodies are generic;
raw questions, tool arguments and transcripts are never included. URL paths are
`/channel/:id`, `/dm/:id`, `/chat/:id` or `/thread/:root`, with `workspaceId` and
thread conversation/type query parameters. `notificationType` metadata lets the
foreground handler apply device-local banner categories without another payload.
The mobile router validates local paths and switches workspace before resolving
the existing conversation destination, which re-checks resource access.

## Delivery and failures

Internal actions POST batches of at most 100 to
`https://exp.host/--/api/v2/push/send`. Optional `EXPO_ACCESS_TOKEN` is a backend
environment secret; never put it in a public/mobile environment variable.
HTTP/invalid-response failures surface as failed Convex actions and do not revoke
healthy tokens. Delivery is best-effort, not an exactly-once transport or a
durable retry queue; Activity remains authoritative.

Successful tickets schedule receipt lookup after 15 minutes using Expo's
`/push/getReceipts` endpoint. Missing receipts retry twice at 15-minute intervals.
`DeviceNotRegistered` from either send tickets or receipts revokes only the
matching user/token/registration-version snapshot. Delayed receipts cannot revoke
a newer registration or a token moved to another user. Other provider errors
do not revoke registrations.

## Acceptance

- Run `npx tsc --noEmit`, targeted ESLint and `npx vitest run convex/mobilePush.convex.test.ts`.
- In the exact isolated Preview, sign in on a physical Expo development/production
  build; grant permission from Settings and verify the row uses the verified user.
- Create a mention and an agent approval/input wait; background/terminate the app,
  confirm one preview-safe alert, and tap it into the correct workspace/thread.
- Verify banner/activity/off preferences, mentions-only and muted conversations.
- Rotate the token and switch accounts; ensure ownership moves and old receipts
  cannot revoke the current registration. Sign out while connected; verify revoke.
- Offline sign-out is best-effort and time-bounded. It clears local notification
  history and cannot guarantee backend revocation until a connection is available.
- Mock Expo fetch for automated receipt tests; never test against customer tokens.
