# Changelog

## Unreleased

- Bring the agent creatures to the front of the mobile app: a welcome screen with drifting creatures, a four-step intro for new users (meet Overlay, agents on their own computer, delegating work, notifications) that ends in the Overlay chat and can be replayed from the account sheet, a visual new-agent sheet (name, creature shape and color) that opens the new agent's chat, an agent profile sheet from a tappable avatar capsule in the conversation header, and a creature greeting in empty agent chats.
- Replace the old silver orb app icon and launch screen with the approved Overlay mark (Libre Baskerville O with eyes): a light icon matching the web app icon plus iOS dark and tinted variants, an Android adaptive foreground, and a launch screen that shows the mark on the app background in light and dark mode.
- Give conversations a native iOS navigation bar: agent threads, DMs, channels, threads and personal chats show the name (with avatar or member count) and a system back button, agent thread actions move into a native menu, agent threads get a compact message field, the Chats list now includes personal chats alongside workspace chats and rooms, and the chat integration tests drive the Chats compose action instead of the removed sidebar.
- Rebuild the mobile shell on native iOS navigation: a Liquid Glass tab bar (Work, Agents, Chats, Files, Search) replaces the custom drawer and breadcrumbs, every tab gets a native navigation bar with large titles, system menus and search, a new Chats list with a native segmented filter replaces the drawer recents, and Automations, Extensions, Activity, Voice and Settings move into a native account sheet.
- Manage outbound webhooks from mobile Settings in workspaces where webhooks are enabled.
- Show live agent computer status on mobile and let editors start or stop it.
- Browse and manage personal or workspace app connections separately in mobile Extensions.
- Open a running agent computer in a read-only mobile desktop viewer.
- Show dependencies between visible tasks in mobile Timeline and shift a scheduled task by a day from its date editor.
- View the workspace and personal agent organization from mobile Work, with access to each visible agent’s details.
- Move and reorder Work cards from the mobile Board, and set or clear dates directly from Timeline.
- Add a release-configured iOS simulator build profile for startup checks on Macs with limited storage.
- Point iOS sign-in and app links at overlay.works so authentication can return directly to the app.
- Fetch the pinned public web dependencies during standalone builds without requiring a GitHub token.
- Add Board and Timeline views to mobile Work so you can browse tasks by status or see their scheduled dates by week, then open any task to edit it.
- Resolve shared workspace imports and bundled math fonts from the pinned web checkout so standalone iOS builds can package the app.
- Bridge successful allowlisted search and browser results into native chat as bounded, openable URL sources without exposing raw tool payloads.
- Add an accessible Jump to latest control that returns the shared Mobile transcript to the bottom and follows later growth until the user scrolls away; keep it available when streaming growth creates an away gap while selection has paused follow, even without a scroll event.
- Make the Native focus-resume regression wait boundedly for its scheduled readiness callback without changing runtime focus behavior.
- Pause latest-follow at the start of selectable transcript pointer/touch holds so streaming cannot move the target before a selection forms; restore short taps, preserve scroll intent, and finish outside releases with lifecycle-cleaned document/window listeners without pointer capture.
- Guard Native bootstrap cache and refresh results against malformed structural data; recover bad cache entries without inventing fallback values.
