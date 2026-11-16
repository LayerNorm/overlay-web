# Files on every computer

Status: Approved by the owner (2026-11-15). Phases 0 to 5 are implemented on the `codex/mac-as-computer` branch with
unit and Convex tests; nothing is merged, deployed or accepted yet. See Progress.

Design: `internal/plans/mockups/files-on-computers-architecture.html` and `files-on-computers.html` (they still show
the `/overlay` mount, now a later step). Builds on Phase 1 of `LOCAL_CLOUD_CONTINUITY_PLAN.md` and replaces its
project and handoff phases. Later work, the `/overlay` mount and Google Drive folders, is in `todos.md`.

## Goal

A thread works in the folders chosen for it, from Overlay Files, GitHub or one of the user's Macs. It runs on the
agent's cloud computer or on any Mac with the desktop app, and can be started and watched from anywhere.

## Decisions

- **Copy only the chosen folders.** A thread names its folders; only those are copied to the computer, never the
  whole workspace.
- **Overlay copies them in and out.** Overlay's server writes the files through Boat's file API and reads changes
  back the same way, so the computer holds no Overlay credential.
- **Every save goes through FileService** when changes are copied back, with the same permission checks, revision
  checks and agent attribution as the app.
- **GitHub is cloned, not copied,** and changes go back as a pull request.
- **Every Mac is a computer.** A folder on a Mac pins its thread to that Mac.
- **Notes stay in Convex.** They are copied out as `.md` files and saved back as notes.
- **Composio stays for agent tools.** GitHub folders use a GitHub App.

## Progress

| Phase | State |
| --- | --- |
| 0. Checks | Done: mount works on Boat (see `todos.md`). Drive check moved to `todos.md`. |
| 1. Copy in and out | Implemented and passed hosted QA on PR #542's Preview (cloud computer): copy in, edit, new note, conflict saved as a copy, and save-back after Stop, with the summary card. |
| 2. Several computers | Implemented; on the Preview a thread pinned to one connected Mac ran its tools there. Not tested with two Macs at once. |
| 3. Folder sources and pickers | Implemented as the composer pickers; GitHub and Mac folders are not rows in Files yet. |
| 4. GitHub App | Implemented. Untested end to end: the GitHub App isn't registered and has no settings yet. |
| 5. Mac folders | Implemented; on the Preview an agent edited an approved Mac folder in place and Copy to Files skipped `.env` and `node_modules`. Adding a folder from the dialog was not tested. |

Living doc: `internal/develop/thread-folders.md`.

## Phases

0. **Checks: done.** Boat computers support FUSE mounts, which the later `/overlay` mount needs (results in
   `todos.md`). The same runs showed many small files are 20 to 40 times slower over a mount than on the computer's
   disk, so copying folders in is also faster for builds. Scripts: `scripts/qa/fuse-mount-check.ts`,
   `scripts/qa/boat-stop-control.ts`.
1. **Copy in and out.** When a run starts, copy each chosen Overlay folder to `~/workspace/<folder>` and record each
   file's revision and hash.
   - Skip anything in `.gitignore`, `node_modules` and `.env` files. Ask first above a size limit.
   - At the end of each run, find new, changed and deleted files and save them through FileService.
   - A file changed in the app during the run is saved as a copy, never overwritten.
   - The run's summary card lists what went back.
   - Done when: an agent edits a note and a spreadsheet in a chosen folder, and both appear in Files with the
     agent marked as their editor; a conflicting edit becomes a copy.
2. **Several computers.** Keep a list of the cloud computer plus every enrolled Mac, with heartbeat and online state.
   - Threads store a `computerId`, and computer tools go to it.
   - Offline computers return `target_offline`.
   - Add the "Runs on" picker.
   - Done when: two Macs and the cloud computer take turns on one thread.
3. **Folder sources and pickers.** Folder rows record their source (Overlay, GitHub, Mac). Threads store their
   folders. Add the folder picker under the composer, source icons in Files and the Details row.
4. **GitHub App.** Users choose which repositories it can reach. Each run gets a token that expires on its own; the
   agent clones, works on a branch and opens a pull request, linked from the summary card.
5. **Mac folders.** Add a folder from the desktop app on that Mac, or Copy to Files, with the same exclusions as
   phase 1. A thread on a Mac gets its chosen Overlay folders through the Agent Host the same way.

## Risks

- **Long runs work on old copies.** Edits made in the app during a run are not seen by the agent, and saving back
  produces conflict copies. The later mount fixes this.
- **Large folders** cost time on every run. The size limit asks first; the mount fixes this too.
- **No version history.** Files keeps only the newest version, so a bad agent save is hard to undo. Add version
  history before agents save back without review.

## Settled

- Changes save back automatically at the end of a run and are listed on the summary card (owner, 2026-11-15).
- A Mac is a personal computer: only its owner's threads run on it, and a workspace agent can't use a teammate's Mac.
  Workspace computers are a later item in `todos.md` (owner, 2026-11-15).
