# Native push wiring

Backend: `convex/notifications/tokens.ts` (native `register`/`unregister`) and the
Expo delivery in `convex/lib/mobilePush.ts`, both on `main` and production; see
`internal/develop/mobile-push.md`. No HTTP token endpoint or public Expo secret exists.

`usePushNotifications` starts only after native authentication is ready. Launch
and foreground only inspect existing permission; they never request it. Settings
is the meaningful pre-prompt trigger. After granting, the service obtains an Expo
token and registers it with a persisted random installation ID. Native token
changes and foreground recovery re-check the Expo token; concurrent requests are
single-flight and unchanged tokens avoid redundant mutations. Missing Expo/EAS
setup or raw-device fallback stays local and cannot pretend background delivery.

Registrations are identity-scoped and serialized. Sign-out invalidates pending
captures, attempts unregister before clearing the session, and clears cached user
tokens and displayed/last-response notifications. Unregister is best-effort with
a three-second bound so offline cleanup cannot trap the user in the app. The
installation ID survives sign-out; registering the same token as a new user moves
ownership on the server. Permission revocation also attempts unregister on the
next foreground.

Notification response listeners and cold-start last-response handling consume
`data.url`. Only local channel/DM/chat/thread paths with a workspace and valid
conversation IDs are accepted. The existing conversation router resolves the
destination after workspace switching and retains its calm unavailable state.
In-flight duplicates are coalesced; successful responses are cleared. Legacy local
workspace-notification taps continue working. Identity changes cancel stale routes.

Registered devices use server push rather than duplicate local feed banners.
Remote foreground banners honor the existing device-local category toggles;
background delivery follows persisted backend preferences and conversation mute
levels. Device-local toggles are not represented as server-wide preferences.
The local watcher remains a foreground-only fallback if registration is unavailable.

## Checks and isolated acceptance

- `bun run check`
- `node --test scripts/phase*.test.cjs scripts/push.test.cjs`
- Targeted ESLint, Android and iOS `expo export --source-maps --no-bytecode`.
- Inspect source maps for backend/alias/fixture modules and runtime `@/` imports.
- In the exact isolated backend, on a physical, credentialed Expo native build:
  grant permission, background/terminate, create a mention and approval/input wait,
  tap into the right workspace/thread, rotate token, switch accounts and sign out.
- Test muted/mentions-only conversations and server banner/activity/off modes.
- Offline sign-out cannot guarantee backend revocation; registration and display
  are best-effort. Simulator exports/mocked tests do not establish live delivery.

No customer deployment or real Expo delivery is part of local mocked verification.
