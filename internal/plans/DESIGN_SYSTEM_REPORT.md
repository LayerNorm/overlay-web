# Design system report: why some buttons are black and some gray

## Short answer

- **shadcn theming is the system you want.** Every component reads a small set of CSS variables (`--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`, plus `--sidebar-*`). Each component has a fixed list of variants that only use those variables. Change a variable once and every component follows.
- **Typeset is not that system.** It is one CSS file that styles rendered HTML and Markdown (headings, paragraphs, lists, tables inside a `.typeset` container). It fits our chat messages, notes and docs, not buttons or menus. Worth adopting later for message and note prose.

## What we have today

| Area | Today | shadcn equivalent |
| --- | --- | --- |
| Color tokens | `--foreground`, `--background`, `--muted`, `--muted-light`, `--surface-subtle`, `--surface-elevated`, `--border`, `--accent` | Close, but no `--primary`, `--secondary`, `--destructive`, `--ring`, `--input`; names differ |
| Button variants | `primary` (solid black), `secondary` (bordered gray), `ghost`, `danger` | `default`, `secondary`, `outline`, `ghost`, `destructive`, `link` |
| Button usage | 482 ghost, 43 primary, 39 secondary, plus 7 one-off variants (`metal`, `muted`, `warning`...) | |
| Hand styling | 379 `unstyledButton(...)` overrides that replace the variant's look, 59 hard-coded hex colors | Should be near zero |
| Shadows | `shadow-md`, `-lg`, `-xl`, `-2xl` and 3 custom shadows used interchangeably | One shadow per surface type |
| Motion | `duration-200` and `duration-300` mixed, plus `animate-in/out` | One duration and easing |

**Why buttons look inconsistent:** "New task" uses `primary` (solid black). "New Skill" is a `ghost` button restyled by hand to look like a gray bordered button. Other pages restyle `ghost` in their own way. The variant names exist, but most call sites override them, so the same action looks different from page to page.

## Proposed rules

1. **Buttons**
   - `primary` (solid): at most one per page, for the page's main create action (New task, New skill, New agent). Same size everywhere (`sm` in headers).
   - `secondary` (bordered gray): other header actions.
   - `ghost`: icon buttons, row actions, menus.
   - `danger`: only inside confirm dialogs.
   - No `className` that changes color, border or background on a `Button`. Size and layout only.
2. **Colors:** add shadcn token names as aliases of ours (`--primary: var(--foreground)`, `--secondary: var(--surface-subtle)`, `--ring`, `--input`, `--destructive`) so shadcn components drop in unchanged. No hex colors in components.
3. **Radius:** one `--radius` (8px). Buttons and inputs `rounded-md`, menus and cards `rounded-lg`, dialogs `rounded-xl`.
4. **Shadows:** none on in-page surfaces; `shadow-md` for menus, popovers and tooltips; `shadow-lg` for dialogs and sheets.
5. **Motion:** 150ms ease-out for hover and color, 200ms for menus and panels. Spinners only for actions over about 300ms.
6. **Headers:** title and count, then search, then actions, then tabs, then the "..." menu last. (Done in this PR.)
7. **Guardrail:** extend `check:raw-controls` to flag color classes passed to `Button`, so new overrides fail CI.

## Suggested rollout

1. Add the token aliases and the `outline` variant (no visual change).
2. Replace the hand-styled header buttons (Skills, MCPs, Files, Agents, Automations) with `primary` or `secondary`.
3. Sweep the remaining `unstyledButton` overrides page by page, then turn on the guardrail.
4. Later: adopt Typeset for chat message and note prose.

Each step can be its own PR with a preview.
