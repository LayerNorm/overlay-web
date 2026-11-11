# Phase 2f — Settings and mobile-only controls

## Native surfaces

`components/settings/SettingsScreen.tsx` owns the Settings route; `SettingsViews.tsx` provides the shared production/fixture presentation. The legacy Memories route redirects here. Settings, memory attribution, members/invitations, provider connections, billing summary and account identity use generated-type-checked Convex subscriptions. Settings values also refresh the existing app-session cache.

Memory indexing/CRUD, invitations, provider credentials/tests, subscription-connection OAuth, account profile/photo writes and account deletion retain web's HTTP boundaries. The compatibility management adapter uses native people/teams/guests/roles/chats-agents; sharing/import remain HTTP because that native query does not expose them. The API-key editor excludes subscription connections, which use the dedicated OAuth sheet.

Billing is read-only. There are no purchase, top-up, checkout, billing-portal controls, purchase links or purchase-steering text. Balances and plan state come from the native summary rather than invented storefront data.

## Account deletion prerequisite

Web branch: `devin/1794356118-native-account-deletion`, commit `5b2976550cf880938dca368966e2b4853c29ccf1`. It must be deployed before native deletion can succeed. No PR was opened; the owner opens it.

After typing `DELETE`, the app requests a new hosted WorkOS PKCE authorization with `forceSignIn`, `prompt=login`, `max_age=0` and an ephemeral browser session. This preserves hosted SSO/Google/Apple support. The returned state, callback destination, fresh user and still-stored original user are checked. Android HTTPS app-link interception and `overlay://auth/callback` are both handled. Reauthentication does not replace the normal native session. A pending account-deletion authorization is marked in secure storage so a process restart cannot consume it as an ordinary sign-in.

The request sends the fresh Bearer token and `confirmation: "DELETE"` to `POST /api/account/delete` with `credentials: 'omit'`. Only a successful deletion response triggers local sign-out. Cancellation, wrong account, stale/rejected token, network/server errors and malformed responses leave the local account intact. PKCE state/listeners/timeouts are cleaned up. Account settings remain reachable from the no-workspace gate; deletion does not require joining a workspace first.

## Notification behavior (Phase 2f history; push follow-up implemented)

At Phase 2f there was no Expo/APNs/FCM token backend. The push follow-up now uses native Convex registration and Expo delivery; see `PUSH_QA.md` for the backend dependency and current contract. Startup only registers when permission is already granted; Settings remains the permission-request trigger. Raw device-token fallback is never uploaded to the Expo-only backend.

There is also no public native read/write API for global five-category workspace notification preferences. The UI clearly separates device-local foreground-banner categories from persisted conversation notification levels. Conversation list/state and all/mentions/muted changes use `collaboration.roomList.list` and `collaboration.rooms.state/updateMyState`, matching web. Banner toggles do not remove activity history or claim server-wide persistence.

Voice uses the existing iOS background-voice extension and microphone permission flow. Android reports that background voice is unavailable instead of exposing a fake working toggle. Transcription history/retention remain device-local. There is no implemented read-aloud service, so no no-op read-aloud toggle was added. Email is controlled by the hosted identity provider. Bug submission remains the existing hosted Help → Submit a bug handoff, with a public-GitHub warning; no fake native bug-report API was introduced.

## Verification and artifacts

```sh
npm run check
node --test scripts/phase*.test.cjs
node --test scripts/phase2f.test.cjs
npx eslint <changed TypeScript/TSX/test files>
npx expo export --platform android --source-maps --no-bytecode --output-dir /home/ubuntu/mobile-drift-audit/phase2f-android-export
npx expo export --platform ios --source-maps --no-bytecode --output-dir /home/ubuntu/mobile-drift-audit/phase2f-ios-export
```

Outputs/logs and Android screenshots: `/home/ubuntu/mobile-drift-audit/phase2f-settings/`. The ten screen IDs are `settings`, `memories`, `members`, `models`, `billing`, `notifications`, `voice`, `account`, `help`, `push-permission`. Each has `native-<screen>-{light,dark}.png` and `comparison-<screen>-{light,dark}.png`; comparison contact sheets show native beside the approved mockup. The native fixture renders the same Settings view components, not a separately recreated UI.

Intentional differences: production flat resource chrome/breadcrumbs, real native plan/credit semantics with every purchase CTA omitted, actual supported notification categories, provider connections generated from real records/capabilities, read-only identity-provider email, hosted bug reporting, and an explicit Settings permission sheet rather than an automatic Work interruption. Memory/navigation density and the permission-sheet layout were corrected after comparison. Permission denial opens device settings; permission state refreshes on foregrounding.

The deletion form is shared between production and native fixtures. Additional `native-delete-{empty,ready,error}-{light,dark}.png` artifacts check exact-word confirmation, disabled empty submission and draft retention after a **simulated** server rejection; they do not establish live deletion. Normal sign-out and successful deletion route back to hosted sign-in after local cleanup.

Fixtures and mocked transport tests establish presentation and adapter behavior, **not live signed-in persistence**. Real OAuth, account deletion, invitation delivery, provider credential handling, uploads, background voice and background push delivery require the owner's isolated acceptance environment. No production account was deleted or production data changed. iOS export is checked; iOS device execution is not.

## Live acceptance checklist

- On the deployed prerequisite, sign in with a disposable existing account. Settings → Account → Delete: wrong confirmation stays disabled; cancel and wrong-account sign-in preserve the original account; fresh same-account confirmation deletes and signs out. Repeat from the no-workspace gate.
- Create/edit/delete a disposable memory; invite/resend/cancel a disposable member invitation with the appropriate workspace role. Switch workspace during pending operations and confirm the old dialog closes.
- Connect an existing provider subscription through hosted OAuth; cancel an abandoned flow; verify active state arrives through Convex. Never purchase through mobile.
- Change a conversation's notification level and confirm it on web; independently disable a device banner category and ensure the activity feed still retains that event.
- Open device notification settings, inspect the pre-prompt, then Continue; verify permission, local token capture and native backend registration. Verify real background delivery separately on the isolated backend and a credentialed physical device.
- On iOS with the voice extension, grant/deny microphone permission, change retention and clear local history. Verify Android's calm unsupported state.
