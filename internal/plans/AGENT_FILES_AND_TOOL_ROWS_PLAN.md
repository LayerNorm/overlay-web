# Agent files in the Library, file cards in chat, descriptive tool rows

Status: All four phases are implemented on `codex/agent-files-and-tool-rows` (draft PR). Not merged
or deployed; hosted Preview QA is pending.

| Phase | State |
| --- | --- |
| 1. Link agent files to threads | Implemented, Convex tests pass |
| 2. Library thumbnails and in-panel preview | Implemented, not yet browser-tested |
| 3. Chat file cards and Markdown images | Implemented, render tests pass |
| 4. Descriptive tool rows | Implemented, unit and render tests pass |

Deviations from the plan: Overlay file *links* (not images) stay links rather than turning into
cards, so a sentence never breaks around a card. Connected-agent diff counts are computed in
`describeToolCall` from the diff part's patch, so the ACP adapter is unchanged.
Mockup: [`mockups/agent-files-and-tool-rows.html`](mockups/agent-files-and-tool-rows.html)
(source `.tsx`/`.css`, rebuilt with `node internal/plans/mockups/build-agent-files-and-tool-rows.cjs`).

## Goal

1. **Library.** Every file an agent creates in a thread (notes, images,
   videos, documents) appears in the right panel's **Library** tab as soon as
   it exists. Clicking it previews the file inside that panel, so the user
   stays in the thread.
2. **File cards in chat.** Messages show created or referenced files at a
   sensible size:
   - images as a thumbnail (at most 320px wide) that opens a lightbox
   - videos as a poster frame with a play badge, three across at most
   - notes as a title plus a two-line snippet

   Markdown images stop filling the full thread width.
3. **Descriptive tool rows.** Computer and command calls describe what they
   did, for example "Read `auth.ts:1-50`", "Searched `src` for X", "Ran
   `npm test`", "Edited `WorkTaskComposer.tsx` +20 −6" or "Created
   `day-01-v3-a.mp4`". Rows stay logo-free and sequential inside the existing
   "Worked for / Working for" group.

## Decision: derive file cards; add no "show file" tool

The data needed already exists:

- Every file-creating tool returns an id:
  - `write_file` returns `fileId`
  - `create_note` returns `noteId`
  - `generate_image`, `generate_video` and `animate_image` return `outputId`
  - `computer_publish_file` returns `artifact.fileId` and `downloadUrl`
- Overlay file URLs have one detectable shape, `/api/v1/files/<id>/content`.
  `isFileContentHref` in `packages/overlay-chat-react/src/components/markdown/plugins.ts:14`
  already detects it.

So cards come from two sources:

- **Inline:** a Markdown image or link that points to an Overlay file renders
  as the matching card in place. Image, video and note are told apart by the
  file's `mimeType`/`kind`.
- **End of turn:** files created during the turn that the text never mentions
  render as a compact card strip after the message. A file the text already
  references inline is not repeated.

A dedicated `show_file` tool would cost a tool round trip and one more tool
for every agent to learn, and it would duplicate what the results already
say. It would only help with showing an *existing* file that was not created
this turn. The agent can already do that by embedding
`![](/api/v1/files/<id>/content)`, and the system prompt should say so (one
line, Phase 3). Revisit only if agents prove unreliable at it.

## Phase 1: link every agent-created file to its thread (Convex)

The Library reads `api.files.browse.forConversation`
(`convex/files/browse.ts:127`, through `useConversationFiles` in
`src/hooks/use-file-tree.ts:30`). It returns only rows that carry
`conversationId`. Convex is reactive, so a row appears as soon as it is
written; the fix is to make sure every creation path writes the link.

- `convex/files/artifactPublications.ts:304` (`computer_publish_file`)
  currently patches only `createdByAgent`. It should also set
  `conversationId` and `turnId`, passed from
  `src/server/files/computer-publication.ts`.
- `convex/agents/agentDriveUploads.ts:190`: same change for agent-drive
  uploads.
- `src/server/tools/tools/overlay-executes.ts` ~805–931:
  - Confirm `generate_image`, `generate_video` and `animate_image` pass
    `conversationId`/`turnId`.
  - Add `fileId` and `url` (`/api/v1/files/<id>/content`) to their results,
    because the cards need them.
- `convex/files/files.ts:159` `browserFileSummary`: expose `mimeType`,
  `kind`, `outputSource`, `createdByAgent`, `turnId` and a `previewUrl`.
  It already exposes `previewText` for notes.
- New query `files/browse:summariesByIds({ ids })` in `convex/files/browse.ts`
  for chat cards. It is batched per message, applies the same access check as
  `forConversation`, and omits rows the viewer cannot read.
- There is no `agentId` column. The agent link stays
  `files.conversationId → conversations.agentId` (`convex/schema.ts` ~1343).
- No backfill: older files without `conversationId` stay out of the Library.
- Tests: Convex tests showing that each creation path sets `conversationId`,
  and that `summariesByIds` refuses another user's personal file.

## Phase 2: Library rows and an in-panel preview

- `src/features/agents/components/AgentRightSidebar.parts.tsx:9`
  `AgentLibraryTab`:
  - Rows get a 32px media thumbnail: an image `<img>`, or a `<video
    preload="metadata">` first frame. Notes and documents keep the Lucide
    icon tile.
  - The secondary line becomes `Video · Created just now`.
  - A notice dot marks files created since the user last opened the thread,
    reusing the thread-unread color token.
  - List order is newest first.
- Clicking a row no longer navigates to `/app/files`. It sets
  `previewFileId` in the panel state that `AgentRightSidebar.tsx` and
  `AgentConversationWorkspace.tsx:437` already own.
- New `AgentLibraryPreview` (same folder) replaces the hero and tabs while it
  is open:
  - header: back arrow, name, meta line, close
  - body: `FileViewer` from
    `packages/overlay-modules-react/src/knowledge/file-viewer.tsx:249`, which
    covers markdown, image, video, PDF, docx and HTML, using the host wiring
    from `src/app/app/_components/KnowledgeViewHost.tsx:34–53`
  - footer actions: **Open in Files** and **Download**
- Expose `openLibraryFile(fileId)` through a small context, so that chat
  cards and tool rows (Phases 3–4) can open the panel to the preview.
- At widths under 768px, the panel is the existing overlay drawer, and the
  preview fills it.

## Phase 3: chat file cards and Markdown image interception

New components in `packages/overlay-chat-react/src/components/files/`
(`@overlay/ui` primitives, Lucide icons only):

- `ChatImageThumb`: at most 320×240, `object-fit: cover`, 10px radius,
  1px border. Opens a lightbox built on the `@overlay/ui` `Dialog`, with
  **Show in Library** and **Download** actions. `AttachmentPreviewDialog`
  (`components/AttachmentPreviewShell.tsx:86`) is the base to extend; no
  lightbox exists today.
- `ChatVideoCard`: a 16:9 poster from `<video preload="metadata">` at `#t=0.1`.
  - Play badge bottom-left, duration bottom-right, name and description
    below.
  - Cards sit in a grid at most 600px wide: three columns on desktop, two
    under 768px.
  - On an agent thread, clicking opens the Library preview. In Chats, which
    has no Library, it plays inline.
- `ChatNoteCard`: icon tile, title and a two-line `previewText`, at most
  460px wide. It opens the Library preview, or the note in Chats.
- `ChatFileCard`: a fallback for documents and other types.

Wiring:

- `markdown/renderers.tsx:242–331`: add an `img` renderer.
  - For an Overlay file URL, render the card for that file's kind.
  - For any other URL, render `ChatImageThumb` with the same size cap.
  - Wire it through `mdRenderComponents` in `MarkdownMessage.tsx:107`.
    Overlay file links (`a`) to images or videos render as cards too.
    Ordinary links stay links.
- `markdown/tool-resource-links.ts`: besides hrefs, collect the file ids the
  turn created from `write_file`, `create_note`, `generate_*` and
  `computer_publish_file` results.
- `transcript/AssistantVisualBlocks.tsx` / `ChatExchange.tsx`: after the
  assistant text, render the strip of created files that were not referenced
  inline. Existing `FileSegmentItem` generated-media blocks
  (`AssistantSegmentItem.tsx:249–280`) move onto the same card components.
- While a response is streaming, an incomplete Markdown image shows nothing
  until its URL closes. This avoids broken-image flicker and matches the
  complete-chunk streaming rule.
- System prompt: one line telling agents to embed
  `![name](/api/v1/files/<id>/content)` when they want to show a file.

## Phase 4: descriptive tool rows

- `packages/overlay-chat-core/src/tool-labels.ts:156`: add
  `describeToolCall(toolName, input, output, phase)`. It returns
  `{ verb, target?, range?, detail?, code?, added?, removed?, fileId? }`.
  `getDescriptiveToolLabel` becomes a join of those parts, so existing string
  consumers and aria labels keep working. Mappings:

  | Tool | Row |
  | --- | --- |
  | `computer_exec` | Recognize a small, conservative set of commands: `rg`/`grep` → **Searched** `dir` for "pattern"; `cat`/`sed -n a,bp`/`head`/`tail` → **Read** `file:a-b`; `ls`/`find` → **Listed** `dir`. Anything else → **Ran** `` `first line of command` ``, clipped to about 90 characters with the full command in the row's tooltip. |
  | `computer_read_file` | **Read** `basename(path)` |
  | `computer_write_file` | **Created** or **Edited** `basename` +a −b |
  | `computer_list_files` | **Listed** `dir` |
  | `computer_open_url` | **Opened** `host/path` |
  | `computer_screenshot` | **Took a screenshot** |
  | `computer_publish_file`, `write_file`, `generate_*` | **Created** `name` (clickable, opens the preview) |
  | `create_note` | **Saved note** `title` (clickable) |
  | `remote_diff` (connected agents) | **Edited** `path` +a −b |
  | `remote_terminal` (connected agents) | **Ran** `` `summary` `` |
  | `remote_action` (connected agents) | Keeps its ACP title |

  Phases: `running` uses the present tense ("Running …"); a completed call
  uses the past tense.
- Diff stats:
  - `computer_write_file`: the executor at `overlay-executes.ts:1153` reads
    the old file (ignoring a missing one), counts changed lines against the
    new contents, and returns `{ created, linesAdded, linesRemoved }`.
  - Connected agents: count `+`/`-` lines of the unified patch, either in
    `src/shared/agents/remote-agent-transcript.ts:111–175` or in
    `packages/overlay-agent-host/src/acp-adapter.ts:385`.
  - The group header sums the stats ("Worked for 4m 12s +98 −18").
- Rendering, in `packages/overlay-chat-react/src/components/exchange/`:
  - `tool-call-rows.tsx` (`ToolCallRowWithReasoning` :20, label at :32) and
    `trace-step.tsx` render the parts. The verb is muted, the target is
    foreground, commands use the mono font, and diff stats are small green
    and red tabular figures.
  - Rows that carry a `fileId` are buttons that call `openLibraryFile`.
  - Single line with ellipsis, logo-free; `ToolLineLogo`/`TraceMark` stay
    empty.
  - `worked-for-group.tsx:23` keeps folding and ordering. The live row shows
    a small muted pulse dot, not a spinner logo.
- Redaction: before display, replace values of `*_KEY=`, `*_TOKEN=`,
  `*_SECRET=`, `Authorization:` and `--password` in command text with `•••`.
  Only the display is redacted; the stored tool input is unchanged.
- Tests: extend `tool-labels.test.ts` with a table covering each mapping,
  clipping and redaction. Extend `tool-call-rows.test.tsx` for clickable
  file rows and the summed diff header.

## Docs to update in the same changes

- `CHANGELOG.md` (every phase).
- `internal/develop/interface-design.md`: the file-card sizes and the
  lightbox.
- `internal/develop/tool-catalog.md`: the new result fields on
  `computer_write_file` and `generate_*`.
- `internal/develop/api-source-of-truth.md`: the new `summariesByIds`
  query.
- This plan's Status line and a progress table as phases merge.

## Risks

- **Access.** In a workspace thread, a member may not be able to read
  another member's personal file. `summariesByIds` drops such files, and
  cards render nothing rather than a broken image. The content route already
  enforces access.
- **Secrets in commands.** Showing command text exposes anything typed
  inline. The display redaction above limits this; full commands stay out of
  rows and appear only in the tooltip, redacted the same way.
- **Video cost.** Many video cards in a long thread could fetch large files.
  `preload="metadata"`, lazy mounting (`IntersectionObserver`) and the
  content route's Range support keep it to headers and the first frame.
- **Command heuristics.** A wrong guess ("Searched" for a piped `grep`)
  would mislead. Parse only simple, unpiped forms and fall back to **Ran**.
- **Duplicates.** A file referenced inline and also created this turn must
  render once. Dedupe by file id.
- **Older files.** Files created before Phase 1 stay out of the Library (no
  backfill, by choice).
- **Layout.** Long names and commands must ellipsize inside the 896px column
  and the 320px panel. The mockup checks both themes at 1440px and 390px.

## QA checklist (on the PR Preview, per phase)

- [ ] On an agent thread, ask the agent to write a note, generate an image,
  render or publish a video from the computer, and write a document. Each
  appears in Library while the run is still working, without a reload.
- [ ] Click each Library row: the preview opens in the panel, Back returns to
  the list, Open in Files and Download work, and Close hides the panel.
- [ ] In chat, the image thumbnail is at most 320px wide and opens the
  lightbox. Video cards sit three across and open the preview. The note card
  shows the title and two lines.
- [ ] A Markdown image with an external URL renders as a capped thumbnail,
  not full width.
- [ ] Rows read "Ran `…`", "Read file:range", "Searched dir for …", "Edited
  file +a −b" and "Created name". Created rows open the preview. The group
  header sums the diff stats.
- [ ] A command containing `API_KEY=abc` shows `API_KEY=•••`.
- [ ] A connected agent (Codex or Claude Code) edit shows "Edited path +a −b".
- [ ] A second workspace member without access sees no broken cards.
- [ ] Check light and dark at desktop and at 390px. The panel becomes a
  drawer, cards drop to two columns, and nothing scrolls horizontally.
- [ ] Reduced motion: no pulse animation on the live row.
- [ ] Commands: run `tool-labels.test.ts` and `tool-call-rows.test.tsx`
  directly with `node --test` (the runner `scripts/ci/run-all-tests.mjs`
  uses), targeted ESLint on changed files, `npm run typecheck`, and the
  Convex tests for Phase 1.
