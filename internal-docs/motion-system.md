# Motion system

A consistent, web-native motion language for overlays and transient surfaces.

## Principles

- **Panels slide.** Right-side panels (and the desktop sidebar) reveal/hide by
  sliding — translate on mobile overlays, width collapse/expand on desktop —
  matching `AppSidebar`.
- **Everything else fades.** Dialogs, popovers, menus, dropdowns and lightboxes
  fade in/out (dialogs add a subtle scale; menus add a small pop).
- **Shared easing.** All motion uses `--overlay-ease: cubic-bezier(0.16, 1, 0.3, 1)`
  — the same curve the sidebar reveal already used.
- **Respects reduced motion.** Keyframe utilities collapse to ~0ms under
  `prefers-reduced-motion: reduce`.

## Foundation

### Tokens & keyframe utilities — `src/app/globals.css`
- Added tokens: `--overlay-ease`, `--overlay-duration-fast` (150ms),
  `--overlay-duration` (220ms), `--overlay-duration-panel` (300ms).
- Added enter-only utility classes (for fire-and-forget surfaces whose
  open/close is driven by parent mount/unmount):
  - `.overlay-fade-in` — plain fade (direction-agnostic popovers/menus).
  - `.overlay-pop-in` — fade + small scale/translate from top (downward menus).
  - `.overlay-dialog-in` — fade + scale for centered dialogs.
  - `.overlay-backdrop-in` — backdrop fade for those dialogs.
  - All disabled under `prefers-reduced-motion: reduce`.

### `usePresence` hook — `packages/overlay-ui/src/hooks/usePresence.ts` (new)
Keeps an element mounted through its exit transition. Returns `{ mounted, visible }`;
consumers render while `mounted` and drive transition classes off `visible`.
Used by surfaces that need a real enter **and** exit animation. Exported via
`packages/overlay-ui/src/hooks.ts`, `src/index.ts`, and the `./hooks` package export.

## Panels (slide)

| Surface | File | Change |
| --- | --- | --- |
| Shell right panel (notes assistant, chat sources/attachment panel, etc.) | `packages/overlay-modules-react/src/shell.tsx` | `AppScreenShell` now slides its right panel: translate-in on mobile + width reveal on desktop (matching the sidebar), with a fading backdrop. Uses `usePresence` to stay mounted while closing and caches the last panel content so it slides out cleanly. |
| Chat sources panel (inline variant) | `packages/overlay-chat-react/src/components/SourcesPanel.tsx` | Width transition aligned to the sidebar: `transition-[width,opacity,border-color] duration-300 ease-[var(--overlay-ease)]` + opacity fade. |

## Dialogs (fade + scale, full enter/exit via `usePresence`)

| Surface | File |
| --- | --- |
| Shared `DialogFrame` primitive | `packages/overlay-ui/src/components/primitives/Dialog.tsx` |
| Shared `ConfirmDialog` primitive | `packages/overlay-ui/src/components/overlays/ConfirmDialog.tsx` |
| Global search (Cmd+K) | `src/components/layout/GlobalSearchDialog.tsx` |
| Share dialog | `src/features/share/components/ShareDialog.tsx` |
| Integrations dialog | `src/features/integrations/components/IntegrationsDialog.tsx` |
| Draft review modal (bottom-sheet on mobile, slides up; fades+scales on desktop) | `packages/overlay-chat-react/src/components/DraftReviewModal.tsx` |
| Delete-account confirmation | `src/features/account/components/DeleteAccountSection.tsx` |

## Dialogs / viewers (entrance animation via CSS classes)

These are mounted/unmounted by their parents, so they animate on enter
(`overlay-backdrop-in` + `overlay-dialog-in`); exit is immediate.

| Surface | File |
| --- | --- |
| Chat image/document viewer (`AttachmentPreviewDialog`) | `src/features/chat/components/ChatExperience.tsx` |
| Add memory / Import memory / Create knowledge item / Memory detail | `packages/overlay-modules-react/src/knowledge/dialogs.tsx` |
| Skill dialog (extensions) | `packages/overlay-modules-react/src/extensions/skills.tsx` |
| MCP server dialog (extensions) | `packages/overlay-modules-react/src/extensions/mcp.tsx` |

## Popovers / menus / dropdowns (fade / pop)

Downward menus use `overlay-pop-in`; upward menus use `overlay-fade-in`.

| Surface | File |
| --- | --- |
| Model picker + Act model picker | `src/features/chat/components/ChatExperience.tsx` |
| Video sub-mode picker | `src/features/chat/components/ChatExperience.tsx` |
| Composer overflow menu (opens up → fade) | `src/features/chat/components/ChatComposer.tsx` |
| Export menu | `src/features/files/components/ExportMenu.tsx` |
| File share menu | `src/features/files/components/FileShareMenu.tsx` |
| Mention `@` autocomplete popup | `src/components/mentions/MentionPopup.tsx` |
| Sidebar account menu (opens up → fade) | `src/components/layout/AppSidebar.tsx` |
| Sidebar mobile account menu | `src/components/layout/AppSidebar.tsx` |
| Notebook header menu | `src/features/notebook/components/NotebookEditor.tsx` |
| Knowledge toolbar menus (3) | `src/features/knowledge/components/KnowledgeToolbarMenus.tsx` |
| Generation mode toggle dropdown | `packages/overlay-ui/src/components/chat/GenerationModeToggle.tsx` |
| Project hub menus (2) | `packages/overlay-modules-react/src/projects/hub.tsx` |
| Project sidebar-frame menu | `packages/overlay-modules-react/src/projects/sidebar-frame.tsx` |
| Comprehensive model picker | `packages/overlay-chat-react/src/components/ComprehensiveModelPicker.tsx` |
| Dropdown select | `packages/overlay-chat-react/src/components/DropdownSelect.tsx` |

## Already animated (left as-is)

- `SignInFullScreenModal` / `SignInCornerPopover` — already fade/scale via inline styles.
- `OnboardingTour` — backdrop already fades; dialogs unchanged.
