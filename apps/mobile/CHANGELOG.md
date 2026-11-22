# Changelog

## Unreleased

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
