# Agent-created files and activity

**Status:** Implemented; targeted validation passed (browser QA intentionally not performed)

## UX scope

- Keep agent-created notes, images, and videos attached to the conversation that produced them.
- Show compact, file-backed media cards in both chat and agent-room transcripts, with the same file identity in the current conversation Library.
- Open a file in the existing right-side preview surface from either chat or Library. Preserve the transcript scroll position; do not navigate to Files or open an external tab.
- Keep tool activity collapsed and sequential by default. Use descriptive, status-aware labels; reveal command, path, exit code, and duration on expansion.
- The Library remains conversation-scoped. Retain existing linked files; do not imply that this view aggregates every file belonging to an agent.

## Implementation steps

1. **Return a persisted file reference from creation tools.**
   - Define the shared `PersistedFileReference` contract with stable `fileId`, `name`, `mimeType`, optional `sizeBytes`, revision, conversation association, and media metadata.
   - Add `fileReference` to successful Computer publication, note creation/edit, and file-write results while retaining their existing result fields.
   - Derive binary publication conversation ownership from validated root-run authority metadata; freeze it through manifest and commit replay, without accepting a model-supplied conversation ID.
   - Generic shell writes are not inherently persisted. Explicitly publish user-facing deliverables; exclude temporary, intermediate, and build files.

2. **Normalize persisted outputs for chat and agent-room transcripts.**
   - Add one shared adapter for chat and agent-room transcript consumers; do not introduce a new display tool.
   - Normalize successful structured file references and known canonical Markdown file links into compact cards, preserving narrative text and avoiding duplicate media. Safe external Markdown images remain compact and previewable without becoming persisted-file identities.
   - Keep the existing compact video/image sizing, and let the same file reference open the shared preview state from either transcript surface.
   - Deduplicate by persisted `fileId`, not filename or transient tool-call ID. If a file is written more than once in one response, keep its latest revision; a later response may show a newer revision.

3. **Connect the conversation Library and preview panel.**
   - Keep `useConversationFiles` / `api.files.browse.forConversation` as the source for current-conversation files; do not silently change it to agent-global scope.
   - Replace the Agent Library route-away interaction with a callback into the shared `DirectMessageExperience` / `useChatPanels` preview state. Agent cards and Library rows force panel mode; Back to Library reopens the external Agent sidebar and selects its Library tab.
   - Reuse `AttachmentPreviewPanel` / `FileViewerPanel` and `FileViewer`; support video, image, and MIME-classified Markdown previews with loading, unsupported, denied/deleted, unavailable, and retry states.
   - Refresh persisted-file requests through the canonical authorized content route. Do not store signed URLs or bypass workspace, scope, or file permissions.

4. **Keep publication and preview failures truthful.**
   - Create cards only from successful known tool results; failed or unavailable uploads remain tool errors and do not appear as files.
   - Do not add an automatic upload retry unless it reuses a safely idempotent publication attempt. Preview retries use the authorized canonical content route.
   - Handle late/duplicate results without duplicate cards. A refreshed conversation query remains authoritative after reload.

5. **Describe tool work and verify both surfaces.**
   - Extend `getDescriptiveToolLabel` with deterministic known-path/command labels, safe fallbacks, credential redaction before clipping, and truthful pending/success/failure tense.
   - Keep Computer details logo-free and collapsed by default; reveal only sanitized path/command and result-supplied exit code/duration. Do not add unsupported diff statistics.
   - Targeted tests cover references, conversation association, dedupe, preview selection, permissions, and success/failure labels; broader visual QA remains separate.

## Verified seams and evidence

- `src/features/agents/components/AgentRightSidebar.tsx` defines Details, Library, and Computer tabs; `AgentRightSidebar.parts.tsx` renders `AgentLibraryTab` from `useConversationFiles(conversationId)`.
- `src/hooks/use-file-tree.ts` subscribes to `api.files.browse.forConversation`; `convex/files/browse.ts` filters to the supplied workspace/user/conversation and excludes deleted files.
- `src/server/tools/tools/notes-executes.ts` and `src/server/tools/tools/files-executes.ts` are the first-party note/file producer paths. Successful results now include typed references while keeping legacy fields.
- `src/server/tools/tools/build.ts` defines `computer_publish_file`; `ArtifactPublicationAuthority.ts`, `harness/runs.ts`, and `files/artifactPublications.ts` bind publication to the validated root run, freeze optional conversation identity in the manifest, and commit it through `files/lib/uploadPublication.ts`.
- `src/shared/chat/persist-assistant-turn.ts` persists tool outcomes in message parts and retains a parsed reference when large tool outputs are compacted. `packages/overlay-chat-core/src/file-reference.ts` allowlists known producer names and parses typed and historical successful outputs.
- `packages/overlay-chat-core/src/visual-sequence.ts` is the shared chat/room adapter; `toChatTranscriptView.ts` and `room-message-view.ts` feed persisted message parts to it. `AssistantSegmentItem.tsx` renders the shared compact cards.
- Chat already has compact media in `packages/overlay-chat-react/src/components/MediaSlotOutput.tsx` and `MediaExchange.tsx`.
- Shared preview state is owned by `DirectMessageExperience` / `src/features/chat/components/chat/useChatPanels.ts`; `src/components/ConversationFilePreviewContext.tsx` scopes Library callbacks to the room. `AgentConversationWorkspace.tsx` supplies Back-to-Library behavior; the attachment shell retains priority over the external Agent sidebar.
- `packages/overlay-modules-react/src/knowledge/file-viewer.tsx` previews supported image/video content, classifies Markdown by MIME, and exposes loading, permission, missing, unsupported, retry, and media-error states. The original Library click navigated to `/app/files?file=…`; it now opens the shared side-panel preview.
- `getDescriptiveToolLabel` in `packages/overlay-chat-core/src/tool-labels.ts` is the shared activity-label seam; first-party Computer read/write/exec actions now use deterministic path/command labels and sanitized, result-backed details.
- Agent-room transcript rendering is in `src/features/chat/components/collaboration/RoomMessageItem.tsx`; generated chat media also flows through `src/features/chat/components/ChatMediaMessage.tsx`.

## Evidence limits

- Targeted Node/Vitest tests cover persisted-reference producers, reload adapters, latest-revision deduplication, chat/room cards, preview error/retry and stale-request handling, Computer publication permissions/replay, and file-viewer states. `npm run typecheck` and `npm run check:shared-isomorphic` passed; targeted ESLint reported 0 errors and 5 existing warnings.
- Agent Host harness artifacts are a separate protocol/storage path from Overlay Files and were intentionally left unchanged.
- UI appearance, keyboard focus in a browser, narrow-screen layout, and hosted Preview behavior remain visually unverified; no deployment or browser setup was performed.

## Contract and interaction rules

- `fileId` identifies the persisted Overlay Files row; transcript cards must not use a display name as identity.
- Include a revision/version key where the file service exposes one so the same file card can reflect its latest edit within a response and later responses can show newer revisions.
- Treat byte size as persisted metadata. Include duration and dimensions only when the file service or media probe returned them.
- Carry the originating conversation association from the tool context through commit and into the reference.
- A successful reference means the file is committed and authorized, not merely present in a Computer or temporary directory.
- A tool that creates a temporary intermediate can keep its normal result text without creating a user-facing file card.
- For media cards, keep the existing compact aspect ratios and metadata density; keep the larger review surface in the right panel.
- Opening a file from chat or Library should call the same preview selection path and resolve the same file ID.
- Returning from preview restores the Library list and conversation context; closing the panel never changes routes.
- At narrow widths, keep the transcript visible and present preview/navigation in focus-managed sheets or drawers.
- The active file permission is checked on each fetch; a card does not grant access to its preview URL.
- If a file is removed or access is revoked, replace stale content with a clear unavailable state rather than a broken media element.
- A retry must reuse or safely replace the failed publication attempt; it must not create a second Library row.
- A preview URL refresh must preserve the selected file and play only after the user explicitly starts playback.
- Descriptive tool labels use known arguments/results, redact credential-like values, and truncate paths/commands without losing their target.

## Implementation boundaries

- No agent-global aggregation is implied by the current Library API; its verified scope is the active conversation.
- Existing linked files remain visible; new events add or update only their matching persisted reference.
- Chat and agent-room consumers share the adapter, but each retains its existing transcript ownership and permissions.
- Unknown or unsafe Markdown links remain ordinary text; do not turn arbitrary HTML or remote URLs into trusted media.
- External-image fallback is limited to safe image URLs and must not bypass the preview's access policy.
- Only authorized backend responses may supply durable preview URLs; never persist an expiring URL as file identity.
- File viewer failures, deleted files, and denied permissions should be distinguishable from a file that is still uploading.
- Tool history remains logo-free and chronological; do not add fabricated diff counts or success claims for failed calls.
- Keep the proposed right-side preview within the existing shell instead of adding app navigation or another display tool.

## Targeted QA

- `src/server/tools/tools/notes-executes.test.ts` and `files-executes.test.ts`: persisted reference and conversation association.
- `convex/computerFilePublication.convex.test.ts`, `src/server/files/computer-publication.test.ts`, and `convex/nativeFiles.convex.test.ts`: binary commit, access, and conversation query.
- `packages/overlay-chat-react/src/components/transcript/ChatTranscript.test.tsx` and `packages/overlay-modules-react/src/knowledge/file-viewer.test.tsx`: compact output and preview behavior.
- `packages/overlay-chat-core/src/tool-labels.test.ts`: descriptive labels and status wording.
- Verify a new note, image, and video appear in chat and Library and remain after reload; open the same file from both entry points.
- Exercise duplicate/late results, failed upload and retry, denied/deleted files, and expired preview URLs.
- Verify pending, success, and failure activity labels; inspect expanded details for redaction and truncation.
- Render desktop and narrow layouts in light and dark themes; ensure right preview and workspace navigation drawers remain keyboard accessible.
