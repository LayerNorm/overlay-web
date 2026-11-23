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
| [ ] | Files | `app/(tabs)/files/index.tsx`, `components/knowledge/ResourceScreens.tsx` (`FilesBrowserScreen`) | Partial | <ul><li>Header search and `+` menu are native.</li><li>File options open a JS `ResourceSheet`; use a context menu instead.</li><li>No swipe or multi-select.</li></ul> |
| [ ] | Search | `app/(tabs)/search/index.tsx`, `components/search/WorkspaceSearchScreen.tsx` | Partial | Result actions open a JS `ResourceSheet`; use a native menu. |

## 2. Pushed pages

| ✓ | Surface | Route / file | Status | What to fix |
| --- | --- | --- | --- | --- |
| [x] | **Edit agent** | `app/agent/[id].tsx`, `components/agents/AgentEditorScreen.tsx` | Native | <ul><li>Native nav bar (back, Chat, ✓ save) and a SwiftUI `Form`: appearance, name, what it helps with, run on, model (provider menu), instructions, tool toggles, who can use it, archive.</li><li>Replaces the old simple and "advanced" modes.</li><li>Checked 2026-11-22 in light and dark: edit model and colour, save, values persisted.</li><li>Left: `AgentEditorView.tsx` is now used only by the preview fixture; `ConnectMachineSheet` is still a JS sheet.</li></ul> |
| [x] | **Agent thread** | `app/dm/[id].tsx` → `components/agents/AgentThreadScreen.tsx`, `AgentThreadViews.tsx` | Partial | <ul><li>Fixed: no raw `dm/[id]` title.</li><li>Fixed: loading is a quiet delayed spinner.</li><li>Fixed: archived, private or deleted agents and threads explain why, with "Back to Agents". Cause of the reported "unavailable" screen: the agent had been archived, and the editor then returned to its thread.</li><li>Archiving now returns to Agents.</li><li>Still open: composer focus needs two taps.</li></ul> |
| [x] | DM / channel / thread rooms | `app/dm/[id].tsx`, `app/channel/[id].tsx`, `app/thread/[id].tsx` → `components/chat/RoomScreen.tsx`, `RoomMessageMenu.tsx`, `RoomSheets.tsx` | Native | <ul><li>Touch and hold a message for the system context menu: a React submenu (8 emoji), Reply, Reply in thread, Copy, Pin, Save, and Edit/Delete or Report.</li><li>The "…" button is a native toolbar menu: Follow thread, Members, Pinned and Saved (with counts), and a Mute switch.</li><li>Members, Pinned and Saved are SwiftUI sheets (medium/large detents) with inset-grouped lists, row context menus and system empty states.</li><li>Delete, report and member removal confirm with native confirmation dialogs; the 4 remaining `Alert.alert` calls are failure messages.</li><li>Checked 2026-11-23 in light and dark: react, pin, unpin, delete, member removal dialog (cancelled).</li><li>Open: the reaction bar is still a vertical submenu, not a row of emoji above the message.</li></ul> |
| [ ] | Personal chat | `app/chat/[id].tsx`, `app/chat/index.tsx` → `components/chat/ChatScreen.tsx` | Partial | <ul><li>Native header.</li><li>Full-screen "Loading conversation…" spinner while sending.</li><li>The transcript is a DOM web view with no native long-press menu.</li><li>The composer attachment and tools sheets are JS `BottomSheet`s.</li><li>`DrawerSidebar` is still mounted, but nothing opens it.</li></ul> |
| [x] | Task detail | `app/(tabs)/work/[id].tsx` → `WorkViews.tsx` (`WorkDetailView`) | Native | <ul><li>A SwiftUI `Form`: tap the title or description to edit in place (✓ in the bar saves); the description renders Markdown.</li><li>Status and assignee are menu pickers, dates are switches with compact native date pickers, Depends on is a multi-select menu.</li><li>Mark done and View thread rows, activity list, and a comment field with a send button.</li><li>Checked 2026-11-23 in light and dark: status, assignee, due date, description, comment.</li></ul> |
| [x] | Organization | `app/(tabs)/work/organization.tsx` → `components/work/WorkOrganization.tsx` | Native | Native header and a `Form`: Workspace/Personal segmented picker, Chief of staff and Reports sections; a row opens the agent directly (the agent-detail sheet is gone). Checked 2026-11-23 light and dark. |
| [ ] | File detail | `app/(tabs)/files/file/[id].tsx` | Partial | File options use a JS sheet; use a toolbar menu. |
| [ ] | Note (in Files) | `app/note/[id].tsx` → `components/knowledge/ResourceViews.tsx` note editor | Custom | <ul><li>Manual "Save changes" button in mid-screen.</li><li>Write/Preview switch.</li><li>Edits are lost when you go back.</li></ul>Autosave, use a toolbar Done, and add a native keyboard toolbar for formatting. |
| [ ] | Output detail | `app/(tabs)/files/output/[id].tsx` | Native | Check that the toolbar actions match web (download, share). |
| [ ] | Memory detail | `app/(tabs)/files/memory/[id].tsx` | Partial | Toolbar Save is fine; 3 `Alert.alert` calls. |
| [x] | Settings | `app/settings.tsx` → `components/settings/SettingsScreen.tsx`, `SettingsViews.tsx` | Native | <ul><li>A SwiftUI `Form` home; each section is its own pushed screen (`/settings?section=…`) with system back and swipe-back.</li><li>Appearance and transcription retention are inline native pickers.</li><li>Notifications and Voice use system switches; Billing uses labelled rows; Account has a native name field with Save shown only after an edit.</li><li>Checked 2026-11-22 in light and dark: home, Members, Account (rename saved), Billing, Notifications and its pre-prompt, Voice, Models, Memories.</li><li>Memory, invite, member, delete account, default model, API keys, subscription, conversation notifications and webhooks are pushed native form pages (2026-11-23). Memory add and edit checked end to end.</li></ul> |
| [x] | Settings › Providers | `components/settings/SettingsEditors.tsx` (`provider`, `add-provider`) | Native | Pushed form pages for an API key (status, test, replace key, remove) and Add API key (provider picker, secure key field). Old sheet-in-sheet removed. Checked 2026-11-23. |
| [x] | Settings › Webhooks | `SettingsEditors.tsx` (`WebhooksList`, `webhook`, `add-webhook`) | Native | Form list, pushed detail (enabled switch, deliveries with retry, rotate secret, delete) and Add webhook. Created and disabled a test webhook on the preview 2026-11-23. |
| [x] | Settings › Subscription connection | `SettingsEditors.tsx` (`subscription`) | Native | Pushed form: Just me / Workspace segmented picker and provider rows; sign-in, code and callback steps as form rows. Provider list checked 2026-11-23; a full sign-in was not run. |
| [x] | Settings › Room notifications | `components/settings/RoomNotifications.tsx` (`room`) | Native | Pushed page with an inline level picker; saves through the web mutation and refuses writes after a workspace switch (covered by phase2f). |
| [ ] | Settings › Billing | `SettingsViews.tsx` (billing) | Partial | <ul><li>Fixed: native labelled rows and readable status ("Active", "Not set up").</li><li>Still read-only, with credits as bare numbers and no upgrade or top-up path.</li></ul> |
| [ ] | Automations | `app/automations.tsx` → `components/automations/AutomationBrowserScreen.tsx` | Partial | <ul><li>Native header.</li><li>Empty state is bare text.</li><li>`ResourceSheet` actions.</li></ul> |
| [ ] | Automation detail | `components/automations/AutomationDetailSheet.tsx` | Custom | JS `BottomSheet` and 7 `Alert.alert` calls; make it a pushed page or `pageSheet`. |
| [ ] | Automation editor | `components/automations/AutomationEditorSheet.tsx` | Custom | <ul><li>JS `BottomSheet` with no close button.</li><li>Interval and time are typed text; use native pickers.</li><li>No agent or model choice.</li></ul> |
| [ ] | Automation run | `components/automations/AutomationRunSheet.tsx` | Custom | JS `BottomSheet`. |
| [ ] | Extensions | `app/tools.tsx` → `components/tools/ToolsScreen.tsx` | Partial | <ul><li>Native header and segmented control.</li><li>Skill and app editors use JS `BottomSheet`s.</li><li>10 `Alert.alert` calls.</li><li>Delete has no confirmation.</li><li>`EmptyState` instead of `CreatureEmpty`.</li></ul> |
| [ ] | MCP server detail | `components/tools/McpDetailSheet.tsx` | Custom | JS `BottomSheet` and 7 `Alert.alert` calls. |
| [ ] | Activity | `app/activity.tsx` → `components/chat/ActivityScreen.tsx` | Partial | Native header and segmented control; no swipe to mark read. |
| [x] | Archived | `app/archived.tsx` → `components/chat/ArchivedScreen.tsx` | Native | SwiftUI list with the system search bar and empty state; touch and hold for Unarchive (and Delete for personal chats). Now includes archived channels and DMs (`collaboration.archive.rooms`), which opened as personal chats before or were missing. Checked 2026-11-23: archive a channel, find it, unarchive it. |
| [ ] | Workspace | `app/workspace.tsx` → `components/workspace/WorkspaceScreen.tsx` | Partial | <ul><li>Native header.</li><li>Four JS `BottomSheet`s (member actions, invite, team, billing).</li><li>Ten spinners.</li><li>Unreachable from the UI (see P0 #1 in the parity audit).</li></ul> |
| [ ] | Slack import | `components/workspace/SlackImportPanel.tsx` | Custom | Hand-built steps. |
| [ ] | Voice | `app/voice.tsx` → `components/voice/VoiceScreen.tsx` | Custom | <ul><li>No stack header (the root default hides it).</li><li>`MainScreenHeader` plus `DrawerSidebar`.</li><li>Custom toggles.</li></ul>Give it a native header and a `Form`. |
| [ ] | Notes | `app/notes.tsx` → `components/notes/NotesEditorScreen.tsx`, `NoteEditor.tsx` | Custom | `MainScreenHeader` plus `DrawerSidebar` and no stack header. Only reachable by deep link; remove it or merge it into Files. |
| [ ] | Invitation | `app/invitations/[id].tsx` | Custom | <ul><li>Floating card with no native header.</li><li>Doesn't name the workspace, inviter or role.</li></ul>Use a native header with a `Form` summary and Accept and Decline buttons. |
| [ ] | Shared chat link | `app/share/c/[token].tsx` | Custom | Opens the web page in the in-app browser. |

## 3. Native sheets (routes)

| ✓ | Surface | Route / file | Status | What to fix |
| --- | --- | --- | --- | --- |
| [ ] | Account | `app/account.tsx` (`formSheet`, `@expo/ui` `Form`) | Native | <ul><li>The workspace switcher shows only with 2+ workspaces.</li><li>No Manage or New workspace rows.</li><li>Sign-out logs an unhandled `POP`.</li></ul> |
| [ ] | New agent | `app/agent-create.tsx` (`formSheet`) | Native | First-tap focus on its fields. |
| [ ] | Agent profile | `components/agents/AgentProfileSheet.tsx` (RN `Modal`) | Partial | Make it a `pageSheet` route so it gets native detents and dismissal. |

## 4. JS sheets and modals to convert

Each needs either a native sheet route, an `@expo/ui` `BottomSheet`, or replacing with a menu.

| ✓ | Sheet | File | Opened from | Better native form |
| --- | --- | --- | --- | --- |
| [ ] | Chat options (rename, share, archive, delete, temporary) | `components/chat/ChatActionsSheet.tsx` | Chat header `…` | Toolbar menu |
| [ ] | Composer attach / tools / mode | `components/chat/Composer.tsx` (2 sheets) | Composer `+` and tools chip | Native menu |
| [ ] | Model picker | `components/chat/ModelPicker.tsx` | Composer model chip | `pageSheet` route (already looks right; check the X resets the model) |
| [ ] | Draft review | `components/chat/DraftReviewSheet.tsx` | Draft card | `pageSheet` |
| [x] | New DM / add people | `app/new-message.tsx` → `components/chat/NewConversationForms.tsx` | Chats compose menu, room Members + | `formSheet` route with a searchable people list (2026-11-23); also adds people to a room |
| [x] | New channel | `app/new-channel.tsx` → `components/chat/NewConversationForms.tsx` | Chats compose menu | `formSheet` route with a `Form` (2026-11-23). The old `NewChannelSheet`/`NewDirectMessageSheet` survive only in the dead `DrawerSidebar` |
| [x] | Room message actions | `components/chat/RoomMessageMenu.tsx` | Long-press a message | Context menu (2026-11-23) |
| [x] | Room members / pinned / saved | `components/chat/RoomSheets.tsx` | Room header menu | SwiftUI sheet with detents (2026-11-23) |
| [ ] | Share | `components/workspace/ShareSheet.tsx` | File and chat options | `pageSheet` with a `Form` |
| [ ] | Create workspace | `components/workspace/CreateWorkspaceSheet.tsx` | Old drawer only | `formSheet` route from the account sheet |
| [ ] | Workspace switcher | `components/workspace/WorkspaceSwitcher.tsx` | Old drawer only (dead) | Delete; the account sheet replaces it |
| [ ] | Connect a machine | `components/agents/ConnectMachineSheet.tsx` | Agent editor | `formSheet` |
| [ ] | Agent editor picker | `components/agents/AgentEditorView.tsx` (`SheetModal`) | Edit agent | `@expo/ui` `Picker` in the `Form` |
| [ ] | Agent computer viewer | `components/agents/AgentComputerPreview.tsx` (RN `Modal`) | Agent profile | `fullScreenModal` route |
| [ ] | Upgrade prompt | `components/auth/UpgradePrompt.tsx` (RN `Modal`) | Locked model | `formSheet` |
| [x] | Work new task / schedule / move / organization | `app/(tabs)/work/new.tsx`, `schedule.tsx` → `components/work/WorkForms.tsx` | Work toolbar and task context menu | New task and Schedule are `formSheet` routes with a `Form`, native date pickers and Cancel/✓; Move is the task context menu; `WorkSheet`, `WorkOptions` and `WorkTaskActions` are deleted (2026-11-23) |
| [ ] | Files options / new folder / rename / move | `components/knowledge/ResourceScreens.tsx` (`ResourceSheet`) | Files `+` and file options | Native menu, plus an `Alert.prompt` or `formSheet` for names |
| [x] | Settings pickers | `components/settings/SettingsScreen.tsx` | Settings rows | Done: inline pickers and pushed pages (2026-11-23) |
| [ ] | Search result actions | `components/search/WorkspaceSearchScreen.tsx` (`ResourceSheet`) | Person result | Context menu |
| [ ] | Skill editor / app connect | `components/tools/ToolsScreen.tsx` (3 sheets) | Extensions | `formSheet` routes |

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
- [ ] Add swipe actions: archive a chat, mark Activity read, complete a task.

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
| [ ] | Deep-link routing | `app/+native-intent.tsx`, `lib/incomingLinks.ts` | — | Add `overlay://account` and `/workspace`. |

## Cross-cutting checks for every surface

- [ ] Light and dark mode both work; dark mode uses grey surfaces, not black cards.
- [ ] The title never shows a raw route name.
- [ ] The first tap focuses a text field, and no iOS "AutoFill" bubble appears on non-credential fields.
- [ ] Keyboard: the field and its submit button stay visible, and the keyboard dismisses on scroll.
- [ ] Every button and row has an accessibility label.
- [ ] Haptics fire on selection and on success.
- [ ] Loading never blanks a screen that has cached data.
- [ ] Empty and error states use `CreatureEmpty`, centred in the visible area, with a Retry where it applies.
