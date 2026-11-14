# Teams sync: Microsoft app setup

Microsoft Teams channel sync (plan Phases 4 and 5 in `internal/plans/SLACK_TEAMS_SYNC_PLAN.md`) runs on one multi-tenant Microsoft Entra app plus a Teams app package that customers install. Everything uses official Graph APIs; no browser session tokens.

## How access works

| Access | Who grants it | What it allows |
| --- | --- | --- |
| Admin consent (application permissions `Team.ReadBasic.All`, `User.ReadBasic.All`, `Organization.Read.All`) | A tenant admin, from **Settings → Workspace → Import & sync → Connect Teams** (`/api/v1/sync/teams/connect`) | List the tenant's teams, read people's names and emails so Teams authors match Overlay members, show the organization name. None of these are Microsoft "protected APIs". |
| Resource-specific consent (`ChannelMessage.Read.Group`, `ChannelSettings.Read.Group`) | Whoever adds the Overlay Teams app to a team | Read and subscribe to that team's channel messages and list its channels with an app-only token. Teams where the app is not installed answer 403 and are skipped. No tenant-wide `ChannelMessage.Read.All` approval is needed. |
| Delegated `ChannelMessage.Send` + `offline_access` (+ `openid profile User.Read`) | Each member, from **Connect your Teams account** (`/api/v1/sync/teams/account/connect`) | Post (and react) in Teams as that member, in every channel type. Access and refresh tokens are sealed with `sealSyncToken` before they reach Convex. |

Live sync uses Graph change notifications **without resource data**: a notification names the changed message and the web server fetches it, so no notification encryption certificate is needed. Each standard channel gets its own subscription (`/teams/{team}/channels/{channel}/messages`, created/updated/deleted, 70-hour lifetime, renewed 12 hours ahead by the Convex `teams sync maintenance` cron through `/api/v1/sync/teams/maintain`). Graph refuses resource-specific-consent subscriptions on **private and shared channels** (403 "Caller is not allowed to subscribe ... for Shared/Private channel"), although reading them works, so those links are polled every minute by the same cron. Links whose app was removed pause with a fix the settings page shows ("Add Overlay to this team / private channel / shared channel in Teams to resume.") and are retried every 15 minutes.

## Register the Entra app (Phase 0)

1. Entra admin center → **App registrations** → **New registration**. Name it Overlay, choose **Accounts in any organizational directory (multitenant)**.
2. **Authentication** → add a **Web** platform with these redirect URIs for each environment:
   - `https://www.getoverlay.io/api/v1/sync/teams/callback`
   - `https://www.getoverlay.io/api/v1/sync/teams/account/callback`
   - the same two paths on any PR Preview origin used for QA (Entra has no wildcards; add the exact `https://pr-<number>.preview.getoverlay.io` origin while testing).
3. **Certificates & secrets** → new client secret. Store it as `MICROSOFT_SYNC_CLIENT_SECRET`; the app's Application (client) ID is `MICROSOFT_SYNC_CLIENT_ID`.
4. **API permissions** → Microsoft Graph:
   - Application: `Team.ReadBasic.All`, `User.ReadBasic.All`, `Organization.Read.All`.
   - Delegated: `ChannelMessage.Send`, `User.Read`, `offline_access`, `openid`, `profile`.
   Do not request `ChannelMessage.Read.All`; resource-specific consent replaces it.
5. Create an **Azure Bot** resource (F0 tier, multi-tenant) that uses the same app id, with messaging endpoint `https://www.getoverlay.io/api/v1/webhooks/teams`. Teams only installs apps into a team when they have a team-scoped capability, so the package declares a notification-only bot. It never posts; the webhook ignores Bot Framework activities.

## Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `MICROSOFT_SYNC_CLIENT_ID` | Vercel (Preview, Production) | Entra app id; also the bot id and `webApplicationInfo.id` in the Teams app package. |
| `MICROSOFT_SYNC_CLIENT_SECRET` | Vercel (Preview, Production) | Client secret for app-only tokens, admin consent and member code exchange. Server only. |
| `MICROSOFT_SYNC_NOTIFICATION_BASE_URL` | Local development only (optional) | Public HTTPS tunnel origin Graph should notify instead of the app URL. Graph validates the URL when each subscription is created. |
| `SESSION_SECRET` | already set | Signs the OAuth state for both Microsoft redirects. |
| `SLACK_ENCRYPTION_KEY` | already set | Key material for `sealSyncToken` (members' Teams tokens), as for Slack. |
| `INTERNAL_API_SECRET` | already set (Vercel and Convex) | Authenticates Convex calls and `/api/v1/sync/teams/maintain`; also keys each subscription's `clientState` HMAC. |
| `OVERLAY_BFF_URL` | Convex (already set) | Where the Convex cron sends Teams maintenance work. |

## Teams app package

Owners and admins download it from `/api/v1/sync/teams/app-package` (manifest v1.17 plus a 192×192 color and 32×32 outline icon generated from the approved OverlayMark). The app id is derived from the client id, so every download is the same app. A Teams admin uploads it in the Teams admin center (or allows custom apps), then a team owner adds Overlay to each team, and to each private or shared channel, that should sync.

## Limits and follow-ups

- Channel discovery lists up to 500 teams per request and reads each team's channels with up to 8 concurrent calls.
- Private and shared channels are polled from the newest 20 posts with replies; a reply to an older post is picked up by history repair rather than the poll.
- Graph cannot reach protected Preview deployments without the Vercel bypass, so subscription creation on a Preview needs either the bypass on the notification URL or a tunnel via `MICROSOFT_SYNC_NOTIFICATION_BASE_URL`.
- Outward edits and deletes call Graph's PATCH and softDelete, which need delegated `ChannelMessage.ReadWrite`; members grant that once Phase 6 ships.
