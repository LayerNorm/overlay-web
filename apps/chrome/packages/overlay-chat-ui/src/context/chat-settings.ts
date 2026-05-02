/**
 * Extension-local mirror of the `ChatStreamingMode` type exposed by
 * `@overlay/app-core` and re-exported from
 * `overlay-landing/src/components/app/AppSettingsProvider.tsx`.
 *
 * The landing AppSettingsProvider wires React context, WorkOS sync, and
 * localStorage persistence — all of which the side panel supplies via its
 * own `chrome.storage.local`-backed provider. We only need the type here
 * so MarkdownMessage's prop surface stays source-compatible with the
 * synced landing file.
 */
export type ChatStreamingMode = 'token' | 'chunk'
