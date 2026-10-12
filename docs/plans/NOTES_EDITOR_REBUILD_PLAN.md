# Notes Editor Rebuild Plan (BlockNote)

Status: draft for owner review. Goal: notes become the best editing experience on the web and the owner's default note-taking system.

## 1. Canonical model decision

**Canonical document = BlockNote document JSON. Markdown = derived projection plus interchange format.**

Reasoning:

- BlockNote's markdown layer is explicitly lossy in both directions (`blocksToMarkdownLossy`, `tryParseMarkdownToBlocks`). If markdown stays canonical, every save/load round-trips through two lossy functions. That is the jank we already have, rebuilt on a new library.
- Block JSON preserves everything the editor can express: block types, colors, alignment, embeds, toggles, block ids. Block ids matter later for comments, anchors, agent edits, and real-time cursors.
- "Customizable yet functional" resolves to: JSON doc gives unlimited customization (custom blocks, custom styles, custom inline content). A stored markdown projection keeps everything functional (agents, search, export, mobile, API).
- One source of truth, one direction of conversion. The editor never round-trips: load JSON, edit JSON, save JSON.

Markdown remains first-class but derived:

- `content` on the `files` row keeps holding markdown. Every existing consumer keeps working unchanged: agent tools, search/indexing, ExportMenu, mobile rendering, share pages, `/api/v1/notes`.
- The projection is regenerated on every doc save. Consumers never write to it directly except through the conversion path below.

## 2. Target experience

The bar is "instant, invisible, never loses work":

- Open a note: it renders immediately, cursor and scroll are restored.
- Type: zero flicker, zero reflow, markdown shortcuts (`#`, `-`, `>`, ` ``` `, `1.`, `[]`), paste markdown and it becomes real blocks.
- Structure: drag blocks, nest blocks, slash menu, callouts, toggles, tables, code with highlighting, math, embeds, images with resize.
- Save: no Save button. Autosave always on, tiny status pill (Saved / Saving / Offline), crash-safe.
- Style: quiet chrome, centered ~720px column, Overlay dark mode perfect, shadcn-aligned menus.

## 3. Data model

`files` table (kind `note`) additions:

- `docJson: v.optional(v.string())` — canonical BlockNote document, JSON-stringified, versioned envelope `{ v: 1, blocks: [...] }`.
- `docFormat: v.optional(v.union(v.literal('markdown'), v.literal('blocknote')))` — which field is authoritative. Absent = legacy markdown.
- `content` stays = markdown projection (search, agents, exports, mobile read this).
- `updatedAt` remains the revision token for optimistic concurrency. `textInObjectStore`/`r2Key` flow also applies to `docJson` when large.

Envelope versioning (`v: 1`) lets us evolve the block schema without a schema migration flag day.

## 4. Conversion layer: `packages/overlay-note-doc`

New shared package owning all conversions, one place, tested:

- `markdownToDoc(markdown): DocJson` — preprocesses our legacy sanitized HTML (`<u>`, `<mark>`, alignment wrappers, embeds) into forms BlockNote parses to the right custom marks/blocks, then `tryParseMarkdownToBlocks`.
- `docToMarkdown(docJson): string` — `blocksToMarkdownLossy` plus serializers for our custom blocks (callout, toggle, math, embed) so exports stay readable.
- `migrateLegacy(content): { docJson, markdown }` — one entry point used by the editor on first open and by backfills.
- Headless `BlockNoteEditor.create()` for server-side use inside the Next API route (Node runtime), so agent writes convert server-side without a browser.

This package replaces `note-markdown` / `note-edits` as the canonical conversion surface; those stay for read compat until callers move.

## 5. Editor architecture

- `CanonicalNotebookEditor` swaps TipTap for `BlockNoteView` on `@blocknote/core` + `@blocknote/react`, styled with the shadcn style pack plus our CSS variables so it matches the app shell exactly.
- The existing `NotebookEditorController` (debounce, revision guard, 409) is kept and simplified: it now ships `{ docJson, markdown, expectedUpdatedAt }`.
- Schema: default BlockNote schema extended with custom specs:
  - Blocks: callout, toggle list, math block (KaTeX, we already ship katex), embed (YouTube + generic iframe allowlist), divider variants.
  - Inline content: `@mention` (files, agents, people) port of `tiptap-mention-suggestion`.
  - Styles: underline, colored highlight, text color, alignment as block props.
- Menus: default formatting toolbar and slash menu, customized item set and icons (Lucide). Side menu = drag handle plus block actions.
- Uploads: `uploadFile` adapter → existing files/object-store pipeline; images paste and drag-drop.
- Keyboard: full map (mod-b/i/e/strike, mod-shift-h highlight, mod-alt-1..3 headings, tab/shift-tab nest, cmd-enter on task items). Documented in a shortcuts hint.
- Agent-edit visuals: port or replace `InlineDiffExtension` as block-level diff marks (phase 3).

## 6. Save architecture (the un-jank)

- Editor doc is the client-side authority. No re-hydration after save.
- Autosave: 600ms debounce on change, trailing flush; also flush on blur, `visibilitychange` hidden, `pagehide` (sendBeacon), and note switch.
- Outbox: unsent doc persisted to localStorage keyed by `noteId` (plus `baseRevision`); on reload, pending edits restore and retry. This is what makes saving never feel lossy.
- Status pill replaces the manual Save button and `dirty` flag: Saved / Saving / Offline-retrying.
- Conflicts: keep `expectedUpdatedAt` 409 detection. New UX: non-blocking banner "Changed elsewhere" with [Reload] [Keep mine as a copy]. No modal, no data loss.
- Switching notes: flush pending save first, then swap. No `setContent` mid-session: editor instance is keyed by note id so state, undo history, and cursor are per-note.

## 7. Agent, API, and export compatibility

- `GET /api/v1/notes` returns markdown projection exactly as today. Agents see no change.
- Agent writes (markdown in): API route runs `markdownToDoc` headless, writes `docJson` + projected `content`, guarded by `expectedUpdatedAt`. Patch tools (`applyNoteEdits`) keep working on the markdown surface.
- Lossy edge (documented): an agent rewriting a note containing custom blocks sees them as their markdown approximation. Mitigations, in order of effort: (a) preserve unknown blocks by id when a patch only touches listed ranges, (b) structured `edit_blocks` tool operating on block ids (phase 3).
- ExportMenu: markdown export unchanged; add "Export .md" (projection) and keep JSON export available for backup.
- Mobile app: reads markdown projection; native editing unchanged. A BlockNote-based mobile editor is explicitly out of scope.

## 8. Migration

- Lazy per note: opening a `docFormat != 'blocknote'` note runs `migrateLegacy` client-side, shows one toast "upgraded", and writes docJson on next save. Read-only viewers just render the projection.
- Legacy inline HTML mapping is the migration-critical piece: `<u>` -> underline style, `<mark>` -> highlight style, align wrappers -> block props, embed markup -> embed block.
- Optional background backfill later via cron over `docFormat == 'markdown'` rows.
- Rollback story: every blocknote-format note always carries a fresh markdown projection, so exports, search, and agents never break.

## 9. Phases

1. **Foundation** — add deps; `overlay-note-doc` package with tests; schema fields (`docJson`, `docFormat`); repository/API `format` negotiation; BlockNoteView wired into `CanonicalNotebookEditor` behind `?editor=blocks` flag; autosave + outbox + status pill; lazy migration; theme pass. Result: jank gone.
2. **Editing depth** — custom blocks (callout, toggle, math, embed), mentions inline content, upload pipeline, keyboard map, slash-menu polish, table and code-block tuning, typography/aesthetic pass.
3. **Agent + polish** — server-side agent write path through `markdownToDoc`, block-aware edit tool or `edit_blocks`, agent diff marks, comments/anchors groundwork via block ids, version history on `updatedAt`.
4. **Later** — real-time collab (Yjs over Convex presence), publish/share doc rendering, templates, mobile editing.

## 10. Risks and notes

- Bundle: BlockNote is heavy (~600KB+). Notes editor is already dynamic-imported; keep it that way, plus `next/dynamic` for math/katex.
- License: core is MPL-2.0 (fine commercially). `xl-*` packages are GPL/commercial — avoid; we do not need them for this spec.
- JSON doc is a new canonical format: keep it versioned, keep markdown projection always fresh, and markdown export always one click away so nothing is ever trapped.
- `migrateMathStrings`-style per-keystroke mutations do not get ported. If we keep inline math migration it runs once at load, never in `onUpdate`.

## 11. Open questions for owner

1. Phase 3 real-time collab: worth planning for now (block ids are free) or later?
2. Agent edits: acceptable short-term that agents edit the markdown projection (custom blocks degrade in agent-rewritten notes), or prioritize `edit_blocks` earlier?
3. Any non-negotiable blocks beyond callout/toggle/math/embed/mention? (e.g. audio, drawings/Excalidraw embed, databases/tables-as-data)
