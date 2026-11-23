# Native surface checklist

Status: inventory written 2026-11-22 from the `native-shell` code (`app/`, `components/`) and simulator testing against PR preview 595. It lists every page, sheet, drawer and menu a person can reach, and whether it uses native iOS chrome.

Tick a row only after it has been checked in the simulator, in light and dark, at phone width.

## What "native" means here

A surface passes when:

- **Header.** The title sits in the native navigation bar (`Stack` options or the tab-root header item). Buttons use `Stack.Toolbar`. There is no in-page heading, breadcrumb or back row, and no raw route name such as `dm/[id]` ever shows.
- **Content.** The page body is a `ScrollView` or `FlatList` with `contentInsetAdjustmentBehavior="automatic"`.
- **Sheets and forms.** These use a native `formSheet` / `pageSheet` route, or `@expo/ui` (`Form`, `Section`, `Picker`, `Toggle`). The JS `BottomSheet`, `ResourceSheet`, `WorkSheet` and `SheetModal` don't count.
- **Choices.** Action choices are native menus: a toolbar menu, a context menu, or the `@expo/ui` `ContextMenu`. `Alert.alert` is only for a destructive confirmation.
- **Controls.** Segmented controls are `NativeSegmented`. Toggles are a system `Switch` with default iOS colours (no custom `trackColor`/`thumbColor`). Date and time inputs use the native picker, not typed `YYYY-MM-DD` text.
- **Loading and empty states.** Loading shows cached content or a skeleton, not a lone "Opening…" line. Errors are understandable and offer Retry; empty states use `CreatureEmpty`.
- **Edits.** Changes save automatically, or the save action is a toolbar button. There are no full-width "Save changes" buttons at the bottom of a form.

Status key:

- **Native**: passes in code. Still tick it after a simulator check.
- **Partial**: native shell with custom pieces inside.
- **Custom**: hand-built chrome.
- **Dead**: not reachable; delete it or wire it up.

## 1. Tabs (tab roots)

| ✓ | Surface | Route / file | Status | What to fix |
| --- | --- | --- | --- | --- |
| [ ] | Work | `app/(tabs)/work/index.tsx`, `components/work/WorkScreen.tsx`, `WorkViews.tsx` | Partial | <ul><li>Native header, toolbar menu and segmented control are fine.</li><li>Touch and hold a task row or board card for a native context menu: Move to (column), Move to top or bottom, Schedule (2026-11-23).</li><li>Open: no drag to reorder; unassigned tasks show an empty grey avatar circle; the board's empty state sits below the columns.</li></ul> |
| [ ] | Agents | `app/(tabs)/agents/index.tsx`, `components/agents/AgentDirectory.tsx` | Native | Add a long-press context menu (Open, Edit, Archive). |
| [ ] | Chats | `app/(tabs)/chats/index.tsx`, `components/chat/ChatsScreen.tsx`, `ChatRowMenu.tsx` | Partial | <ul><li>Touch and hold a row for a native context menu (2026-11-23): personal chats Rename (native prompt), Archive, Delete (confirmation); channels and DMs Archive; agents Open chat and Agent settings. Archive and delete hide the row at once.</li><li>New message and New channel are `formSheet` routes.</li><li>Open: rows slide under the title with no blur; shortcut cards keep a half-scrolled position; section collapse is custom; no swipe actions or search; the list is not virtualised; the dev-client gear covers the Channels +.</li></ul> |
| [ ] | Files | `app/(tabs)/files/index.tsx`, `components/knowledge/ResourceScreens.tsx` (`FilesBrowserScreen`), `FileActions.tsx` | Partial | <ul><li>Header search and `+` menu are native; New folder is an iOS prompt.</li><li>Touch and hold a file or folder for a context menu: Open, Rename (prompt), Move to (folder submenu), Share, Delete (confirmation) — 2026-11-23.</li><li>Open: no swipe or multi-select; the header search field is nearly invisible in dark mode; deleting can take a moment to leave the list.</li></ul> |
| [x] | Search | `app/(tabs)/search/index.tsx`, `components/search/WorkspaceSearchScreen.tsx` | Native | <ul><li>System search field (`headerSearchBarOptions`; the iOS 26 tab-bar search), a SwiftUI `Form` with People/Work/Chats/Files/Automations sections, a Show menu filter, and `ContentUnavailableView` empty and no-results states (2026-11-23).</li><li>Tap a person to message them or open an agent's chat; context menus: Message/Open chat, Copy mention, Agent settings; results: Open, Copy name.</li><li>Checked light and dark: agent result, context menu, Open chat, file result, filter, no results.</li><li>Open: `SearchResults` in `ResourceViews.tsx` is now used only by the preview fixture and phase2e.</li></ul> |

## 2. Pushed pages

| ✓ | Surface | Route / file | Status | What to fix |
| --- | --- | --- | --- | --- |
| [x] | **Edit agent** | `app/agent/[id].tsx`, `components/agents/AgentEditorScreen.tsx` | Native | <ul><li>Native nav bar (back, Chat, ✓ save) and a SwiftUI `Form`: appearance, name, what it helps with, run on, model (provider menu), instructions, tool toggles, who can use it, archive.</li><li>Replaces the old simple and "advanced" modes.</li><li>Checked 2026-11-22 in light and dark: edit model and colour, save, values persisted.</li><li>Left: `AgentEditorView.tsx` is now used only by the preview fixture; `ConnectMachineSheet` is still a JS sheet.</li></ul> |
| [x] | **Agent thread** | `app/dm/[id].tsx` → `components/agents/AgentThreadScreen.tsx`, `AgentThreadViews.tsx` | Partial | <ul><li>Fixed: no raw `dm/[id]` title.</li><li>Fixed: loading is a quiet delayed spinner.</li><li>Fixed: archived, private or deleted agents and threads explain why, with "Back to Agents". Cause of the reported "unavailable" screen: the agent had been archived, and the editor then returned to its thread.</li><li>Archiving now returns to Agents.</li><li>Still open: composer focus needs two taps.</li></ul> |
| [x] | DM / channel / thread rooms | `app/dm/[id].tsx`, `app/channel/[id].tsx`, `app/thread/[id].tsx` → `components/chat/RoomScreen.tsx`, `RoomMessageMenu.tsx`, `RoomSheets.tsx` | Native | <ul><li>Touch and hold a message for the system context menu: a React submenu (8 emoji), Reply, Reply in thread, Copy, Pin, Save, and Edit/Delete or Report.</li><li>The "…" button is a native toolbar menu: Follow thread, Members, Pinned and Saved (with counts), and a Mute switch.</li><li>Members, Pinned and Saved are SwiftUI sheets (medium/large detents) with inset-grouped lists, row context menus and system empty states.</li><li>Delete, report and member removal confirm with native confirmation dialogs; the 4 remaining `Alert.alert` calls are failure messages.</li><li>Checked 2026-11-23 in light and dark: react, pin, unpin, delete, member removal dialog (cancelled).</li><li>Open: the reaction bar is still a vertical submenu, not a row of emoji above the message.</li></ul> |
| [ ] | Personal chat | `app/chat/[id].tsx`, `app/chat/index.tsx` → `components/chat/ChatScreen.tsx`, `ComposerMenus.tsx` | Partial | <ul><li>Native header; "…" is a native toolbar menu (2026-11-23): Temporary chat switch, Rename (prompt), Share link (system share sheet), Archive, Delete (confirmation).</li><li>Composer "+" and tools are native menus: attach photo/camera/file; tools, memory, mode and image/video generation (shared with rooms).</li><li>`DrawerSidebar` is no longer mounted.</li><li>The model picker is an iOS page sheet (`ModelPickerSheet`, RN `Modal` `pageSheet`) holding the shared selector: swipe down or ✕ to close (2026-11-23). It can take ~2 s to appear the first time while the long list mounts.</li><li>Open: full-screen "Loading conversation…" spinner while sending; the transcript is a DOM web view with no native long-press menu.</li></ul> |
| [x] | Task detail | `app/(tabs)/work/[id].tsx` → `WorkViews.tsx` (`WorkDetailView`) | Native | <ul><li>A SwiftUI `Form`: tap the title or description to edit in place (✓ in the bar saves); the description renders Markdown.</li><li>Status and assignee are menu pickers, dates are switches with compact native date pickers, Depends on is a multi-select menu.</li><li>Mark done and View thread rows, activity list, and a comment field with a send button.</li><li>Checked 2026-11-23 in light and dark: status, assignee, due date, description, comment.</li></ul> |
| [x] | Organization | `app/(tabs)/work/organization.tsx` → `components/work/WorkOrganization.tsx` | Native | Native header and a `Form`: Workspace/Personal segmented picker, Chief of staff and Reports sections; a row opens the agent directly (the agent-detail sheet is gone). Checked 2026-11-23 light and dark. |
| [x] | File detail | `app/(tabs)/files/file/[id].tsx` | Native | "…" toolbar menu: Save or send a copy, Rename, Move to, Share, Delete. The "File options" button, the in-page download icon and duplicate title are gone (2026-11-23). |
| [x] | Note (in Files) | `app/note/[id].tsx` → `components/knowledge/ResourceViews.tsx` note editor | Native | <ul><li>Tap to edit focuses the body ("Start writing…" placeholder); ✓ ends editing. Notes options are the "…" toolbar menu.</li><li>Autosave (2026-11-23): saves 0.8 s after typing stops and immediately on ✓, Back or leaving the app, with the revision guard; a refused save keeps the draft, shows why and waits for the next edit. Checked: typed then went Back at once, reopened with the text saved; cleared it while still editing and it saved.</li><li>Open: no formatting toolbar; a save already in flight when you leave can drop keystrokes typed during it.</li></ul> |
| [ ] | Output detail | `app/(tabs)/files/output/[id].tsx` | Native | Check that the toolbar actions match web (download, share). |
| [x] | Memory detail | `app/(tabs)/files/memory/[id].tsx` | Native | Renders the same native memory editor as Settings › Memories (2026-11-23); the alerts are gone. |
| [x] | Settings | `app/settings.tsx` → `components/settings/SettingsScreen.tsx`, `SettingsViews.tsx` | Native | <ul><li>A SwiftUI `Form` home; each section is its own pushed screen (`/settings?section=…`) with system back and swipe-back.</li><li>Appearance and transcription retention are inline native pickers.</li><li>Notifications and Voice use system switches; Billing uses labelled rows; Account has a native name field with Save shown only after an edit.</li><li>Checked 2026-11-22 in light and dark: home, Members, Account (rename saved), Billing, Notifications and its pre-prompt, Voice, Models, Memories.</li><li>Memory, invite, member, delete account, default model, API keys, subscription, conversation notifications and webhooks are pushed native form pages (2026-11-23). Memory add and edit checked end to end.</li></ul> |
| [x] | Settings › Providers | `components/settings/SettingsEditors.tsx` (`provider`, `add-provider`) | Native | Pushed form pages for an API key (status, test, replace key, remove) and Add API key (provider picker, secure key field). Old sheet-in-sheet removed. Checked 2026-11-23. |
| [x] | Settings › Webhooks | `SettingsEditors.tsx` (`WebhooksList`, `webhook`, `add-webhook`) | Native | Form list, pushed detail (enabled switch, deliveries with retry, rotate secret, delete) and Add webhook. Created and disabled a test webhook on the preview 2026-11-23. |
| [x] | Settings › Subscription connection | `SettingsEditors.tsx` (`subscription`) | Native | Pushed form: Just me / Workspace segmented picker and provider rows; sign-in, code and callback steps as form rows. Provider list checked 2026-11-23; a full sign-in was not run. |
| [x] | Settings › Room notifications | `components/settings/RoomNotifications.tsx` (`room`) | Native | Pushed page with an inline level picker; saves through the web mutation and refuses writes after a workspace switch (covered by phase2f). |
| [ ] | Settings › Billing | `SettingsViews.tsx` (billing) | Partial | <ul><li>Fixed: native labelled rows and readable status ("Active", "Not set up").</li><li>Still read-only, with credits as bare numbers and no upgrade or top-up path.</li></ul> |
| [x] | Automations | `app/automations.tsx` → `components/automations/AutomationBrowserScreen.tsx` | Native | <ul><li>Creature empty state with New automation; detail "…" is a toolbar menu (Edit, Delete with native confirmation) — 2026-11-23.</li><li>Checked: create (paused), reopen in editor with values intact, delete.</li><li>Open: schedules display in UTC rather than the automation's time zone; the detail body (Run now / Pause, run history) is still RN.</li></ul> |
| [ ] | Automation detail | `components/automations/AutomationDetailSheet.tsx` | Dead | No longer mounted by the app (the browser screen shows details inline); delete it with its idempotency test reference. |
| [x] | Automation editor | `app/automation-edit.tsx` → `components/automations/AutomationEditorScreen.tsx` | Native | `formSheet` route with Cancel/✓: name, description, instructions, Interval/Daily/Weekly/Monthly segmented picker, interval/day menus, native time picker, time-zone menu, Enabled switch (2026-11-23). Open: no agent or model choice. |
| [x] | Automation run | `components/automations/AutomationRunSheet.tsx` in `NativePageSheet` | Native presentation | iOS page sheet (swipe to dismiss, ✕); body still RN. Not exercised: the test automation never ran. |
| [x] | Extensions | `app/tools.tsx` → `components/tools/ToolsScreen.tsx` | Native | <ul><li>A SwiftUI `Form`: Apps/Skills/MCPs segmented picker, "Connections for" menu, system search bar, rows with native switches.</li><li>Connecting or disconnecting an app asks in a native confirmation that names the app; loading errors no longer pop alerts.</li><li>Skill and MCP editors are `formSheet` routes (`ExtensionForms.tsx`) with Delete + confirmation (2026-11-23).</li><li>Checked: skill create, edit, delete; MCP form light/dark.</li><li>Open: the app-search field did not take focus from automation; app connect not exercised.</li></ul> |
| [x] | MCP server detail | `components/tools/McpDetailSheet.tsx` in `NativePageSheet` | Native presentation | iOS page sheet; Edit opens the native MCP form. Body (OAuth connect, test) is still RN with alerts. |
| [x] | Activity | `app/activity.tsx` → `components/chat/ActivityScreen.tsx` | Native | <ul><li>Mail-style inbox: items stay unread until opened, swiped right (`ReanimatedSwipeable`, full swipe marks read with a haptic) or cleared with Mark All as Read in a `Stack.Toolbar.Menu` (2026-11-23). Opening the screen no longer marks everything read (web still does).</li><li>Rows grouped by day with avatar, time and two-line preview; native context menu (`RowMenu`): Open, Mark as Read, Copy Text. Submit a Bug moved to the "…" menu. Chats' Activity card counts unread notifications.</li><li>Checked 2026-11-23 light and dark: live arrival, full swipe, Read button, context menu, Mark All, Unread empty state, tap to open.</li><li>Open: no Mark as Unread (the backend only marks read); no pull-to-refresh (the list is live).</li></ul> |
| [x] | Archived | `app/archived.tsx` → `components/chat/ArchivedScreen.tsx` | Native | SwiftUI list with the system search bar and empty state; touch and hold for Unarchive (and Delete for personal chats). Now includes archived channels and DMs (`collaboration.archive.rooms`), which opened as personal chats before or were missing. Checked 2026-11-23: archive a channel, find it, unarchive it. |
| [x] | Workspace | `app/workspace.tsx` → `components/workspace/WorkspaceScreen.tsx` | Native | <ul><li>Reached from the account sheet's Manage workspace. A SwiftUI `Form` home (type, your role, members) with pushed section pages (`/workspace?section=…`): People, Agents, Teams, Team, Guests, Sharing and policies, Billing, Import from Slack, Shared with me (2026-11-23).</li><li>Member rows are native menus (role picker, make owner, remove with confirmation); invitation rows resend or cancel. Teams: create by prompt, member switches, archive from a context menu with confirmation. Policies are switches; billing is read-only rows with a usage bar; owners archive the workspace with a confirmation.</li><li>Lists read live Convex views, so the four JS sheets and spinners are gone. Invite reuses the Settings invite page (now with Guest).</li><li>Checked 2026-11-23 light and dark: role change and restore, team create/member/archive, policy toggle and persistence, billing, new workspace then archive.</li><li>Open: Import from Slack is still the RN panel; invites were not sent (they email real addresses).</li></ul> |
| [ ] | Slack import | `components/workspace/SlackImportPanel.tsx` | Custom | Hand-built steps. |
| [ ] | Voice | `app/voice.tsx` → `components/voice/VoiceScreen.tsx` | Custom | <ul><li>No stack header (the root default hides it).</li><li>`MainScreenHeader` plus `DrawerSidebar`.</li><li>Custom toggles.</li></ul>Give it a native header and a `Form`. |
| [ ] | Notes | `app/notes.tsx` → `components/notes/NotesEditorScreen.tsx`, `NoteEditor.tsx` | Custom | `MainScreenHeader` plus `DrawerSidebar` and no stack header. Only reachable by deep link; remove it or merge it into Files. |
| [x] | Invitation | `app/invitations/[id].tsx` | Native | Native header and `Form`: the account that will accept, Accept invitation, Not now, and Sign in with another account when the server says the invitation is for a different email; errors show in a form section (2026-11-23). Open: it still can't name the workspace, inviter or role, because no endpoint looks an invitation up for the invitee. |
| [ ] | Shared chat link | `app/share/c/[token].tsx` | Custom | Opens the web page in the in-app browser. |

## 3. Native sheets (routes)

| ✓ | Surface | Route / file | Status | What to fix |
| --- | --- | --- | --- | --- |
| [x] | Account | `app/account.tsx` (`formSheet`, `@expo/ui` `Form`) | Native | <ul><li>Fixed 2026-11-23: the Workspace section always shows (an inline picker of your workspaces), with Manage workspace and New workspace (iOS prompt; the new workspace becomes active).</li><li>Open: sign-out logs an unhandled `POP`.</li></ul> |
| [ ] | New agent | `app/agent-create.tsx` (`formSheet`) | Native | First-tap focus on its fields. |
| [ ] | Agent profile | `components/agents/AgentProfileSheet.tsx` (RN `Modal`) | Partial | Make it a `pageSheet` route so it gets native detents and dismissal. |

## 4. JS sheets and modals to convert

Each needs either a native sheet route, an `@expo/ui` `BottomSheet`, or replacing with a menu.

| ✓ | Sheet | File | Opened from | Better native form |
| --- | --- | --- | --- | --- |
| [x] | Chat options (rename, share, archive, delete, temporary) | `components/chat/ChatScreen.tsx` (`chatMenu`) | Chat header `…` | Toolbar menu (2026-11-23). `ChatActionsSheet` survives only in the dead `DrawerSidebar` |
| [ ] | Composer attach / tools / mode | `components/chat/Composer.tsx` (2 sheets) | Composer `+` and tools chip | Native menu |
| [ ] | Model picker | `components/chat/ModelPicker.tsx` | Composer model chip | `pageSheet` route (already looks right; check the X resets the model) |
| [ ] | Draft review | `components/chat/DraftReviewSheet.tsx` | Draft card | `pageSheet` |
| [x] | New DM / add people | `app/new-message.tsx` → `components/chat/NewConversationForms.tsx` | Chats compose menu, room Members + | `formSheet` route with a searchable people list (2026-11-23); also adds people to a room |
| [x] | New channel | `app/new-channel.tsx` → `components/chat/NewConversationForms.tsx` | Chats compose menu | `formSheet` route with a `Form` (2026-11-23). The old `NewChannelSheet`/`NewDirectMessageSheet` survive only in the dead `DrawerSidebar` |
| [x] | Room message actions | `components/chat/RoomMessageMenu.tsx` | Long-press a message | Context menu (2026-11-23) |
| [x] | Room members / pinned / saved | `components/chat/RoomSheets.tsx` | Room header menu | SwiftUI sheet with detents (2026-11-23) |
| [ ] | Share | `components/workspace/ShareSheet.tsx` | File and chat options | `pageSheet` with a `Form` |
| [x] | Create workspace | removed | Account sheet | An iOS text prompt from the account sheet's New workspace (2026-11-23); `CreateWorkspaceSheet` deleted |
| [x] | Workspace switcher | removed | — | Deleted with its drawer mount; the account sheet replaces it (2026-11-23) |
| [ ] | Connect a machine | `components/agents/ConnectMachineSheet.tsx` | Agent editor | `formSheet` |
| [ ] | Agent editor picker | `components/agents/AgentEditorView.tsx` (`SheetModal`) | Edit agent | `@expo/ui` `Picker` in the `Form` |
| [ ] | Agent computer viewer | `components/agents/AgentComputerPreview.tsx` (RN `Modal`) | Agent profile | `fullScreenModal` route |
| [ ] | Upgrade prompt | `components/auth/UpgradePrompt.tsx` (RN `Modal`) | Locked model | `formSheet` |
| [x] | Work new task / schedule / move / organization | `app/(tabs)/work/new.tsx`, `schedule.tsx` → `components/work/WorkForms.tsx` | Work toolbar and task context menu | New task and Schedule are `formSheet` routes with a `Form`, native date pickers and Cancel/✓; Move is the task context menu; `WorkSheet`, `WorkOptions` and `WorkTaskActions` are deleted (2026-11-23) |
| [x] | Files options / new folder / rename / move | `components/knowledge/FileActions.tsx` | Files `+`, row context menu, file "…" | Native menus with `Alert.prompt` for names and a confirmation dialog for delete (2026-11-23). `ResourceSheet` is no longer used by Files |
| [x] | Settings pickers | `components/settings/SettingsScreen.tsx` | Settings rows | Done: inline pickers and pushed pages (2026-11-23) |
| [x] | Search result actions | `components/search/WorkspaceSearchScreen.tsx` | Person result | Context menus on people and results; the `ResourceSheet` is gone (2026-11-23) |
| [x] | Skill editor / app connect | `app/skill-edit.tsx`, `app/mcp-edit.tsx` → `components/tools/ExtensionForms.tsx` | Extensions | `formSheet` routes; app connect is a native confirmation (2026-11-23) |

## 5. Menus and confirmations

- [ ] Replace `Alert.alert` used as an action list with native menus. There are 112 calls across 35 files. The heaviest are:
  - `ToolsScreen` (10)
  - `RoomScreen` (4, failure messages only)
  - `McpDetailSheet` (7)
  - `AutomationDetailSheet` (7)
  - `FilesTree` (7)
  - `MemoriesList` (6)
- [ ] Use `Alert.alert` only for destructive confirmations. Show non-blocking errors inline or as a toast.
- [ ] Add long-press context menus to the rows of Chats, Agents, Work tasks, Files and Activity.
- [ ] Add swipe actions: archive a chat, mark Activity read (done 2026-11-23), complete a task.

## 6. Drawers and dead surfaces

| ✓ | Surface | File | Action |
| --- | --- | --- | --- |
| [ ] | Drawer sidebar | `components/chat/DrawerSidebar.tsx` (mounted by `ChatScreen`, `FilesScreen`, `NotesEditorScreen`, `VoiceScreen`, `PlaceholderScreen`; nothing opens it) | Delete it, and move Manage/New workspace into the account sheet. |
| [ ] | Old account sheet | `components/shell/AccountSheet.tsx` | Delete (`app/account.tsx` replaces it). |
| [ ] | Chat history sheet | `components/chat/ChatHistorySheet.tsx` | Delete, or wire it up as a native history menu. |
| [ ] | Legacy files UI | `components/knowledge/FilesScreen.tsx`, `FilesTree.tsx`, `OutputsGallery.tsx`, `MemoriesList.tsx` | Reuse the parts the live Files tab lacks (Outputs, multi-select), then delete. |
| [ ] | Other unused | `MessageBubble.tsx`, `SharedMarkdownConversation.tsx`, `EnvironmentsPanel.tsx`, `settings/ComputersSection.tsx`, `settings/ModelsSection.tsx`, `work/WorkHeader.tsx`, `ui/PlaceholderScreen.tsx`, `AppChrome` `MainScreenHeader` | Delete, or wire up Computers and Environments as native Settings pages. |

## 7. Entry and system screens

| ✓ | Surface | Route | Status | Check |
| --- | --- | --- | --- | --- |
| [ ] | Boot / opening workspace | `app/index.tsx`, `components/shell/SessionGate.tsx` | Custom by design | Every deep link reboots through "Opening Workspace…"; links should navigate in place. |
| [ ] | Welcome and sign-in | `app/auth-flow.tsx` (`fullScreenModal`) | Custom by design | Check light and dark mode, and that the sign-in button uses a system web auth session. |
| [ ] | Auth callbacks | `app/auth/callback.tsx`, `app/auth/native/callback.tsx`, `app/auth/transfer.tsx` | Spinner | Show a branded loading state, not a bare spinner. |
| [ ] | Onboarding | `app/onboarding.tsx` (`fullScreenModal`) | Custom by design | Check paging, haptics and the notification prompt. |
| [ ] | Deep-link routing | `app/+native-intent.tsx`, `lib/incomingLinks.ts` | — | `overlay://account`, `/workspace` and `/settings/workspace` now route (2026-11-23, covered by launch.test). Open: links still reboot through "Opening Workspace…". |

## Cross-cutting checks for every surface

- [ ] Light and dark mode both work; dark mode uses grey surfaces, not black cards.
  - Fixed 2026-11-23: UIKit chrome (toolbar menus, alerts, share sheets) now follows the app's appearance; toolbar menus had opened light in dark mode because the navigation theme was always light.
- [ ] The title never shows a raw route name.
- [ ] The first tap focuses a text field, and no iOS "AutoFill" bubble appears on non-credential fields.
- [ ] Keyboard: the field and its submit button stay visible, and the keyboard dismisses on scroll.
- [ ] Every button and row has an accessibility label.
- [ ] Haptics fire on selection and on success.
- [ ] Loading never blanks a screen that has cached data.
- [ ] Empty and error states use `CreatureEmpty`, centred in the visible area, with a Retry where it applies.
