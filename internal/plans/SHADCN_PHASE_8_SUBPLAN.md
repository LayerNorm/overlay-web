# Phase 8 subplan: ad-hoc markup sweep

Status: implementation complete through the staged 8.12 guardrail. Last audited
2026-10-15; implementation status updated during the Phase 8 PR rollout.

Implementation status:

- 8.1-8.4: #234, #235, #236, #237; authenticated preview QA passed.
- 8.5-8.8: #240, #241, #242, #243, #244, #245; authenticated preview QA
  passed on every slice, including #242 once its preview served.
- 8.9-8.11: #249, #250, #251, #252, #253; authenticated preview QA passed
  on every slice.
- Preview builds were unblocked by #255 (turbopackFileSystemCacheForBuild
  opt-out plus next 16.4.2), which fixes the Basic build container OOM
  introduced by the Next.js 16.4 upgrade in #248.
- 8.12: #254; staged guardrail: ESLint warns on raw interactive controls while
  npm run check:raw-controls hard-fails any control outside the committed
  baseline. Once the sweep PRs merge, remove the baseline debt and promote the
  ESLint warning to an error for the final zero-count policy.

## Goal

Replace raw interactive markup in app surfaces with the migrated `@overlay/ui`
primitives without changing product behavior, layout, or visual treatment.
Finish by adding guardrails so new raw controls do not re-enter the codebase.

This phase is about consistency in the ad-hoc layer. It is not a redesign and
it should not normalize spacing, labels, icons, validation, or copy unless a
primitive requires a mechanical equivalent.

## Current inventory

Counts cover production `.tsx` files, excluding `*.test.tsx` and
`*.stories.tsx` except where noted.

| Scope | Production files | Raw button | Raw input | Raw textarea | Raw select | `fixed inset-0` |
|---|---:|---:|---:|---:|---:|---:|
| `src/features/chat` | 18 | 72 | 5 | 1 | 1 | 0 |
| `packages/overlay-chat-react` | 26 | 65 | 5 | 2 | 0 | 0 |
| `src/features/settings` | 12 | 43 | 10 | 2 | 1 | 0 |
| `src/features/workspaces` | 8 | 18 | 2 | 0 | 0 | 0 |
| `src/features/agents` | 8 | 21 | 5 | 2 | 0 | 0 |
| `src/features/account` | 2 | 17 | 1 | 1 | 0 | 1 |
| `src/features/integrations` | 2 | 4 | 1 | 0 | 0 | 1 |
| `src/features/knowledge` | 1 | 10 | 0 | 1 | 0 | 0 |
| `src/features/work` | 9 | 13 | 8 | 2 | 0 | 0 |
| `src/features/files` | 3 | 9 | 0 | 0 | 0 | 0 |
| `src/features/share` | 1 | 6 | 0 | 0 | 0 | 0 |
| `src/features/admin` | 2 | 16 | 6 | 2 | 0 | 0 |
| `src/features/auth` | 3 | 5 | 1 | 0 | 0 | 0 |
| `src/features/automations` | 2 | 2 | 0 | 0 | 0 | 0 |
| `src/features/notebook` | 1 | 2 | 0 | 0 | 0 | 0 |
| `src/features/showcase` | 1 | 2 | 0 | 0 | 0 | 0 |
| `src/components` | 11 | 36 | 1 | 0 | 0 | 0 |
| `src/features/marketing` | 11 | 23 | 3 | 0 | 0 | 0 |
| `src/app` | 11 | 20 | 13 | 0 | 0 | 0 |
| `packages/overlay-modules-react` | 31 | 114 | 25 | 7 | 0 | 0 |

## Conversion rules

1. Preserve the rendered DOM contract: text, accessible name, `type`, `title`,
   `aria-*`, `disabled`, focus behavior, keyboard shortcuts, form association,
   and event ordering.
2. Move existing Tailwind classes into the primitive `className`; do not
   rewrite token values or simplify styles during the sweep.
3. Prefer the smallest primitive that preserves behavior:
   - `<button>` → `Button` or `IconButton`
   - text-like `<input>` → `Input`
   - `<textarea>` → `Textarea`
   - `<select>` → migrated `Select` only when the interaction is equivalent
   - checkbox inputs → `Checkbox`
   - switches/toggles → `Switch`
   - modal `fixed inset-0` shells → `Dialog` or `AlertDialog`
   - side panels → `Sheet`
   - inline notices → `Alert`
   - notices/toasts → `toast`
   - initials/people badges → `Avatar`
   - tab bars → `Tabs`
   - scroll containers → `ScrollArea`
   - meter bars → `Progress`
   - generic bordered panels → `Card` only when the existing shape already is a card
4. Leave a raw element in place when replacing it would change semantics or
   require a custom wrapper: file inputs, color/range inputs, canvas or rich
   text internals, native form controls intentionally used for browser
   autofill, and elements inside `@overlay/ui` itself.
5. Keep tests working by preserving accessible names and roles. Update tests
   only when the primitive intentionally changes a selector or emitted event.
6. Do not widen a PR to fix unrelated styling, copy, dead code, or behavior.
   Note follow-ups separately.

## PR sequence

Land these in order after #232 merges. Each PR should stay independently
reviewable and include a short before/after inventory in its body.

### 8.1 `src/features/chat`

Largest app surface: 18 production files, 72 raw buttons, 5 inputs, 1 textarea,
1 select.

- Convert composer, activity, inline panels, collaboration rows, dialogs, and
  slash/automation controls.
- QA: authenticated `/app/chat`; compose, attach, send/cancel, edit, reply,
  open dialogs, keyboard activation, mobile.

### 8.2 `packages/overlay-chat-react`

26 production files, 65 raw buttons, 5 inputs, 2 textareas.

- Convert composer/header/pickers, transcript and exchange actions, modal and
  panel controls.
- Split into two PRs if the diff exceeds roughly 800 changed lines or mixes
  unrelated surfaces.
- QA: `/app/chat` plus a real conversation transcript; verify message actions,
  model picker, draft review, panels, keyboard focus, mobile.

### 8.3 `src/features/settings`

12 production files, 43 raw buttons, 10 inputs, 2 textareas, 1 select.

- Convert provider, webhook, model catalog, shortcut, computer, connected app,
  and archived-item controls.
- QA: `/app/settings`; provider dialog, copy fields, toggles, destructive
  actions, validation states, keyboard navigation.

### 8.4 `src/features/workspaces`

8 production files, 18 raw buttons, 2 inputs.

- Convert workspace naming, switcher, usage, import, Slack import, and boundary
  controls.
- QA: workspace switcher and settings surfaces; create/rename flows where the
  preview fixture permits, import dismissal/retry states.

### 8.5 `src/features/agents`

8 production files, 21 raw buttons, 5 inputs, 2 textareas.

- Convert editor, avatar/color pickers, cloud config, workspace, and dialog
  controls.
- QA: `/app/agents`, `/app/agents/new`, agent editor; form validation, color
  and avatar picking, save/cancel, mobile.

### 8.6 `src/features/account` and `src/features/integrations`

Keep the original one-PR-per-feature split unless the combined diff stays small.

- Account: 2 files, 17 buttons, 1 input, 1 textarea, 1 `fixed inset-0` tour
  surface. Replace the overlay only if `Dialog` preserves the tour's focus,
  dismissal, and positioning semantics.
- Integrations: 2 files, 4 buttons, 1 input, 1 `fixed inset-0` dialog surface.
- QA: `/app/account`, `/app/integrations`; onboarding/tour dismissal and
  integration dialog focus/Escape/outside-click behavior.

### 8.7 `src/features/knowledge` and `src/features/work`

Keep these as separate PRs because both have dense interactive rows.

- Knowledge: 1 file, 10 buttons, 1 textarea.
- Work: 9 files, 13 buttons, 8 inputs, 2 textareas.
- QA: `/app/memories`, `/app/work`; row actions, filters, forms, dismissals,
  keyboard activation.

### 8.8 Small feature dirs

Batch only if the resulting PR remains small:

- `files` + `share`: 15 buttons across 4 files.
- `admin` + `auth`: 21 buttons, 7 inputs, 2 textareas across 5 files.
- `automations` + `notebook` + `showcase`: 6 buttons across 4 files.
- Remaining `src/app` route components: 20 buttons, 13 inputs across 11 files,
  mostly auth and error states.

QA: `/app/files`, `/app/admin`, `/app/automations`, `/app/notes`,
`/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password`, and reset/error
states where reachable.

### 8.9 `src/components` chrome

11 production files, 36 raw buttons, 1 input.

- Convert sidebar chrome, account menu, scope actions, mention popup, share
  dialog, onboarding provider, and feedback controls.
- QA: sidebar interactions, workspace/account menus, share dialog, mentions,
  archive toast, mobile drawer.

### 8.10 `src/features/marketing`

11 production files, 23 raw buttons, 3 inputs, zero `@overlay/ui` imports.

- This is the largest bespoke island and should land after app primitives have
  proven the patterns.
- Preserve marketing-specific button/nav treatment; do not force app chrome
  styles where a local component intentionally owns the look.
- QA: `/`, `/pricing`, landing navigation, pricing controls, mobile nav,
  light/dark surfaces.

### 8.11 `packages/overlay-modules-react`

31 production files, 114 raw buttons, 25 inputs, 7 textareas. Split by module
rather than landing one monolithic package PR:

1. `automations` + `extensions`: 36 buttons, 20 inputs, 2 textareas.
2. `knowledge`: 45 buttons, 4 inputs, 3 textareas.
3. `notes` + `settings` + shell/fixtures: 33 buttons, 1 input, 2 textareas.

QA: `/app/automations`, `/app/tools`, `/app/integrations`, `/app/files`,
`/app/settings?section=memories`, `/app/notes`, relevant settings sections.
Verify editors, dialogs, toolbar menus, file viewing, list actions, and forms.

### 8.12 Guardrails

Land only after the sweeps are complete.

- AGENTS.md now requires @overlay/ui primitives for new interactive controls,
  with documented browser-semantics exceptions.
- ESLint no-restricted-syntax warns on raw button, input, textarea, and select
  JSX elements in production app/package paths while the in-flight Phase 8 PRs
  are still open.
- npm run check:raw-controls hard-fails any raw control outside
  scripts/ci/raw-control-baseline.json, so new controls are blocked during
  the rollout without breaking on the already-open sweep PRs.
- *.test.tsx, *.stories.tsx, fixture directories, packages/overlay-ui
  internals, semantic file/range/color/hidden inputs, and explicitly annotated
  browser-semantics cases are exempt.
- After the sweep PRs merge, clear the baseline and promote the ESLint warning
  to an error for the final zero-count policy.
## Required checks per PR

Run the smallest check covering the changed surface, plus the standard gates:

- `npx tsc --noEmit`
- `npm --prefix packages/overlay-ui run typecheck`
- `npm --prefix packages/overlay-ui run test`
- targeted ESLint on changed TS/TSX files
- `npm run check:module-boundaries`
- `npm run check:shared-isomorphic`
- `npm run docs:health`
- `git diff --check`

For package-only PRs, add that package's typecheck/test command when present.
For app markup PRs, request `needs-preview` and record the exact deployment,
head SHA, routes, actions, screenshots, and fixture limitations in the PR body.

## Acceptance

- No visual regression on touched surfaces.
- No changed form semantics: submit, validation, disabled, autofocus, labels,
  names, and ids remain equivalent.
- Keyboard and pointer activation still work, including Enter/Space, Escape,
  outside dismissal, focus trap, and focus return where applicable.
- Screen-reader names and roles are preserved or improved.
- The PR body lists remaining raw elements in scope and why they stayed raw.
- The final guardrail PR reports a zero-count policy violation for the covered
  production paths.
