# Mobile parity and interaction maturity audit

Status: audit written 2026-11-22. It is based on a code inventory of web (`overlay-landing` main) and mobile (`native-shell` at `7a72bef`), plus hands-on testing in the iOS 26 simulator (iPhone 16e) against the isolated PR preview (`pr-595`). Testing covered the free Personal workspace and the seeded paid **Preview QA Team** workspace. Only P0 #5 is fixed so far.

Severity:
- **P0**: blocks a core job or loses data.
- **P1**: a desktop feature people will look for on the phone, or an interaction that feels broken.
- **P2**: polish that separates "works" from "best in class".

## P0: blockers and data loss

| # | Area | Problem | Seen in test | Fix direction |
| --- | --- | --- | --- | --- |
| 1 | Workspaces | No way to see the current workspace, manage it, or create one. The account sheet shows a switcher only when you belong to 2+ workspaces. `/workspace`, "Manage workspace" and "New workspace" live only in the old drawer, which nothing opens anymore. | Yes | Always show the current workspace in the account sheet with Switch, Manage and New. |
| 2 | Billing | An unpaid workspace can't run anything, and mobile never says why or how to fix it. Sending returns HTTP 402 `subscription_required` (`recovery: "billing"`). Chat shows "Could not send. Your draft is ready to retry." plus a dev error toast. Agent threads say "Open Workspace Billing" with no button. Settings → Billing is read-only ("Free", "Status: Not initialized"). Web blocks the composer up front using `executionAccess`. | Yes | Read `executionAccess` and block the composer with a clear banner: a billing action for owners, "ask an admin" for members. Map 402 billing errors to the same banner. Decide the App Store–compliant upgrade path (link out to web vs in-app purchase). |
| 3 | Notes | Leaving a note with unsaved edits silently discards them. The editor is manual-save Markdown with a "Save changes" button floating mid-screen. Text typed before the body field had focus was also lost. | Yes: typed "Ship it", tapped Back, reopened to an empty note | Autosave (debounced and revision-guarded like web), and save on blur, background and Back. Rich editor, or at least a formatting bar. |
| 4 | Chats | A failed send duplicates the message: the sent bubble stays and the draft is also restored. Reopening the chat shows the user message with no failed state and no Retry. | Yes | Mark the failed turn inline with Retry and Edit. Restore the draft only if the bubble is removed. |
| 5 | Web auth policy | Six account routes reject the native app's verified WorkOS token (`authType: 'access-token'`): invitation accept, profile, profile photo, account workspaces, workspace handles, billing request. Invitation accept and billing request also re-check inside the service. Effects on mobile: "This endpoint requires a signed-in browser session" on Accept invitation, and Account settings shows the email as your name with Save disabled. The tests assert this denial on purpose. | Yes | **Fixed on web main** (`b7e93075c`, live in production 2026-11-22): these routes accept a browser session or the app's verified sign-in token, still refusing API keys and service auth. Invitation accept reads the verified email from the sign-in provider. Account deletion stays browser-only. |
| 6 | Composer focus | In both the new-chat and agent composers the first tap doesn't focus the field; it takes a second tap. | Yes, repeatedly | Investigate the touchable wrapping the TextInput. |
| 7 | Headers | Scrolled content slides under the tab-root title ("Chats") and toolbar with no blur or background, so text overlaps. Caused by the custom left title item. | Yes: Chats list | Restore the iOS scroll-edge effect (native large title, or a header background/blur). |

## P1: desktop features missing on mobile

### Chats
- No regenerate, retry, branch, delete turn or response-version switching on assistant replies. Web has all of them.
- No message queue or steering while a response is running.
- No dictation button in the composer; voice is a separate screen.
- The chats list has no search, pull-to-refresh, pagination, swipe actions or long-press menu. It's a plain, non-virtualized ScrollView, and long-press just opens the chat.
- No in-chat history switcher (`ChatHistorySheet` is dead code).
- Opening a chat shows a full-screen "Loading conversation…" spinner even when a cached copy exists. Sending a first message replaces the screen with that spinner instead of showing the message straight away.
- Room message actions are a native context menu with 8 reactions (2026-11-23), but there is no free emoji picker and no reaction row above the message.
- Fixed 2026-11-23: creating a channel or DM opens it.
- Archived listed only personal chats; archived channels and DMs had no way back on mobile (fixed 2026-11-23).
- Work activity reads "You assigned this to themselves." for self-assignment (shared `describeEvent` wording).
- Work has no drag to reorder; moving within a column is limited to top or bottom.
- Archive "for everyone" and per-room notification preferences throw "not available on mobile".
- The agents list shows "Personal's Overlay" twice. Check the data vs deduping in the UI.

### Agents
- No per-agent thread list or PR badges. (The Agents tab now shows each agent's live status: Working, Needs you, Ready to review.)
- The agent composer is text only: no attachments, mentions or model choice.
- The Computer viewer is view-only; web has take control and open in new tab. The profile's "Computer" row opens the web app.
- Creating an agent sets avatar, name and what it helps with. No permission level, computer size, templates, or connected-agent setup yet.
- Possible: in the simulator the new agent saved as "Tr" though the field showed "Trip Planner" (fast synthetic typing into a controlled field). Recheck on a device.
- **Fixed:** while opening a new agent's chat, the header briefly showed the raw route name "dm/[id]".
- No long-press menu on agent cards.

### Work
- No task search and no delete or archive.
- The board uses a Move button instead of drag.
- No swipe actions.
- Tapping a task's status circle opens the task instead of completing it.
- Unassigned tasks show an empty grey circle where the assignee avatar goes.
- Dates are typed as `YYYY-MM-DD` text instead of using a native date picker.
- The task page has no priority, reviewer, parent, "Done when", or Approve / Request changes.
- The Comment button is loose centred text.
- No optimistic status changes and no pull-to-refresh.

### Files
- No Outputs view and no full-text search.
- No multi-select, long-press or swipe actions.
- Folder upload is unavailable.
- Notes: see P0 #3. No export (Markdown, PDF, Word) and no note assistant.
- Creating a note gives no feedback for about 3 seconds before the editor opens.

### Extensions, Automations, Activity
- Skill and MCP delete have no confirmation or error handling.
- The automation editor has no agent or model choice and no close button. You type the interval in minutes and the time as text. There's no flow canvas or run-replay timeline.
- The Automations empty state is bare text instead of the creature empty state.
- Activity has no swipe-to-mark-read and no pull-to-refresh.

### Settings, workspace, invitations
- Missing sections compared with web:
  - Workspace: rename, icon, people and roles, teams, sharing policy, billing upgrade, top-up, auto top-up.
  - Connected apps: the Overlay MCP address and tokens.
  - Computers, Environments, Agent accounts.
  - Archived management, including delete forever.
- Billing is read-only and shows the raw status "Not initialized".
- Settings is a flat custom list instead of native grouped sections.
- Haptics and start-screen preferences have no UI.
- The invitation screen doesn't name the workspace, the inviter or your role.

### Navigation
- Every deep link (for example `overlay://work`, or an invitation link) reboots the app through the "Opening Workspace…" screen instead of navigating in place.
- `overlay://account` isn't routed; it lands on Chats.
- Signing out from the account sheet logs an unhandled `POP` navigation warning.

## P2: interaction maturity across the app
- **Native controls**: 112 `Alert.alert` calls stand in for action sheets, confirmations and error toasts, and most sheets are JS modals. Prefer native menus (toolbar menus, context menus, `@expo/ui`), form sheets, and an inline toast for errors.
- **Long-press / context menus**: none on chats, agents, tasks or files. Add native context menus with previews.
- **Swipe actions**: none anywhere (archive chat, mark read, complete task).
- **Pull-to-refresh**: only on Archived and Workspace.
- **Optimistic updates**: only room sends. Add them for chat sends, task status, renames, and archive with Undo.
- **Undo**: web shows Undo after archive; mobile has none.
- **Loading**: `ActivityIndicator` everywhere. Use skeletons or cached content.
- **Lists**: unvirtualized ScrollViews with no pagination.
- **Keyboard**: sheets with forms (Extensions, Automations, Settings) don't move out of the keyboard's way.
- **Accessibility**: Automations has zero labels, Extensions one, Webhooks zero.
- **Haptics**: missing in Work, Files, Automations, Settings and Extensions.
- **Chats shortcut cards** sometimes keep a half-scrolled position when you come back.
- **Dev builds**: `console.error` in `aiService` pops the red LogBox toast for expected billing errors.

## Paid workspace results

**Setup.** The paid workspace comes from setting `OVERLAY_PREVIEW_QA_FIXTURES=paid-workspace,computer-workspace` on the PR branch's Preview environment and rebuilding. The fixture belongs to the configured Preview login. The mobile test account joined **Preview QA Team** through a real invitation, which needed the QA-only web auth change in P0 #5. Credits were not refilled.

| Flow | Result |
| --- | --- |
| Accept invitation | Works only with the QA-only auth change. Afterwards the app silently switched to the new workspace with no "You joined…" confirmation. |
| Chat (Claude Opus 4.7) | Works. Markdown, a checklist and a syntax-highlighted code block render. While sending, the screen shows "Loading conversation…" rather than your message. Checklist items show both a bullet and a checkbox. Code lines are cut off on the right. |
| Reply actions | Copy, delete and reply only. No regenerate, branch or response versions. |
| Model picker | Native sheet with Text/Image/Video, search, favourites, provider rail and capability chips. Older Opus sorts above the newer Fable models, and the rail ends in stray letter entries. Closing the sheet with X reset the composer chip to "Auto". |
| Agent thread (QA Workspace Agent) | Works. Your message shows instantly, the avatar animates while working, and the reply ends with "Worked for 16s". The composer needs a second tap to focus and shows an iOS "AutoFill" bubble. |
| Billing | Shows "Paid", "817" available and "184" used without units or dollars, a lowercase "active", and the period end. No top-up, auto top-up or manage actions. |
| Workspace switch | Accept moves you into the paid workspace, but there's still no visible current-workspace row (P0 #1). |

Not covered: Computer (its fixture belongs to the configured Preview login, not the mobile test account), image and video generation (to avoid spending the $1 fixture allowance), connector OAuth, push notifications on a device, iPad and Android.
