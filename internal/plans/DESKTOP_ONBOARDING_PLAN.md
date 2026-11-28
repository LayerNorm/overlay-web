# Desktop onboarding: setting Overlay up on this computer

Status: Phases 1–3 merged (PR 638) and live on overlay.works since 2026-11-27 (`434a46f`); the desktop side shipped in
Overlay Desktop 0.6.0. Settings → Import and Phase 4's local MCP servers are built on branch
`codex/desktop-local-mcp-import` (draft PR, not merged); they reach the app only after an Agent Host release and a desktop
pin bump. Phase 4's Claude and ChatGPT plans are separate work (private threads Phase 4). Not yet accepted in the released
app by a real new account. Mockup: `internal/plans/mockups/desktop-onboarding.html`.

Related: `internal/plans/LOCAL_PRIVATE_THREADS_PLAN.md` (private threads, model keys, free tier),
`internal/develop/private-threads.md`, `internal/develop/local-computer.md`,
`internal/develop/desktop-web-shell.md`, `internal/develop/mcp-access.md`.

## Problem

A person who downloads Overlay Desktop and signs in for the first time lands in an empty
workspace. The web onboarding (a conversation with Overlay that asks about them, suggests
agents and a first task) still runs, but it knows nothing about the computer it is running
on. The desktop app can do three things the website cannot:

- **See the AI tools already on this computer.** Claude Code, Codex, Claude Desktop, Cursor
  and Gemini CLI keep instructions, skills, subagents and MCP servers in known files. Most
  people we want already use at least one of them.
- **Set up this computer.** Connect it, pick folders, grant screen permissions, and choose
  how private threads call a model (the person's own key now, their Claude or ChatGPT plan
  later).
- **Run for free.** Private threads on this computer are the free tier. The web flow only
  offers the paid plan.

Competitors' coding-agent onboarding (workspace, profile, subscriptions, GitHub, extras, plan)
is a useful shape, but Overlay is for knowledge work. Here, importing context matters more than
repositories, and the first task should be a piece of work, not a pull request.

## Who sees it

Desktop only, right after sign-in, and only for a **new account**:

- the only workspace the person belongs to is the one created for them automatically
  (`ensurePersonalWorkspace`) when they first loaded their workspaces;
- that workspace's onboarding is not completed; and
- they have no pending invitation to another workspace.

Everyone else goes straight into the app, exactly as today. The server decides this:
`GET /api/v1/onboarding/session` returns `desktopSetup: true` only while setup has not started and the person's only
workspace is their own personal one, so a second device or a reinstall never shows it once the conversation began.

*Built differently from the first draft:* the pending-invitation screen is deferred. Invited people accept their
invitation from the email link, which already gives them a second workspace, so they skip setup.

## The flow

Six short screens, then the existing Overlay conversation takes over. Every screen after the
first can be skipped. Progress is kept in this computer's local storage, so quitting resumes on the
same screen (the onboarding session only exists once the conversation starts).

1. **Who is this workspace for?** *Just me* or *My team* (with a workspace name). It sets the
   workspace's name and kind and answers the conversation's `team` question. My team leads to
   the paid plan in step 6, because team workspaces are paid-only.
2. **About you.** Name and photo, filled in from the account, plus what kind of work they do,
   picked from chips with a free-text option. This answers the conversation's `name` and
   `about` questions.
3. **Bring your setup (desktop only).** Overlay lists what it found on this computer, grouped
   by app, and imports only what the person ticks. Details are below.
4. **How private threads think.** For threads that stay on this computer:
   - Overlay offers model keys it finds in the login shell's environment (`ANTHROPIC_API_KEY`,
     `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`) with *Use this key*. The key is
     checked with the provider, then kept in the system keychain, the same way as in Settings →
     Model keys.
   - Otherwise the person can add a key, or use Overlay's models with a plan.
   - *Signed in to Claude Code* and *Signed in to Codex* appear marked "Coming soon". They are
     Phase 4 of the private threads plan.
5. **This computer.**
   - Connect it (the existing enrollment; the free tier allows one computer).
   - Choose folders: `~/Overlay Files` is always included, and more can be added with the system
     folder dialog.
   - Optionally turn on Screen Recording and Accessibility for the screen tools.
   - Keep the computer available while the app is closed.
6. **Pick a plan.** Free (private threads on this computer with your own keys, 100 MB of
   storage, 50 web searches a month) or Overlay ($8 a month, including $8 of usage credit). A
   team workspace shows only the paid plan. Paying uses the existing checkout.

After step 6 the window opens the workspace, and the existing Overlay conversation continues
from `daily`:

- The name, about and team answers are already in place.
- Instructions imported in step 3 show up in the conversation's `memories` step to review.
- Apps (Gmail, Calendar, Slack, Notion, GitHub) stay in the conversation's `connections` step.
  They are paid tools, so the step shows them after the plan is chosen.

## Bring your setup

The scan reads only known paths and never changes them. It runs in the desktop main process
and sends the page names and counts only, never the contents or secret values. When the person
imports, the main process reads the ticked items again and sends them to Overlay with the app's
own session. Contents never pass through the page.

| Found on this computer | Paths (macOS; Windows and Linux equivalents in the scanner) | Becomes in Overlay |
| --- | --- | --- |
| Instructions | `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md` | Memories, extracted into facts and reviewed in the conversation's memories step |
| Skills | `~/.claude/skills/*/SKILL.md`, `~/.codex/skills/*/SKILL.md` | Personal skills (name and description from the front matter) |
| Subagents | `~/.claude/agents/*.md` | Creator-only agents with creature avatars; the model maps to the closest Overlay model, and tools start from the default groups |
| Remote MCP servers | `mcpServers` with a `url` in `~/.claude.json`, Claude Desktop's `claude_desktop_config.json`, `~/.cursor/mcp.json`, `~/.gemini/settings.json`; `[mcp_servers]` in `~/.codex/config.toml` | Personal MCP servers. A header token is copied only if ticked; OAuth servers ask the person to sign in again |
| Local MCP servers | the same files, entries with a `command` | MCP servers on this computer, for private threads (command, arguments and folder in the app's data folder, environment values in the keychain); never sent to the workspace. Apps whose bundled host can't run them still show *Coming later* |
| Model access | Claude Code and Codex sign-ins, shell environment keys | Step 4 |

Not imported: session history, project-level settings inside repositories, and any secret the
person did not tick. Settings → Import (desktop only) runs the same scan again later.

## How it is built

- **Desktop (`overlay-desktop`):**
  - `local-setup-service.ts` holds one scanner per app, behind a new `localSetup` bridge
    capability with `localSetup.scan` (names and counts) and `localSetup.import({ ids })`
    (reads and sends).
  - Environment keys come from the login shell (`$SHELL -ilc env`) and are checked with the
    provider before they go to the keychain.
  - The capability is advertised only when the scanner exists, so older apps skip step 3.
- **Bridge protocol:** zod schemas for the scan result and the import request, in the shared
  desktop bridge package.
- **Web:**
  - `DesktopOnboarding` renders inside `OnboardingShell` when the desktop bridge is present
    and `desktopSetup` is `show`.
  - It uses `@overlay/ui` primitives and production tokens, and reuses `useThisComputer`, the
    model-keys bridge calls and `OnboardingPayment`'s checkout.
- **Server:**
  - `GET /api/v1/onboarding/session` returns `desktopSetup`, and `start` accepts a `prefill` with the `name`,
    `about` and `team` answers from the desktop flow, so the conversation starts at `daily`.
  - Import uses the existing create endpoints for skills, agents, MCP servers and memories,
    called by the desktop main process with idempotency keys so a retry never duplicates.
- **Analytics:** each screen's views and completions, and import counts by kind. No names or
  contents.

## Phases

| Phase | Scope | State |
| --- | --- | --- |
| 0: Mockup and decisions | This plan and `mockups/desktop-onboarding.html` | Done: mockup approved 2026-11-26 |
| 1: Gate and core screens | `desktopSetup` status, screens 1, 2 and 6, handoff to the conversation at `daily` | Released (web 2026-11-27, Desktop 0.6.0); not accepted |
| 2: This computer and models | Screens 4 and 5 with existing enrollment and key storage; environment keys | Released (Desktop 0.6.0); not accepted |
| 3: Bring your setup | Scanners, `localSetup` bridge, import of instructions, skills, subagents and remote MCP servers; Settings → Import | Released (Desktop 0.6.0) except Settings → Import, which is built in a draft PR (`codex/desktop-local-mcp-import`) with a per-workspace import record so importing again adds nothing twice; not merged, not accepted |
| 4: Local servers and subscriptions | Local (command) MCP servers in private threads through the Agent Host; Claude and ChatGPT plans (private threads Phase 4) | Local MCP servers built in the same draft PR: the `localMcp` bridge capability, Settings → Desktop → MCP servers on this computer, import from setup and Settings → Import, and the host's stdio pool (unit-tested with a fixture server). Not merged; needs an Agent Host release and desktop pin bump to reach the app; not tested in a running desktop app. Plans: separate work, not started here |

## Acceptance

- New account on desktop: the flow shows. An account with any other workspace, or a completed
  onboarding, goes straight to the app. A pending invitation shows the join screen.
- Quitting on any screen and reopening resumes there. Every skip leaves a working workspace.
- The scan never sends file contents or secret values to the page (checked by a bridge test
  and by recording the renderer's traffic during QA, as in private threads QA).
- Import creates exactly the ticked items once, even when retried.
- Free and paid paths both end in the conversation at `daily`, with the earlier answers in
  place.
- Rendered in light and dark, at desktop size and the minimum window size.

## Open questions

1. Should imported instructions become memories (searchable facts), or one agent instruction
   block for the person's Chief? The plan says memories, reviewed in the conversation.
2. Do subagents become agents, or skills? They read like agents, but most are narrow coding
   helpers.
3. Should *My team* on the free tier be blocked, or allowed as a team of one until a second
   person joins?
