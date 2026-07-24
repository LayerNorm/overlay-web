# Browser Panel Implementation Roadmap

A comprehensive plan for implementing a full-fledged browser overlay in Overlay using Electron's Chromium engine.

## Overview

The Browser Panel will be a fourth overlay type alongside Chat, Transcription, and Notebook panels. It enables users to surf the web in an always-on-top overlay window, toggled via hotkey (default: `Cmd + \`) or the Globe button in the bottom overlay bar.

---

## Phase 1: Foundation & Basic Shell

### 1.1 Create BrowserPanel Component

**File:** `src/renderer/src/pages/BrowserPanel.tsx`

```text
// Core structure similar to ChatPanel/NotebookPanel
- Panel container with theme support (usePanelTheme)
- Header with close, content protection, drag handle buttons
- Main content area for webview
- Footer for status bar (optional)
```

**Key Features:**

- Reuse existing panel patterns (opacity, dynamic opacity, content protection)
- Integrate with existing panel lifecycle (registerOpenItem, getOpenItems)
- Support multiple windows via itemId pattern

### 1.2 Create Browser Window Manager (Main Process)

**File:** `src/main/browserManager.ts`

```typescript
interface BrowserTab {
  id: string
  webContentsId: number
  url: string
  title: string
  favicon?: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

interface BrowserSession {
  tabs: BrowserTab[]
  activeTabId: string
  history: HistoryEntry[]
}
```

### 1.3 Update Main Process Panel Management

**File:** `src/main/panelManager.ts` or equivalent

- Add 'browser' to panel types
- Handle `togglePanelWindow('browser', ...)`
- Register browser panel hotkey (`Cmd + \`)
- Implement `isPanelVisible('browser')`

### 1.4 Update Bridge Types

**File:** `src/preload/index.d.ts` or bridge types file

```typescript
interface Bridge {
  // Existing...
  updateBrowserPanelHotkey(hotkey: string): void

  // Browser-specific
  browser: {
    createTab(url?: string): Promise<{ tabId: string }>
    closeTab(tabId: string): Promise<void>
    switchTab(tabId: string): Promise<void>
    navigate(tabId: string, url: string): Promise<void>
    goBack(tabId: string): Promise<void>
    goForward(tabId: string): Promise<void>
    reload(tabId: string): Promise<void>
    stop(tabId: string): Promise<void>
    getTabInfo(tabId: string): Promise<BrowserTab>
    getAllTabs(): Promise<BrowserTab[]>

    // Events
    onTabCreated(callback: (tab: BrowserTab) => void): () => void
    onTabUpdated(callback: (tabId: string, changes: Partial<BrowserTab>) => void): () => void
    onTabClosed(callback: (tabId: string) => void): () => void
    onNavigationStart(callback: (tabId: string, url: string) => void): () => void
    onNavigationComplete(callback: (tabId: string, url: string) => void): () => void
  }
}
```

---

## Phase 2: Core Browser UI Components

### 2.1 Browser Header / Toolbar

**File:** `src/renderer/src/components/browser/BrowserToolbar.tsx`

```
┌─────────────────────────────────────────────────────────────────────┐
│ [←] [→] [↻/✕] │ 🔒 https://example.com__________________ │ [⋯] [✕] │
└─────────────────────────────────────────────────────────────────────┘
```

**Components:**

- **NavigationButtons** - Back, Forward, Reload/Stop
- **Omnibox** - URL input with autocomplete, search suggestions
- **SecurityIndicator** - Lock icon, certificate info
- **MenuButton** - Settings, downloads, history, etc.
- **CloseButton** - Close panel

### 2.2 Tab Bar

**File:** `src/renderer/src/components/browser/BrowserTabBar.tsx`

```
┌──────────────────────────────────────────────────────────────────┐
│ [favicon] Tab Title [✕] │ [favicon] Tab 2 [✕] │ [+]              │
└──────────────────────────────────────────────────────────────────┘
```

**Features:**

- Draggable tabs for reordering
- Tab overflow with scroll or dropdown
- New tab button
- Tab context menu (duplicate, pin, mute, close others)
- Active tab indicator
- Tab close button with hover state

### 2.3 Omnibox / Address Bar

**File:** `src/renderer/src/components/browser/Omnibox.tsx`

**Features:**

- URL display with domain highlight
- Search/URL detection (auto-prefix https://, detect search queries)
- Autocomplete dropdown:
  - History suggestions
  - Bookmarks
  - Search suggestions (optional, requires search API)
- Security indicator (HTTPS lock, certificate warnings)
- Clear button
- Keyboard navigation (Enter to navigate, Escape to cancel)

### 2.4 Loading Indicator

**File:** `src/renderer/src/components/browser/LoadingIndicator.tsx`

- Progress bar under toolbar (like Chrome)
- Spinner in tab favicon during load
- Loading state in omnibox

---

## Phase 3: WebView Integration

### 3.1 WebView Container

**File:** `src/renderer/src/components/browser/BrowserWebView.tsx`

**Using Electron's `<webview>` tag or BrowserView:**

```typescript
// Option A: webview tag (simpler, runs in renderer)
<webview
  src={url}
  partition="persist:browser"
  webpreferences="contextIsolation=yes"
  // ... event handlers
/>

// Option B: BrowserView (more isolated, managed from main)
// Requires IPC for all interactions
```

**Recommendation:** Use `<webview>` tag for easier integration with React, but configure with strict security settings.

### 3.2 WebView Event Handling

```typescript
// Navigation events
webview.addEventListener('did-start-loading', ...)
webview.addEventListener('did-stop-loading', ...)
webview.addEventListener('did-finish-load', ...)
webview.addEventListener('did-fail-load', ...)
webview.addEventListener('did-navigate', ...)
webview.addEventListener('did-navigate-in-page', ...)

// Title/favicon updates
webview.addEventListener('page-title-updated', ...)
webview.addEventListener('page-favicon-updated', ...)

// New window handling
webview.addEventListener('new-window', ...) // Open in new tab or external

// Context menu
webview.addEventListener('context-menu', ...)

// Find in page
webview.addEventListener('found-in-page', ...)

// Console messages (for debugging)
webview.addEventListener('console-message', ...)
```

### 3.3 Security Configuration

```typescript
// webPreferences for webview
{
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
}

// Session partition for isolation
partition: 'persist:overlay-browser'
```

---

## Phase 4: Persistent Profile & Storage

### 4.1 Session Management

**File:** `src/main/browserSession.ts`

```typescript
// Use Electron's session API for persistent storage
const browserSession = session.fromPartition('persist:overlay-browser')

// Configure session
browserSession.setPermissionRequestHandler(...)
browserSession.setPermissionCheckHandler(...)
browserSession.webRequest.onBeforeRequest(...)
```

### 4.2 History Storage

**File:** `src/main/browserHistory.ts`

```typescript
interface HistoryEntry {
  id: string
  url: string
  title: string
  favicon?: string
  visitedAt: number
  visitCount: number
}

// Storage: SQLite or JSON file in userData
// Location: app.getPath('userData') + '/browser/history.json'
```

**Features:**

- Record visits with timestamps
- Deduplicate by URL, increment visit count
- Search history by title/URL
- Clear history (all, last hour, last day, date range)
- Export/import history

### 4.3 Bookmarks (Optional - Phase 5+)

**File:** `src/main/browserBookmarks.ts`

```typescript
interface Bookmark {
  id: string
  url: string
  title: string
  favicon?: string
  folderId?: string
  createdAt: number
}

interface BookmarkFolder {
  id: string
  name: string
  parentId?: string
}
```

### 4.4 Downloads Manager

**File:** `src/main/browserDownloads.ts`

```typescript
interface Download {
  id: string
  url: string
  filename: string
  savePath: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
  endTime?: number
}
```

**Implementation:**

```typescript
// In main process
browserSession.on('will-download', (event, item, webContents) => {
  // Set save path (show dialog or use default)
  item.setSavePath(...)

  // Track progress
  item.on('updated', (event, state) => {
    // Send progress to renderer
  })

  item.on('done', (event, state) => {
    // Notify completion
  })
})
```

**UI Component:** `src/renderer/src/components/browser/DownloadsPanel.tsx`

- List of downloads with progress
- Open file / Show in folder
- Cancel / Pause / Resume
- Clear completed

---

## Phase 5: Advanced Features

### 5.1 Find in Page

**File:** `src/renderer/src/components/browser/FindBar.tsx`

```
┌─────────────────────────────────────────────┐
│ [🔍] Find in page... │ 3/15 │ [↑] [↓] [✕]  │
└─────────────────────────────────────────────┘
```

**Implementation:**

```typescript
// Trigger find
webview.findInPage(searchText, { forward: true, findNext: false })

// Handle results
webview.addEventListener('found-in-page', (event) => {
  const { activeMatchOrdinal, matches } = event.result
  // Update UI: "3/15"
})

// Stop find
webview.stopFindInPage('clearSelection')
```

**Keyboard shortcuts:**

- `Cmd+F` - Open find bar
- `Enter` - Find next
- `Shift+Enter` - Find previous
- `Escape` - Close find bar

### 5.2 Permission Prompts

**File:** `src/renderer/src/components/browser/PermissionPrompt.tsx`

```
┌────────────────────────────────────────────────┐
│ 📍 example.com wants to know your location     │
│                                                │
│              [Block]  [Allow]                  │
└────────────────────────────────────────────────┘
```

**Permissions to handle:**

- Geolocation
- Notifications
- Camera/Microphone
- Clipboard read/write
- MIDI
- Pointer lock

**Implementation:**

```typescript
// In main process
browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
  // Send to renderer for user prompt
  // Store decision if "remember" checked
  callback(userDecision)
})
```

### 5.3 Context Menu

**File:** `src/renderer/src/components/browser/BrowserContextMenu.tsx`

**Menu items based on context:**

- **Link:** Open, Open in new tab, Copy link
- **Image:** Save image, Copy image, Open image in new tab
- **Selection:** Copy, Search with Google
- **Page:** Back, Forward, Reload, Save page as
- **Editable:** Undo, Redo, Cut, Copy, Paste, Select all

### 5.4 DevTools (Optional)

```typescript
// Toggle DevTools for active webview
webview.openDevTools()
webview.closeDevTools()
webview.isDevToolsOpened()
```

---

## Phase 6: Keyboard Shortcuts

### 6.1 Global Shortcuts (when browser panel focused)

| Shortcut          | Action                        |
| ----------------- | ----------------------------- |
| `Cmd + \`         | Toggle browser panel          |
| `Cmd + T`         | New tab                       |
| `Cmd + W`         | Close tab                     |
| `Cmd + Shift + T` | Reopen closed tab             |
| `Cmd + L`         | Focus omnibox                 |
| `Cmd + R`         | Reload                        |
| `Cmd + Shift + R` | Hard reload                   |
| `Cmd + F`         | Find in page                  |
| `Cmd + [`         | Go back                       |
| `Cmd + ]`         | Go forward                    |
| `Cmd + 1-8`       | Switch to tab N               |
| `Cmd + 9`         | Switch to last tab            |
| `Cmd + Shift + [` | Previous tab                  |
| `Cmd + Shift + ]` | Next tab                      |
| `Escape`          | Stop loading / Close find bar |

### 6.2 Omnibox Shortcuts

| Shortcut      | Action                       |
| ------------- | ---------------------------- |
| `Enter`       | Navigate to URL/search       |
| `Cmd + Enter` | Open in new tab              |
| `Escape`      | Cancel, restore original URL |
| `↑/↓`         | Navigate suggestions         |

---

## Phase 7: Integration & Polish

### 7.1 Settings Integration

**File:** `src/renderer/src/components/settings/BrowserSettings.tsx`

**Settings to add:**

- Default search engine
- Default homepage / new tab page
- Clear browsing data button
- Download location
- Enable/disable JavaScript (per-site?)
- Block popups toggle
- Hardware acceleration toggle

### 7.2 Panel State Persistence

**File:** `src/main/browserState.ts`

```typescript
interface BrowserPanelState {
  windowBounds: { x: number; y: number; width: number; height: number }
  tabs: { id: string; url: string; title: string }[]
  activeTabId: string
}

// Save on panel close
// Restore on panel open
```

### 7.3 New Tab Page (Optional)

**File:** `src/renderer/src/components/browser/NewTabPage.tsx`

- Search bar
- Most visited sites (from history)
- Recently closed tabs
- Bookmarks bar

### 7.4 Error Pages

**File:** `src/renderer/src/components/browser/ErrorPage.tsx`

- Connection failed
- DNS resolution failed
- SSL certificate error
- Page not found

---

## Implementation Order (Recommended)

### Sprint 1: Minimal Viable Browser (1-2 weeks)

1. ✅ Settings foundation (browserPanelHotkey) - **DONE**
2. ✅ Globe button in overlay - **DONE**
3. Create `BrowserPanel.tsx` basic shell
4. Add 'browser' to main process panel management
5. Single-tab webview with basic navigation
6. Omnibox with URL input (no autocomplete yet)
7. Back/Forward/Reload buttons

### Sprint 2: Tab Management (1 week)

1. Tab bar UI
2. Create/close/switch tabs
3. Tab state management in main process
4. Tab persistence across sessions

### Sprint 3: History & Downloads (1 week)

1. History recording and storage
2. History UI (sidebar or menu)
3. Download handling
4. Downloads panel UI

### Sprint 4: Find & Permissions (1 week)

1. Find in page bar
2. Permission request handling
3. Permission prompt UI
4. Permission storage

### Sprint 5: Polish & Advanced (1 week)

1. Context menus
2. Keyboard shortcuts
3. Loading indicators
4. Error pages
5. Settings panel completion

---

## File Structure

```
src/
├── main/
│   ├── browser/
│   │   ├── browserManager.ts      # Main browser orchestration
│   │   ├── browserSession.ts      # Session configuration
│   │   ├── browserHistory.ts      # History storage
│   │   ├── browserDownloads.ts    # Download manager
│   │   └── browserPermissions.ts  # Permission handling
│   └── panelManager.ts            # Update to include 'browser'
│
├── preload/
│   └── index.ts                   # Add browser bridge methods
│
└── renderer/src/
    ├── pages/
    │   └── BrowserPanel.tsx       # Main browser panel
    │
    ├── components/
    │   └── browser/
    │       ├── BrowserToolbar.tsx
    │       ├── BrowserTabBar.tsx
    │       ├── BrowserTab.tsx
    │       ├── Omnibox.tsx
    │       ├── BrowserWebView.tsx
    │       ├── FindBar.tsx
    │       ├── DownloadsPanel.tsx
    │       ├── HistoryPanel.tsx
    │       ├── PermissionPrompt.tsx
    │       ├── BrowserContextMenu.tsx
    │       ├── LoadingIndicator.tsx
    │       ├── NewTabPage.tsx
    │       └── ErrorPage.tsx
    │
    ├── hooks/
    │   ├── useBrowserTabs.ts
    │   ├── useBrowserNavigation.ts
    │   └── useBrowserHistory.ts
    │
    └── utils/
        └── browserStorage.ts      # localStorage helpers for browser
```

---

## Security Considerations

1. **Session Isolation:** Use dedicated partition `persist:overlay-browser`
2. **Context Isolation:** Always enabled for webviews
3. **No Node Integration:** webview should never have node access
4. **Permission Prompts:** Never auto-grant sensitive permissions
5. **Certificate Validation:** Warn on invalid certificates
6. **Content Security:** Block mixed content by default
7. **Navigation Validation:** Prevent navigation to file:// or chrome:// URLs

---

## Testing Checklist

- [ ] Panel opens/closes via hotkey
- [ ] Panel opens/closes via Globe button
- [ ] URL navigation works
- [ ] Back/Forward navigation works
- [ ] Reload/Stop works
- [ ] Tab creation/closing works
- [ ] Tab switching works
- [ ] History is recorded
- [ ] Downloads work
- [ ] Find in page works
- [ ] Permission prompts appear
- [ ] Content protection toggle works
- [ ] Panel state persists across restarts
- [ ] Multiple browser windows work
- [ ] Keyboard shortcuts work
- [ ] Context menus work

---

## Dependencies

**No additional npm packages required** - Electron provides all browser capabilities via:

- `WebContentsView` (preferred) - Modern replacement for deprecated BrowserView
- `webContents` API for navigation control
- `webFrameMain` API for frame management
- `session` API for storage/cookies
- `DownloadItem` API for downloads

### WebContentsView vs BrowserView vs webview

| Feature              | WebContentsView | BrowserView (deprecated) | webview tag      |
| -------------------- | --------------- | ------------------------ | ---------------- |
| Modern API           | ✅ Yes          | ❌ No (deprecated)       | ⚠️ Legacy        |
| Main process control | ✅ Yes          | ✅ Yes                   | ❌ Renderer only |
| Better isolation     | ✅ Yes          | ✅ Yes                   | ⚠️ Limited       |
| Flexible positioning | ✅ Yes          | ✅ Yes                   | ❌ No            |
| Recommended          | ✅ Yes          | ❌ No                    | ⚠️ Simple cases  |

**Current Implementation:** Uses `<webview>` tag for Sprint 1 simplicity. Future sprints will migrate to `WebContentsView` for better control.

**References:**

- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/api/web-contents
- https://www.electronjs.org/docs/latest/api/web-frame-main

---

## Notes

- The implementation leverages Electron's built-in Chromium engine
- No external browser engine needed
- Storage uses Electron's persistent partition system
- UI follows existing Overlay design patterns (usePanelTheme, etc.)
- Integration with existing panel management system

---

## Completed Steps

### Phase 0: Foundation (COMPLETED)

- [x] Added `browserPanelHotkey` to Settings interface with default `Cmd + \`
- [x] Created `BrowserSettings.tsx` component
- [x] Added `BrowserIcon` to icons
- [x] Added Browser tab to `SettingsPage.tsx`
- [x] Added Globe button to `OverlayWindow.tsx` overlay bar
- [x] Updated types to include 'browser' panel type

### Sprint 1: Basic Browser Shell (COMPLETED)

- [x] Updated `hotkey-manager.ts` to add 'browser' to `PanelToggleMode`
- [x] Updated `main/index.ts` PanelType to include 'browser'
- [x] Added browser to `hiddenPanelWindows` tracking
- [x] Updated `getAllPanelWindows()` to support 'browser'
- [x] Updated `togglePanelVisibility()` to support 'browser'
- [x] Updated `panel:toggle` IPC handler to support 'browser'
- [x] Updated `panel:isVisible` IPC handler to support 'browser'
- [x] Added browser panel title in `createPanelWindow()`
- [x] Added `settings:update-browser-panel-hotkey` IPC handler
- [x] Updated `preload/index.ts` bridge with browser support
- [x] Updated `preload/index.d.ts` types with browser support
- [x] Created `BrowserPanel.tsx` with basic webview navigation
- [x] Added BrowserPanel to `App.tsx` routing
- [x] Fixed OverlayWindow button sizing (reduced to fit 4 buttons)

### Sprint 2: WebContentsView Migration & Features (COMPLETED)

- [x] Created `BrowserManager` service (`src/main/services/browser-manager.ts`)
  - WebContentsView management for each tab
  - Tab lifecycle (create, close, switch)
  - Navigation control (back, forward, reload, stop, navigate)
  - History recording and persistence
  - Download handling with progress tracking
- [x] Registered BrowserManager IPC handlers via `registerBrowserIPC()`
- [x] Integrated BrowserManager with `createPanelWindow()` for browser panels
- [x] Updated preload bridge with full browser API:
  - Tab management methods
  - Navigation methods
  - History methods
  - Download methods
  - Event listeners for tab/download updates
- [x] Updated `BrowserPanel.tsx` to use IPC instead of webview:
  - Tab bar with create/close/switch functionality
  - Navigation toolbar with IPC-based controls
  - History panel (slide-out)
  - Downloads panel (slide-out) with progress bars
  - Status bar showing page title
- [x] Added `BrowserTab`, `HistoryEntry`, `DownloadInfo` type definitions
