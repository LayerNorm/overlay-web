# Thread folders: where an agent thread works

An agent thread runs in one of two places: on the computer the desktop app is open on ("local", shown as **This
computer**) or in the **Cloud**. It works in one folder or in none. Both are chosen before the thread's first message
and fixed after it. Overlay copies only a chosen Overlay Files folder onto the computer when a run starts and saves
changes back to Files when the run ends. Design: `internal/plans/mockups/local-and-cloud.html`. Plan: `internal/plans/FILES_ON_COMPUTERS_PLAN.md`. Later work (an `/overlay` mount, Google Drive folders,
workspace computers) is in `todos.md`.

## Pieces

| Piece | Where |
| --- | --- |
| Rules for what a thread may choose | `src/shared/agents/thread-work.ts` |
| Stored choice (`conversations.work`), pickers' options, set | `convex/agents/threadWork.ts`, `convex/lib/threadWork.ts` |
| Copy records, folder listing, summary card | `convex/files/folderCopies.ts` (`threadFolderCopies`, pruned after a week) |
| Copy in and save back | `src/server/agents/thread-work/folder-copy.ts`, `thread-work-service.ts` |
| Run hooks | `src/server/harness/thread-work-steps.ts` in `nativeHarnessWorkflow`; the stop route saves a stopped run |
| Agent instructions | `src/server/agents/thread-work/thread-work-prompt.ts`, added by `native-workflow-input-builder.ts` |
| GitHub App | `src/server/integrations/github/github-app.ts`, `/api/v1/github/*`, `convex/integrations/githubInstallations.ts` |
| UI | `src/features/chat/components/thread-work/` (`useThreadWork`, the footer and + menu rows, the read-only notice, summary card) |
| This computer | `src/components/desktop/this-computer.ts` and `useThisComputer.ts` (connect, choose and remove folders), `src/features/settings/components/DesktopLocalComputerSettings.tsx` |

## Decisions

- **Only the chosen folder is copied.** Never the whole workspace. A thread holds up to five folders; the UI picks one.
- **Overlay copies, the computer holds no Overlay credential.** The server writes files through the computer's
  file API and reads changes back the same way.
- **Every save goes through FileService** with the run's person, revision check and `byAgent`. A file changed in
  the app during the run is never overwritten: the agent's version is saved beside it as "<name> (<agent>’s copy)".
  A deleted file is only deleted if nobody changed it meanwhile.
- **Saved back automatically** when the run ends: completed, failed, or stopped. The workflow saves after the reply
  is delivered; Stop cancels the workflow, so the stop route saves the run's copies in `after()`. Each copy is claimed
  once (`copied` → `saving`), so a second save does nothing. The summary is a `data-folder-saves` part on the reply.
- **Each run starts from a clean copy.** Copy-in empties the folder's directory on the computer first, so files left
  by an earlier run are never saved back as new. A continuation of the same run keeps its copy.
- **Deletions need a complete listing.** The listing script ends with a marker line; when output is cut off (a Mac
  returns at most 256 KiB per command), changes and new files are still saved but nothing is deleted from Files.
- **Never copied either way:** `node_modules`, `.git`, `.next`, `.turbo`, `.venv`, `venv`, `__pycache__`, `.cache`,
  `dist`, `build`, `.DS_Store`, `.env` and `.env.*` (except `.env.example`).
- **Limits.** Cloud: 1,000 files, 50 MB per file, 200 MB per folder. Mac: 300 files, 450 KB per file (the host's
  per-call limit), 20 MB per folder. A folder over 2,000 entries isn't copied. Anything over a limit is listed as
  left out.
- **Notes are Markdown files** on the computer (`<name>.md`) and stay notes. A new `.md` file becomes a note; other
  text becomes a text file; anything else a stored file. Stored files can't be edited in place: the new version is
  saved and the old one removed.
- **Local and Cloud.** A local thread works in a folder on the computer, an Overlay Files folder or none. A cloud
  thread works in an Overlay Files folder, a GitHub repository or none. Stored data keeps the first platform's name:
  the computer is `{ kind: 'mac', environmentId }` and its folders are `source: 'mac'`.
- **Fixed after the first message.** `agents/threadWork:set` refuses any change once the thread has a message
  (`THREAD_WORK_LOCKED`); saving the same choice again is a no-op. The UI shows plain labels instead of menus.
- **Where the choice is made.** The desktop app shows "Runs on" and the folder under the message box; a new thread
  defaults to this computer once it has connected, and to the cloud before that. The web shows nothing under the
  message box: every new thread runs in the cloud and its folder is chosen from the + menu ("Work in a folder"); a
  chosen folder shows as a small removable label.
- **A local thread continues only on its computer.** It is saved to the cloud like every thread, so it can be read
  anywhere, but in a browser or on another computer a notice naming its computer replaces the message box. This is a
  UI rule, not a permission: remote control, several computers and sync are later work (`todos.md`, "Computers and
  remote control").
- **Connecting needs no setup step.** Choosing "This computer" or a folder connects the computer: the desktop app
  starts its bundled host and the web app approves the enrollment whose phrase that host printed, for the work folder
  `~/Overlay Files`. Folders are chosen in the system's folder dialog (`localComputer.chooseFolder`); choosing is the
  consent, and the folder joins the computer's approved folders after the work folder.
- **The work folder is always first.** The host runs commands in its first approved folder, so `~/Overlay Files` is
  approved first. A thread with no folder works there, and Overlay Files folders are copied into it
  (`localWorkBase`).
- **A new folder works at once.** The host learns its approved folders when it renews its access (every 15 minutes).
  When a path is refused as outside them, it now asks for the current folders once (at most every 30 seconds) and
  retries, so a folder chosen a moment ago works on the thread's first message.
- **A computer is personal.** Only the person who connected a computer can choose it or its folders, and a run uses
  it only when that person started the run. A workspace agent never uses a teammate's computer.
- **Copy to Overlay Files** copies a folder on the computer into Files once, so cloud threads can use it. It is not
  kept in sync.
- **GitHub repositories are cloned on the cloud computer only**, into `~/workspace/<repo>`, with an installation token
  limited to that repository that expires within an hour. The token sits in `/tmp/overlay-github/<owner>/<repo>.token`, one per repository, for a
  git credential helper and is removed when the run's folders are saved. The agent is told to branch and open a pull
  request, never push to the default branch; the summary card lists pull requests the app opened during the run.
  Connecting is a GitHub sign-in that returns to the deployment that started it (`redirect_uri`); the callback connects
  every installation of the app GitHub lists for that person (`/user/installations`), so nobody can connect someone
  else's. Installing is a separate step on GitHub ("Install on GitHub"), after which the person connects again.
- **Cloud computer and Local computer are separate tool groups.** Cloud computer (`computer`) gives an agent a paid
  cloud machine and is opt-in. Local computer (`local_computer`, stored as `capability:local_computer`) lets it use
  the person's own computer, costs nothing and is on for new agents and the default agent. It grants the computer
  tools only to a thread its owner set to run on their own computer (`localThreadComputerToolIds`); workspace policy
  and approvals still apply. Without it "This computer" is disabled in Runs on. Agents saved before the group existed
  don't name it: after the Convex sync that ships it, run `npx convex run migrations/grantLocalComputer:run` once on
  that deployment (idempotent, self-continuing; `'{"dryRun":true}'` first). It turns the group on for every agent that
  can already edit files and leaves read-only agents alone.
- **Computer tools default to the thread's computer.** A local thread sends computer tools to its computer
  (`localEnvironmentId`); offline or not-yours fails with a message telling the agent not to retry.

## Paths

- Cloud: Overlay folders at `~/workspace/<folder>`, repositories at `~/workspace/<repo>` (the home folder). Boat's file
  API only reads and writes under the home folder and `/tmp`, so a root such as `/workspace` can't be used.
- This computer: Overlay folders at `~/Overlay Files/<folder>`; folders on the computer are used in place. A computer
  connected by the terminal command with other folders keeps copies in `<first approved folder>/Overlay Files/`.

## Settings

GitHub App: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`. The app needs Contents and Pull requests (read and write) and Metadata (read), the
callback URL `<origin>/api/v1/github/callback`, no webhook, and "Request user authorization (OAuth) during
installation" off: with it on, GitHub always returns installs to the first callback URL, which breaks previews. Without
these settings the picker lists no repositories and connecting reports that GitHub isn't set up.

Production and PR previews use separate apps, so preview builds never hold a credential for customers' repositories:
`overlay-agents` (callbacks `https://www.getoverlay.io/api/v1/github/callback` and
`https://getoverlay.io/api/v1/github/callback`, because production's app URL is the bare domain that redirects to `www`
and the sign-in must return to exactly the `redirect_uri` it was sent; Production settings) and
`overlay-agents-preview` (callback `https://preview.getoverlay.io/api/v1/github/callback` with wildcard matching, so
every `pr-<n>.preview.getoverlay.io` is accepted; Preview settings; installed only on LayerNorm test repositories).

## QA

`npx tsx --test src/shared/agents/thread-work.test.ts src/components/desktop/this-computer.test.ts`, `NODE_OPTIONS=--require=./scripts/ci/register-server-only.cjs
npx tsx --test src/server/agents/thread-work/folder-copy.test.ts` and `npx vitest run convex/threadWork.convex.test.ts`.
Hosted QA: pick a Files folder in an agent thread, ask the agent to edit a note and add a file, edit the same note
in Files while it works, and check the card shows an update, a new file and a copy. `scripts/qa/fuse-mount-check.ts`
covers the later `/overlay` mount.
