# External Imports

Living documentation for importing data from external communication platforms (Slack, Teams, Discord, Telegram) into Overlay. This is the source of truth for the import architecture, canonical model, and adapter interface.

Continuous two-way channel sync is separate from these one-time imports. It lives in `convex/sync/` and `src/server/sync/`, with its own tables (`syncConnections`, `syncChannelLinks`, `syncMessageMap`, `syncIdentities`, `syncMemberAccounts`, `syncOutbox`, `syncRateBudgets`) and normalized events in `src/shared/sync/types.ts`. Sync history import and nightly gap repair run in `src/server/sync/history-worker.ts` under the shared rate limiter in `src/server/sync/rate-limit.ts`, and write through the same idempotent `sync/ingest:applyInbound` as live events. See `internal/plans/SLACK_TEAMS_SYNC_PLAN.md`.Members' own grants for replying live in `convex/sync/accounts.ts`; outbound changes are queued by `convex/sync/outbox.ts` and sent by `src/server/sync/outbound-worker.ts` through each provider's outbound adapter (Slack: `src/server/sync/slack/outbound.ts`). See `internal/plans/SLACK_TEAMS_SYNC_PLAN.md`.ee `internal/plans/SLACK_TEAMS_SYNC_PLAN.md`. Microsoft Teams sync lives in `src/server/sync/teams/` (Graph client, HTML conversion, webhook handling, subscriptions, history and outbound adapters) with `convex/sync/teamsLinks.ts` and `convex/sync/teamsAccounts.ts`; its Microsoft app setup is in `internal/develop/teams-sync-app.md`. Teams reply ids are stored as `root/reply` because Graph reply ids are only unique beside their root.

## Architecture

External imports follow a deterministic, server-side pipeline — no LLM agent loops. The flow is:

1. **Connect** the external platform via Composio OAuth (or file upload for platforms without API access).
2. **Select** what to import (channels, conversations, date ranges).
3. **Create** an import job in Convex.
4. **Backfill** worker paginates through the platform's API, normalizes data, and persists to Overlay.
5. **Report** coverage and progress via Convex subscriptions.

```
Workspace Settings → Import & sync tab → One-time import
  → Connect platform (Composio OAuth)
  → Select channels/conversations
  → Create import job (Convex)
  → Server backfill worker:
      - List users (for identity resolution)
      - Per channel: create Overlay conversation
      - Paginate message history
      - Fetch thread replies
      - Download files
      - Normalize → insert as conversationMessages
      - Dedup via source→Overlay ID mappings
  → Progress via the live `imports/slackBrowse:status` query
  → Coverage report on completion
```

## Canonical import model

All platform data is normalized to a common internal representation before persistence.

### ExternalConversation

```ts
interface ExternalConversation {
  source: 'slack' | 'teams' | 'discord' | 'telegram'
  sourceConversationId: string
  sourceName: string
  sourceType: 'public_channel' | 'private_channel' | 'im' | 'mpim'
  title: string          // Overlay conversation title
  clientId: string       // dedup key: `{source}:{workspaceId}:{sourceConversationId}`
}
```

### ExternalMessage

```ts
interface ExternalMessage {
  sourceMessageId: string       // platform-unique message ID
  sourceUserId: string
  sourceUserName: string        // resolved via user cache
  text: string                  // raw text
  threadId: string | null       // null = not threaded; set = reply in this thread
  isThreadParent: boolean
  replyCount: number
  files: Array<{ id: string; filename: string; mimeType: string; size: number }>
  reactions: Array<{ emoji: string; userIds: string[] }>
  createdAt: number             // epoch ms
  editedAt: number | null
  // Overlay fields
  role: 'user' | 'assistant'    // always 'user' for imports
  turnId: string                // = sourceMessageId (unique per message)
  content: string               // formatted text with author prefix and file refs
}
```

## Adapter interface

Future platforms should implement this interface. The Slack adapter (`src/server/imports/slack/`) is the reference implementation.

```ts
interface ChatImportSource {
  listConversations(): Promise<ExternalConversation[]>
  fetchMessages(
    conversationId: string,
    cursor?: string,
  ): Promise<{ messages: ExternalMessage[]; nextCursor?: string }>
  fetchThread(
    channelId: string,
    threadId: string,
    cursor?: string,
  ): Promise<{ messages: ExternalMessage[]; nextCursor?: string }>
}
```

**Do not over-generalize before a second source exists.** The Slack adapter was built first; extract the interface into a shared module only when implementing Teams or Discord.

## Slack adapter (reference implementation)

### Files

| File | Purpose |
| --- | --- |
| `src/server/imports/slack/composioClient.ts` | REST client for Composio direct tool execution |
| `src/server/imports/slack/normalizer.ts` | Slack → Overlay format (channels, messages, user cache) |
| `src/server/imports/slack/backfillWorker.ts` | Deterministic paginated import loop |

### Composio tools used

| Tool slug | Purpose |
| --- | --- |
| `SLACKBOT_LIST_ALL_CHANNELS` | List all accessible channels (public, private, DMs, MPIMs) |
| `SLACKBOT_LIST_ALL_USERS` | List workspace members for name resolution |
| `SLACKBOT_FETCH_CONVERSATION_HISTORY` | Paginate channel message history |
| `SLACKBOT_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION` | Fetch thread replies |
| `SLACKBOT_DOWNLOAD_FILE` | Download files via Composio URL conversion |

### Dedup and resume

- Each imported message creates a `slackImportMappings` row mapping `(workspaceId, sourceChannelId, sourceMessageTs)` → `(conversationId, messageId)`.
- On resume, the worker checks for existing mappings before inserting.
- Channel-level resume: `findChannelConversation` returns the existing conversation ID for a channel in a job.
- Message-level dedup: `findExisting` checks if a specific message has already been imported.

### Coverage reporting

The coverage report distinguishes:
- Public channels imported
- Private channels imported
- DMs imported
- MPIMs (group DMs) imported
- Total messages imported
- Total files downloaded
- Total thread replies imported

This is critical because a Slack bot/user token only sees conversations the authenticated account can access. The UI must distinguish "all accessible data" from "all workspace data."

## Convex tables

### slackImportJobs

Workspace-scoped import jobs with status lifecycle: `queued → listing_channels → importing → completed/failed/cancelled`.

### slackImportMappings

Source-to-Overlay ID mappings for dedup and resume. Indexed by `(workspaceId, sourceChannelId, sourceMessageTs)` for unique lookups.

## BFF routes

| Method | Path | Action |
| --- | --- | --- |
| GET | `/api/v1/imports/slack?action=channels` | List accessible Slack channels |
| GET | `/api/v1/imports/slack?action=users` | List Slack users (Composio), to match them with workspace members |
| POST | `/api/v1/imports/slack` | `action=start` or `action=cancel` |

Job progress and the Slack connection state are not BFF reads: the panel subscribes to the native `imports/slackBrowse:status` query, which returns whether the viewer's own Slack connector is connected and the workspace's 20 most recent jobs (never the connector account reference). Listing channels and users (Composio) and starting or cancelling an import stay on the server.

Slack import job persistence and the scheduled processing bridge remain Convex-only. PostgreSQL
deployments classify these routes as unavailable; they must not silently call Convex or advertise
live import support until the import job repository is provider-neutral.

## Slack conversation mapping

- `public_channel` and `private_channel` are persisted as `conversationType: 'channel'`.
- `im` (1:1 DM) and `mpim` (group DM) are persisted as `conversationType: 'dm'` and land under Direct Messages.
- Resuming an existing import updates the conversation type and clears any `archivedAt`/`removedAt` on the importer's participant row so re-imported conversations do not get stuck in Archived.

## Imported message authorship

- Imported messages carry `importedAuthorName`, `importedAuthorEmail`, and `importedAuthorStatus` so authors who are not Overlay principals still render. The same fields mark live inbound senders on surface-bound conversations (Slack threads answered by a bound agent): `surface-authors.ts` resolves the sender's email to a workspace-membership status with the same member/invited/not_invited convention, reusing `imports/slackImporter:resolveAuthorStatuses` on Convex.
- The authenticated importer's own messages are recognized by the Slack user ID when it can be resolved, with email and a unique display-name fallback. For 1:1 DMs, the importer can also be inferred as the author other than the DM's known counterpart. Those messages are stored with `authorKind: 'human'` and `authorPrincipalId: <importer>`, causing them to render as "You".

## UI

The `SlackImportPanel` component in `src/features/workspaces/components/SlackImportPanel.tsx` renders inside the workspace settings "Import & sync" tab, behind its **One-time import** action. It has 5 states and a matching 5-step indicator:

1. **Not connected / Connect** — "Connect Slack" button triggers Composio OAuth; this is the active Connect step until the service is connected
2. **People** — review/invite Slack members before importing; once Slack is connected, the Connect step is marked complete
3. **Chats picker** — checkboxes for each accessible channel, DM, and group DM; "Select all public" convenience; start import button
4. **Progress** — live job status from `imports/slackBrowse:status` (no polling), progress bar, cancel button; shows "Preparing…" until the backend reports usable chat totals instead of displaying a misleading 0-of-0 count
5. **Done** — terminal summary (completed/failed/cancelled) with coverage and next actions. The import wizard lands on Done instead of returning to People.

The connection state comes from the same live query: it is set on first load and changes on its own when OAuth finishes in another tab (the panel waits up to five minutes after **Connect Slack**, then re-enables the button). It must not reset the current view when the user advances from People to the Chats picker; otherwise the picker flashes and the wizard returns to People.

### Slack and Teams sync settings

The tab opens on ongoing sync (`SyncSettingsPanel` in `src/features/workspaces/components/`, plain helpers in `src/features/workspaces/lib/sync-settings.ts`), with a Slack / Microsoft Teams switch. Everything on it comes from the live `sync/links:status` query, so connects, links and history progress update without polling:

- **Workspace card:** who connected the Slack workspace or Teams organization and when. Owners and admins connect through `/api/v1/surfaces/slack/connect?purpose=sync` or `/api/v1/sync/teams/connect`, and the menu offers Disconnect (and, for Teams, the app package from `/api/v1/sync/teams/app-package`).
- **Your account:** each member connects their own account (`purpose=sync_member` for Slack, `/api/v1/sync/teams/account/connect` for Teams) and can then opt in to direct message sync. This is the only card members who are not owners or admins can change.
- **Channels:** the auto-link switch, the **Link channel** picker (channels from `GET /api/v1/sync/<provider>?action=channels`, linked into a new channel or an existing one from `sync/ui:linkTargets`), and the link table with Syncing, Importing history (progress from `historyOldestAt` between `historyTargetAt` and the link's creation), Catching up (`catchUpUntil`) and Paused (`pauseReason`) states.
- Actions post to `/api/v1/sync/<provider>`. A 404 or 503 from a Teams route shows "Microsoft Teams sync isn’t available yet" instead of an error. Returning from OAuth shows one toast from `?syncConnected=` or `?surfaceError=` and removes the parameter.

Linked channels show a small **Slack** or **Teams** label in the Chats list and channel header (`sync/ui:channelSources`, through `useChannelSyncSources` in `src/hooks/use-sync-sources.ts`). Reaching the top of a linked channel that is still importing history calls `sync/history:prioritize` at most once a minute; failures are ignored.

## Conversation lifecycle scope (archive/delete)

DMs and channels support two lifecycle scopes when archiving or deleting:

- **self** — only the current participant's view is affected. Archive hides the conversation from the actor's sidebar; delete removes the actor's participant row. This is the default and is available to all participants.
- **everyone** — applies the action to every active participant. Archive moves the conversation to Archived for all members; delete soft-deletes the conversation record. This scope requires the workspace **owner** role and is enforced server-side in both the BFF route and the Convex/Postgres repositories.

The scope is selected via `ConversationScopeActionDialog` (`src/features/chat/components/collaboration/ConversationScopeActionDialog.tsx`), which is shown from the sidebar archive button, the DM header menu, and the Archived panel's delete confirmation. The API contract uses `archiveScope` on `ConversationParticipantStateInput` for archive and `scope=self|everyone` query parameter on `DELETE /api/v1/conversations` for delete.

## Future platforms

### Microsoft Teams

- Use Composio's Teams toolkit (if available)
- Same adapter interface, different tool slugs
- Teams has different threading model (replies are nested in channels, not separate threads)

### Discord

- Use Composio's Discord toolkit
- Guild channels → Overlay conversations
- Discord's threading model (forum channels, thread channels) needs mapping

### Telegram

- **File-upload only** — Telegram bots cannot backfill arbitrary history
- Parse Telegram Desktop JSON export
- No Composio integration needed for import (only for live sync if desired)

### Slack ZIP upload (escape hatch)

- For admin exports that include channels the bot can't access
- Parse Slack's ZIP export format (channels/ folder, DMs/ folder, users.json)
- Same normalizer, different source (file system instead of API)
- Separate BFF route: `POST /api/v1/imports/slack/upload`
