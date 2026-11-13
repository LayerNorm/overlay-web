# Changelog

## Unreleased

- Bridge successful allowlisted search and browser results into native chat as bounded, openable URL sources without exposing raw tool payloads.
- Add an accessible Jump to latest control that returns the shared Mobile transcript to the bottom and follows later growth until the user scrolls away; keep it available when streaming growth creates an away gap while selection has paused follow, even without a scroll event.
- Pause latest-follow at the start of selectable transcript pointer/touch holds so streaming cannot move the target before a selection forms; restore short taps, preserve scroll intent, and finish outside releases with lifecycle-cleaned document/window listeners without pointer capture.
- Guard Native bootstrap cache and refresh results against malformed structural data; recover bad cache entries without inventing fallback values.
