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
- `thread-folders.html` (feature `thread-folders`): the shipped thread-folder components (computer and folder pickers,
  add-folder dialog, saved-back card) rendered from production code with fixtures, for visual QA. Open
  `thread-folders.html#/w/northwind/personal/agents?agent=agent_atlas&id=k17convatlasfolders0000000000000`.
- `files-on-computers.html` (feature `files-on-computers`): the proposed folders-as-sources design. Folders from
  Overlay, GitHub, Google Drive and several Macs in Files, a per-thread computer picker (the cloud computer plus each
  Mac with the desktop app, with online and offline states) and folder picker under the composer,
  where each change went back to in the transcript, and the agent's Files row in Details. The bar at the top switches
  between the web and desktop app (`?host=web` opens the web app). Open
  `files-on-computers.html#/w/northwind/personal/agents?agent=agent_atlas&id=k17convatlaslaunch00000000000000`, or
  `id=k17convatlasiosshare000000000000` for a thread running on the Mac Studio.
  `files-on-computers-architecture.html` is the matching architecture diagram (WebDAV over the file service, the
  rclone mount at `/overlay` and the `/workspace` copy). Delete both when the design ships.
- `note-renderer.html`: the approved note page, block handle, block menu and
  note card design that the notes editor implements. Delete it once the
  redesign is accepted in production.
- Brand source: `build-aligned-brand.py` generates `aligned-brand.*`,
  `overlay-brand-approved/` and the production `ApprovedBrand.tsx`;
  `export-brand-pngs.cjs` exports the raster assets. These are production
  source, not mockups.

Add new mockups here and remove them when their feature ships.
