# Thread folders: where an agent thread works

An agent thread chooses the computer it runs on and the folder it works in, under its message box. Overlay
copies only the chosen folder onto that computer when a run starts and saves changes back to Files when the run
ends. Plan: `internal/plans/FILES_ON_COMPUTERS_PLAN.md`. Later work (an `/overlay` mount, Google Drive folders,
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
| UI | `src/features/chat/components/thread-work/` (footer pickers, add-folder dialog, summary card) |

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
- **Never copied either way:** `node_modules`, `.git`, `.next`, `.turbo`, `.venv`, `venv`, `__pycache__`, `.cache`,
  `dist`, `build`, `.DS_Store`, `.env` and `.env.*` (except `.env.example`).
- **Limits.** Cloud: 1,000 files, 50 MB per file, 200 MB per folder. Mac: 300 files, 450 KB per file (the host's
  per-call limit), 20 MB per folder. A folder over 2,000 entries isn't copied. Anything over a limit is listed as
  left out.
- **Notes are Markdown files** on the computer (`<name>.md`) and stay notes. A new `.md` file becomes a note; other
  text becomes a text file; anything else a stored file. Stored files can't be edited in place: the new version is
  saved and the old one removed.
- **A Mac is personal.** Only the person who connected a Mac can choose it or its folders, and a run uses it only
  when that person started the run. A workspace agent never uses a teammate's Mac.
- **A Mac folder pins the thread to its Mac.** Its approved folders are the Mac's folders; the owner can add one
  from the thread (`PATCH roots` now allows the machine's owner, not only managers). The Mac picks up a new folder
  when it next renews its access, within 15 minutes.
- **GitHub repositories are cloned on the cloud computer only**, into `~/workspace/<repo>`, with an installation token
  limited to that repository that expires within an hour. The token sits in `/tmp/overlay-github/<owner>.token` for a
  git credential helper and is removed when the run's folders are saved. The agent is told to branch and open a pull
  request, never push to the default branch; the summary card lists pull requests the app opened during the run.
  Installing is verified: the callback saves an installation only if GitHub says the signed-in person can see it.
- **Computer tools default to the thread's computer.** A thread set to a Mac sends computer tools to that Mac
  (`localEnvironmentId`); offline or not-yours fails with a message telling the agent not to retry.

## Paths

- Cloud: Overlay folders at `~/workspace/<folder>`, repositories at `~/workspace/<repo>` (the home folder). Boat's file
  API only reads and writes under the home folder and `/tmp`, so a root such as `/workspace` can't be used.
- Mac: Overlay folders at `<first approved folder>/Overlay Files/<folder>` (or the home folder when the Mac may use
  all files); Mac folders are used in place.

## Settings

GitHub App: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`. The app needs Contents and Pull requests (read and write) and Metadata (read), "Request
user authorization (OAuth) during installation" on, and the callback URL `<origin>/api/v1/github/callback`. Without
these settings the picker lists no repositories and connecting reports that GitHub isn't set up.

## QA

`npx tsx --test src/shared/agents/thread-work.test.ts`, `NODE_OPTIONS=--require=./scripts/ci/register-server-only.cjs
npx tsx --test src/server/agents/thread-work/folder-copy.test.ts` and `npx vitest run convex/threadWork.convex.test.ts`.
Hosted QA: pick a Files folder in an agent thread, ask the agent to edit a note and add a file, edit the same note
in Files while it works, and check the card shows an update, a new file and a copy. `scripts/qa/fuse-mount-check.ts`
covers the later `/overlay` mount.
