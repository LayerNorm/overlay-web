# Mockup reference rules

New mockups always go in this folder, without asking. Use the gitignored root
`artifacts/` folder only when the owner explicitly asks for it.

## The canonical app mockup

[overlay-app.html](overlay-app.html) is the whole web app in one file. It is not
a redrawing: [overlay-app/](overlay-app/) bundles the real production provider
tree, `AppShellSidebar`, the curved/framed main surface, the right details panel
and every route page, and replaces only the backend. Convex queries and the
app's own `/api` routes answer from fixtures in `overlay-app/fixtures/`, so the
file opens straight from disk with sample data and makes no network requests.

Open it and use the app's own navigation. Every surface is reachable:

- Work: list, board, timeline, organization and the task detail panel.
- Agents: agent threads with tool, reasoning and PR rows, the right panel
  (Details, Library, Computer), and the agent editor (`#/app/agents/new`).
- Chats: personal AI chats, workspace chats, channels and direct messages.
- Activity, Notes (with the editor), Files, Automations, Extensions/Connectors.
- Account and every Settings section (`#/app/settings?section=memories` and so on).

The app path lives in the hash, for example
`overlay-app.html#/w/northwind/workspace/work?view=board`. Add `?theme=dark`
before the hash for dark mode, or use the app's theme toggle. Narrow windows get
the production mobile drawer.

### Making a feature mockup

Start from the canonical mockup instead of drawing the shell. Either change the
production component on a branch and rebuild, or add the proposed component to
`overlay-app/routes.tsx` and the data it needs to `overlay-app/fixtures/`. Only
change the feature being proposed; navigation, sidebar, breadcrumbs, framing,
spacing, typography and light/dark tokens come from production and must stay
untouched. Compare desktop and narrow layouts in both themes before sharing.

### Feature mockups that need to sit inside production components

When the proposal belongs inside a production component (a composer row, a transcript row, a details row), put it
in `overlay-app/features/<name>/`. Its `feature.mjs` names the output file and lists exact text patches that place
the proposed components into production modules at bundle time; production files are not edited, and a patch whose
text no longer appears exactly once stops the build. Build it with
`MOCKUP_FEATURE=<name> node internal/plans/mockups/overlay-app/build.mjs`.

### Rebuild

```sh
node internal/plans/mockups/overlay-app/build.mjs
```

Rebuild after production UI changes so the mockup keeps matching the app.
`MOCKUP_MINIFY=0` keeps the output readable and `MOCKUP_DEV=1` uses React's
development build for readable errors. A query or route without a fixture logs
`[mockup] no fixture for …` in the browser console; add it to `fixtures/`.

How it works: `build.mjs` bundles `entry.tsx` with esbuild, compiles
`src/app/globals.css` with Tailwind, and inlines public assets as data URLs.
`shims/` stand in for `next/navigation`, `next/link`, `next/dynamic`,
`next/image` and `convex/react`, keep the app URL in the hash, and redirect
direct `window.location` reads to it.

Production components and styles are the source of truth; the fixture data and
simulated mutations are not a production contract.

## What else lives here

Mockups for shipped features are deleted once they land; Git history keeps
them. Besides the canonical app mockup, this folder holds only:

- `paid-first.html` (built by `build-paid-first.mjs`): the approved onboarding
  design for the in-progress `PAID_FIRST_EXECUTION_PLAN.md`. Delete it when
  that plan completes.
- `extensions-catalog.html` (built by `build-chat-and-extensions-mockups.cjs
  extensions-catalog`): the approved Extensions catalog design that
  `ExtensionCatalogPage` implements. Delete it once the redesign is accepted
  in production.
- `local-cloud-continuity.html` (feature `local-cloud-continuity`): the proposed Phases 2–4 of
  `LOCAL_CLOUD_CONTINUITY_PLAN.md`. Open
  `local-cloud-continuity.html#/w/northwind/personal/agents?agent=agent_atlas&id=k17convatlastable000000000000000`
  (handoff) or `...&id=k17convatlascheckout000000000000` (delegation). Delete it when those phases ship.
- `files-on-computers.html` (feature `files-on-computers`): the proposed folders-as-sources design. Folders from
  Overlay, GitHub, Google Drive and several Macs in Files, a per-thread computer picker (the cloud computer plus each
  Mac with the desktop app, with online and offline states) and folder picker under the composer,
  where each change went back to in the transcript, and the agent's Files row in Details. The bar at the top switches
  between the web and desktop app (`?host=web` opens the web app). Open
  `files-on-computers.html#/w/northwind/personal/agents?agent=agent_atlas&id=k17convatlaslaunch00000000000000`, or
  `id=k17convatlasiosshare000000000000` for a thread running on the Mac Studio.
  `files-on-computers-architecture.html` is the matching architecture diagram (WebDAV over the file service, the
  rclone mount at `/overlay` and the `/workspace` copy). Delete both when the design ships.
- `chief-assignments.html` (feature `chief-assignments`): the proposed Chief assignment design. The assignment box
  sits inside the response that made it, as wide as the response text. Agent threads, chats and channels share one
  right sidebar opened by one button: views open as tabs, and "+" opens a new tab listing what the conversation has
  (Details, Assignments, Library and Computer for an agent; Assignments, People and Pinned in a chat or channel). An
  agent's sidebar opens on its avatar and that list; opening a view replaces both with the tab. A delegated agent that cannot run is one failed assignment with its reason, and the Chief carries on. The bar at the top switches between an agent
  thread, a channel and a chat, and between the app today (`?mode=today`) and the proposal; "What changes" lists the
  changes and the error messages before and after. Delete it when the design ships.
- `slack-integration.html` (feature `slack-integration`): the proposed Slack integration from
  `internal/plans/SLACK_WORKSPACE_OVERLAY_PLAN.md`. Settings → Connected apps lists GitHub, Slack and MCP, each opening its own page
  (`slack-integration.html#/app/settings?section=connected-apps`, then `&app=slack`), and threads started in Slack show under Overlay with
  a Slack mark, the channel and Open in Slack in the header, Slack participants by name, and where replies go
  (`slack-integration.html#/w/northwind/workspace/agents?agent=agent_overlay&id=k17convslackgrowth00000000000000`).
  Delete it when the design ships.
- `desktop-discovery.html`: how a visitor finds and downloads the desktop app. It is the live marketing page with
  the proposed changes applied, not an app-shell mockup: `node internal/plans/mockups/build-desktop-discovery.mjs`
  reads the production home page and inlines it. The bar at the bottom switches page and visitor and outlines what
  is new. Plan: `internal/plans/DESKTOP_DISCOVERY_AND_DOWNLOAD_PLAN.md`.
- `local-and-cloud.html` (feature `local-and-cloud`): the Local and Cloud design, kept as the reference and for
  visual QA. It renders the production thread controls and Settings → Desktop → This computer
  (`internal/develop/thread-folders.md`) with sample data and a stand-in for the desktop app; "Choose folder…" opens
  the browser's real folder dialog. The bar at the top switches web/desktop and whether this computer has connected
  (`?host=web`, `?setup=done`). Open
  `local-and-cloud.html#/w/northwind/personal/agents?agent=agent_atlas&id=k17convatlaslocalnew000000000000` (a new
  thread), `local-and-cloud.html?setup=done#/w/northwind/personal/agents?agent=agent_atlas&id=k17convatlaslocalcheckout0000000`
  (a local thread; add `&host=web` to see it read-only) or `local-and-cloud.html#/app/settings?section=desktop`.
- `private-threads.html` (feature `private-threads`): Phase 0 of `internal/plans/LOCAL_PRIVATE_THREADS_PLAN.md`,
  built on the Local and Cloud sample data. A new thread on This computer gets a third control, Cloud sync (Synced or
  Not synced); a thread that is not synced shows "Not synced" once started, a small crossed-out cloud in the thread
  list, and Sync to cloud (one way, confirmed) in its options menu. Browsers never list it (`?host=web`). Open
  `private-threads.html#/w/northwind/personal/agents?agent=agent_atlas&id=k17convatlaslocalnew000000000000` (a new
  thread) or `private-threads.html#/w/northwind/personal/agents?agent=agent_atlas&id=k17convatlasprivatestripe0000000`
  (a thread that is not synced). Delete it when the design ships.
- `agent-sidebar-panels.html` (feature `agent-sidebar-panels`): the agent sidebar changes, now in production; the
  feature only adds fixtures. The right panel opens
  on the agent's avatar and name with its panels below: Settings first, then Computer (a plain row with its status),
  Assignments, Progress, Changes and Files, with no search box and no shortcuts. "+" opens that same view as a new tab.
  In the agents list each agent shows at most five threads, then "Load more" (the open thread always stays listed).
  The open pinned chief is filled, and a lone chief is a centred half-width tile. Their
  threads start a little below the tiles, and "Load more" lines up with the thread titles. The right panel's header has
  no dividing line. Open
  `agent-sidebar-panels.html#/w/northwind/workspace/agents?agent=agent_overlay&id=k17convpricing000000000000000000`
  and open the panel at the top right, or `agent-sidebar-panels.html#/w/northwind/personal/agents?agent=agent_atlas&id=k17convatlastable000000000000000`.
  Delete it once the design is accepted in production.
- `agent-panel-links-and-control.html` (feature `agent-panel-links-and-control`): the approved link and computer
  control changes, built from the production components; the feature only adds fixtures. A link opened from an agent thread is a tab of the thread's panel (host, reload and open in a new
  tab above the page) instead of a second panel. Taking control of the agent's computer streams it, now interactive,
  in the panel's Computer tab and widens the panel; Release control sits under the stream and returns the panel to its
  width. The working line's orb lines up with the agent's name, and the primary sidebar leads with Agents, Chats, then
  Work. Open `agent-panel-links-and-control.html#/w/northwind/personal/agents?agent=agent_atlas&id=k17convatlasnews0000000000000000`.
  Delete it once the design is accepted in production.
- `automation-threads.html` (feature `automation-threads`): the proposed automations-as-threads design. The
  Automations route is the production chat: a new automation is the new-chat view whose composer adds a Schedule and an
  Agent picker beside the model picker, and sending opens the automation's chat. Each run posts the instructions again
  and gets a reply; failed runs use the production error row. The Automation panel docks where an agent thread's
  sidebar does (toggle in the header) and holds the name, schedule, time zone, agent, model, on/off, Run now, recent
  runs with Retry and Delete. Automations are listed as thread rows in the contextual panel. Open
  `automation-threads.html#/w/northwind/workspace/automations` (new automation) or
  `automation-threads.html#/w/northwind/workspace/automations?id=k17chatautolaunch000000000000000` (a thread with a
  failed run and one waiting for an answer). Delete it when the design ships or is rejected.
- `chrome-extension.html` (feature `chrome-extension`, output `chrome-extension-app.html`): the proposed Chrome
  extension from `internal/plans/CHROME_EXTENSION_PARITY_PLAN.md`. A stand-in Chrome window frames the production app
  at side-panel width (an agent thread whose `chrome_browser` rows show Atlas working in the person's Chrome, Chats,
  and the proposed Settings → Browser) beside a sample site with the extension's in-page UI: the per-site approval bar,
  the download confirmation and the "Atlas is using this tab · Stop" pill. The bar at the top switches page state,
  side panel view and theme (`?state=ask|download|idle`, `?panel=settings|chats`, `?theme=dark`). Delete both files
  when the design ships or is rejected.
- `note-renderer.html`: the approved note page, block handle, block menu and
  note card design that the notes editor implements. Delete it once the
  redesign is accepted in production.
- Brand source: `build-aligned-brand.py` generates `aligned-brand.*`,
  `overlay-brand-approved/` and the production `ApprovedBrand.tsx`;
  `export-brand-pngs.cjs` exports the raster assets. These are production
  source, not mockups.

Add new mockups here and remove them when their feature ships.
