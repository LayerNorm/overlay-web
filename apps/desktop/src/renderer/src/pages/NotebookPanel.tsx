import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  Eye,
  EyeOff,
  Keyboard,
  Lock,
  MessageCircle,
  PanelLeft,
  SquarePen,
  Unlock,
} from 'lucide-react'
import {
  NotebookHeader,
  type NotebookEditorHeaderRenderProps,
} from '@overlay/modules-react/notes'
import DockablePanel from '../components/DockablePanel'
import { useDockableDrag } from '../components/DockablePanelContext'
import { OptionDragOverlay } from '../components/OptionDragOverlay'
import { ShortcutsMenu } from '../components/ShortcutsMenu'
import { FindBar } from '../components/ui/FindBar'
import { PanelFrameBorder } from '../components/panel/PanelFrameBorder'
import { ChatHeader, type Tab as NotebookTab } from '../components/chat/ChatHeader'
import { panelThemeToSharedCssVars } from '../components/chat/themeBridge'
import { usePanelTheme } from '../hooks/usePanelTheme'
import { DesktopNotebookEditor } from '../features/notebook/DesktopNotebookEditor'
import { createDesktopNotebookRepository } from '../features/notebook/desktopNotebookRepository'
import overlayLogoUrl from '../../../../resources/logos/overlay-chat-mark.png'

function readPanelSettings(): {
  opacity: number
  dynamicOpacity: boolean
  accessTabsInSidebar: boolean
} {
  try {
    const settings = JSON.parse(localStorage.getItem('overlay-settings') || '{}') as {
      notebookPanelOpacity?: number
      dynamicOpacity?: boolean
      accessTabsInSidebar?: boolean
    }
    return {
      opacity: settings.notebookPanelOpacity ?? 95,
      dynamicOpacity: settings.dynamicOpacity ?? false,
      accessTabsInSidebar: settings.accessTabsInSidebar ?? false,
    }
  } catch {
    return { opacity: 95, dynamicOpacity: false, accessTabsInSidebar: false }
  }
}

function DraggableSpacer(): React.ReactElement<any> {
  const { startDrag } = useDockableDrag()
  return (
    <div
      onMouseDown={startDrag}
      className="h-9 min-w-8 flex-1"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
    />
  )
}

const CONTROL_CLASS =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'

export function NotebookPanel(): React.ReactElement<any> {
  const { theme } = usePanelTheme()
  const initialSettings = readPanelSettings()
  const [isProtected, setIsProtected] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [headerLocked, setHeaderLocked] = useState(true)
  const [isPanelHovered, setIsPanelHovered] = useState(true)
  const [isFocused, setIsFocused] = useState(true)
  const [isOptionHeld, setIsOptionHeld] = useState(false)
  const [showSidebar, setShowSidebar] = useState(initialSettings.accessTabsInSidebar)
  const [isSidebarClosing, setIsSidebarClosing] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(200)
  const [accessTabsInSidebar, setAccessTabsInSidebar] = useState(
    initialSettings.accessTabsInSidebar,
  )
  const [showShortcutsMenu, setShowShortcutsMenu] = useState(false)
  const [showFindBar, setShowFindBar] = useState(false)
  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [tabs, setTabs] = useState<NotebookTab[]>([])
  const [createNoteRequest, setCreateNoteRequest] = useState(0)
  const [panelOpacity, setPanelOpacity] = useState(initialSettings.opacity)
  const [dynamicOpacity, setDynamicOpacity] = useState(initialSettings.dynamicOpacity)
  const editorContentRef = useRef<HTMLDivElement>(null)
  const notesSearchInputRef = useRef<HTMLInputElement>(null)
  const replaceActiveTabOnNextNoteRef = useRef<string | null>(null)
  const repository = useMemo(() => createDesktopNotebookRepository(), [])

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== 'overlay-settings') return
      const settings = readPanelSettings()
      setPanelOpacity(settings.opacity)
      setDynamicOpacity(settings.dynamicOpacity)
      setAccessTabsInSidebar(settings.accessTabsInSidebar)
      setShowSidebar(settings.accessTabsInSidebar)
      setIsSidebarClosing(false)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const focus = (): void => setIsFocused(true)
    const blur = (): void => {
      setIsFocused(false)
      setIsOptionHeld(false)
    }
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
    }
  }, [])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => {
      if (event.altKey) setIsOptionHeld(true)
    }
    const keyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Alt' || !event.altKey) setIsOptionHeld(false)
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
    }
  }, [])

  const frameVisible = headerLocked || isPanelHovered
  const toggleProtection = (): void => {
    const next = !isProtected
    setIsProtected(next)
    void window.bridge.setContentProtection('notebook', next)
  }

  const closeSidebarAnimated = useCallback((): void => {
    if (accessTabsInSidebar) {
      setShowSidebar(false)
      return
    }
    setIsSidebarClosing(true)
    window.setTimeout(() => {
      setShowSidebar(false)
      setIsSidebarClosing(false)
    }, 150)
  }, [accessTabsInSidebar])

  const closeNotebookTab = useCallback((noteId: string): void => {
    localStorage.setItem('overlay-last-closed-note-id', noteId)
    if (tabs.length <= 1) {
      void window.bridge.destroyPanel()
      return
    }
    const closingIndex = tabs.findIndex((tab) => tab.id === noteId)
    const remaining = tabs.filter((tab) => tab.id !== noteId)
    setTabs(remaining)
    if (noteId === activeNoteId) {
      setActiveNoteId(remaining[Math.min(closingIndex, remaining.length - 1)]?.id ?? null)
    }
  }, [activeNoteId, tabs])

  const requestNewNoteInCurrentTab = useCallback((): void => {
    replaceActiveTabOnNextNoteRef.current = activeNoteId
    setCreateNoteRequest((request) => request + 1)
  }, [activeNoteId])

  const requestNewNoteInNewTab = useCallback((): void => {
    replaceActiveTabOnNextNoteRef.current = null
    setCreateNoteRequest((request) => request + 1)
  }, [])

  const createNoteInNewWindow = useCallback(async (): Promise<void> => {
    const note = await repository.create()
    await window.bridge.openInNewWindow('notebook', note._id)
  }, [repository])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const command = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (command && event.shiftKey && key === 'w') {
        event.preventDefault()
        window.bridge.closeCurrentWindow()
        return
      }

      if (command && event.shiftKey && key === 't') {
        event.preventDefault()
        const lastClosedNoteId = localStorage.getItem('overlay-last-closed-note-id')
        if (lastClosedNoteId) setActiveNoteId(lastClosedNoteId)
        return
      }

      if (command && event.shiftKey && key === 'n') {
        event.preventDefault()
        const lastClosedNoteId = localStorage.getItem('overlay-last-closed-note-id')
        if (lastClosedNoteId) void window.bridge.openInNewWindow('notebook', lastClosedNoteId)
        return
      }

      if (command && event.shiftKey && key === 's') {
        event.preventDefault()
        if (showSidebar) closeSidebarAnimated()
        else setShowSidebar(true)
        return
      }

      if (command && !event.shiftKey && key === 'e') {
        event.preventDefault()
        requestNewNoteInCurrentTab()
        return
      }

      if (command && !event.shiftKey && key === 'n') {
        event.preventDefault()
        void createNoteInNewWindow()
        return
      }

      if (command && !event.shiftKey && key === 't') {
        event.preventDefault()
        requestNewNoteInNewTab()
        return
      }

      if (command && !event.shiftKey && key === 'w') {
        event.preventDefault()
        if (activeNoteId) closeNotebookTab(activeNoteId)
        else void window.bridge.destroyPanel()
        return
      }

      if (command && !event.shiftKey && key === 'm') {
        event.preventDefault()
        setAgentPanelOpen((open) => !open)
        return
      }

      if (command && !event.shiftKey && key === 'k') {
        event.preventDefault()
        setShowSidebar(true)
        window.setTimeout(() => notesSearchInputRef.current?.focus(), 100)
        return
      }

      if (command && !event.shiftKey && key === 'l') {
        event.preventDefault()
        setShowShortcutsMenu((open) => !open)
        return
      }

      if (command && !event.shiftKey && key === 'f') {
        event.preventDefault()
        setShowFindBar((open) => !open)
        return
      }

      if (command && !event.shiftKey && key >= '1' && key <= '8') {
        event.preventDefault()
        const tab = tabs[Number.parseInt(key, 10) - 1]
        if (tab) setActiveNoteId(tab.id)
        return
      }

      if (command && !event.shiftKey && key === '9') {
        event.preventDefault()
        const tab = tabs.at(-1)
        if (tab) setActiveNoteId(tab.id)
        return
      }

      if (event.key === 'Escape') {
        if (showFindBar) {
          event.preventDefault()
          setShowFindBar(false)
        } else if (showShortcutsMenu) {
          event.preventDefault()
          setShowShortcutsMenu(false)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeNoteId,
    closeNotebookTab,
    closeSidebarAnimated,
    createNoteInNewWindow,
    requestNewNoteInCurrentTab,
    requestNewNoteInNewTab,
    showFindBar,
    showShortcutsMenu,
    showSidebar,
    tabs,
  ])

  const renderPanelHeader = (header: NotebookEditorHeaderRenderProps): React.ReactNode => {
    if (accessTabsInSidebar) {
      return (
        <NotebookHeader
          activeNote={header.activeNote}
          loading={header.loading}
          compact
          title={header.title}
          isDirty={header.isDirty}
          agentPanelOpen={header.agentPanelOpen}
          hideBackButton
          hideActions
          onBackToFiles={() => undefined}
          onCreateNote={header.onCreateNote}
          onTitleChange={(event) => header.onTitleChange(event.target.value)}
          onTitleBlur={header.onTitleBlur}
          onTitleKeyDown={header.onTitleKeyDown}
          onToggleAgentPanel={header.onToggleAgentPanel}
        />
      )
    }
    const headerTabs = tabs.length > 0
      ? tabs.map((tab) => tab.id === header.activeNote?._id
        ? { ...tab, title: header.title || 'Untitled' }
        : tab)
      : header.activeNote
        ? [{ id: header.activeNote._id, title: header.title || 'Untitled' }]
      : header.loading
        ? [{ id: 'loading-note', title: 'Loading…' }]
        : []
    const headerActiveNoteId = header.activeNote?._id ?? activeNoteId ?? headerTabs[0]?.id ?? null

    return (
      <ChatHeader
        isProtected={isProtected}
        toggleContentProtection={toggleProtection}
        onNewInNewTab={header.onCreateNote}
        onClose={() => {
          void window.bridge.destroyPanel()
        }}
        onMinimize={() => {
          void window.bridge.hidePanel('notebook')
        }}
        onMaximize={() => {
          void window.bridge.maximizePanel().then((result) => {
            if (result.success) setIsMaximized(result.isMaximized)
          })
        }}
        isMaximized={isMaximized}
        onShowShortcuts={() => setShowShortcutsMenu(true)}
        theme={theme}
        tabs={headerTabs}
        activeTabId={headerActiveNoteId}
        onSelectTab={setActiveNoteId}
        onCloseTab={closeNotebookTab}
        onRenameTab={(_noteId, title) => {
          setTabs((current) => current.map((tab) => tab.id === _noteId ? { ...tab, title } : tab))
          header.onTitleChange(title)
          header.onTitleBlur()
        }}
        onReorderTabs={(fromIndex, toIndex) => {
          setTabs((current) => {
            const reordered = [...current]
            const [moved] = reordered.splice(fromIndex, 1)
            if (moved) reordered.splice(toIndex, 0, moved)
            return reordered
          })
        }}
        chatTitle={header.title}
        setChatTitle={header.onTitleChange}
        isEditingTitle={isEditingTitle}
        setIsEditingTitle={setIsEditingTitle}
        showSidebar={showSidebar}
        onToggleSidebar={() => {
          if (showSidebar) closeSidebarAnimated()
          else setShowSidebar(true)
        }}
        headerLocked={headerLocked}
        onToggleHeaderLock={() => setHeaderLocked((locked) => !locked)}
        isPanelHovered={isPanelHovered}
      />
    )
  }

  return (
    <DockablePanel
      panelType="notebook"
      defaultWidth={760}
      defaultHeight={720}
      panelBg={theme.panelBgOpacity(panelOpacity)}
      frameTransparent={!frameVisible}
      extraWidthLeft={accessTabsInSidebar && showSidebar ? sidebarWidth : 0}
      extraWidthRight={agentPanelOpen ? 400 : 0}
    >
      <div
        onMouseEnter={() => setIsPanelHovered(true)}
        onMouseLeave={() => setIsPanelHovered(false)}
        className="shared-app-scope relative flex h-full w-full flex-col overflow-hidden"
        style={{
          ...panelThemeToSharedCssVars(theme, overlayLogoUrl),
          boxSizing: 'border-box',
          background: frameVisible
            ? `linear-gradient(${theme.surfaceBg}, ${theme.surfaceBg}), ${theme.panelBg}`
            : 'transparent',
          borderRadius: 'var(--dockable-border-radius, 12px)',
          borderWidth: 'var(--dockable-border-width, 1px)',
          borderStyle: 'solid',
          borderColor: frameVisible ? theme.border : 'transparent',
          boxShadow: frameVisible ? `inset 0 0 0 1px ${theme.border}` : 'none',
          opacity: dynamicOpacity && !isFocused && headerLocked ? 0.5 : 1,
          transition: 'opacity 0.2s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.15s ease',
        }}
      >
        <OptionDragOverlay isOptionHeld={isOptionHeld} />
        <PanelFrameBorder visible={frameVisible} color={theme.border} />

        {accessTabsInSidebar ? (
          <div
            className="h-2 shrink-0"
            style={{ WebkitAppRegion: 'drag' } as CSSProperties}
          />
        ) : null}

        <div
          className="min-h-0 flex-1 overflow-hidden"
          style={{
            margin: frameVisible ? '0 8px' : 0,
            borderRadius: frameVisible ? 8 : 'var(--dockable-border-radius, 12px)',
            transition: 'margin 0.2s ease-out, border-radius 0.2s ease-out',
          }}
        >
          <DesktopNotebookEditor
            noteId={activeNoteId}
            showNotesSidebar={showSidebar || isSidebarClosing}
            hideBackButton
            compactHeader
            contentContainerRef={editorContentRef}
            notesSearchInputRef={notesSearchInputRef}
            controlledAgentPanelOpen={agentPanelOpen}
            createNoteRequest={createNoteRequest}
            onNotesSidebarClose={closeSidebarAnimated}
            onAgentPanelOpenChange={setAgentPanelOpen}
            onNavigateNote={setActiveNoteId}
            onActiveNoteChange={(note) => {
              setActiveNoteId(note._id)
              setTabs((current) => {
                const replaceId = replaceActiveTabOnNextNoteRef.current
                if (replaceId) replaceActiveTabOnNextNoteRef.current = null
                if (replaceId && replaceId !== note._id) {
                  const withoutNewNote = current.filter((tab) => tab.id !== note._id)
                  const replaceIndex = withoutNewNote.findIndex((tab) => tab.id === replaceId)
                  if (replaceIndex >= 0) {
                    const next = [...withoutNewNote]
                    next[replaceIndex] = { id: note._id, title: note.title || 'Untitled' }
                    return next
                  }
                }
                const existing = current.find((tab) => tab.id === note._id)
                if (existing) {
                  return current.map((tab) => tab.id === note._id
                    ? { ...tab, title: note.title || 'Untitled' }
                    : tab)
                }
                return [...current, { id: note._id, title: note.title || 'Untitled' }]
              })
            }}
            renderHeader={renderPanelHeader}
            panelSidebar={{
              accessTabsInSidebar,
              closing: isSidebarClosing,
              width: sidebarWidth,
              panelOpacity,
              frameVisible,
              openTabs: tabs,
              onRequestClose: closeSidebarAnimated,
              onOpenChange: setShowSidebar,
              onWidthChange: setSidebarWidth,
              onSelectTab: setActiveNoteId,
              onCloseTab: closeNotebookTab,
            }}
          />
        </div>

        <FindBar
          isOpen={showFindBar}
          onClose={() => setShowFindBar(false)}
          containerRef={editorContentRef}
          placeholder="Find in note..."
          theme={theme}
        />

        <div
          className="shrink-0 px-4 pb-2 pt-1 transition-opacity"
          style={{
            opacity: frameVisible ? 1 : 0,
            pointerEvents: frameVisible ? 'auto' : 'none',
          }}
        >
          <div
            className="flex min-h-9 items-center gap-1"
            style={{ WebkitAppRegion: 'drag' } as CSSProperties}
          >
            {accessTabsInSidebar ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowSidebar((open) => !open)}
                  title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
                  aria-pressed={showSidebar}
                  className={CONTROL_CLASS}
                  style={{
                    WebkitAppRegion: 'no-drag',
                    background: showSidebar ? theme.surfaceBgActive : 'transparent',
                    color: showSidebar ? theme.text : theme.textMuted,
                  } as CSSProperties}
                >
                  <PanelLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowShortcutsMenu(true)}
                  title="Keyboard shortcuts"
                  className={CONTROL_CLASS}
                  style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
                >
                  <Keyboard size={16} />
                </button>
              </>
            ) : null}

            <DraggableSpacer />

            <button
              type="button"
              onClick={requestNewNoteInNewTab}
              title="New note"
              className={CONTROL_CLASS}
              style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
            >
              <SquarePen size={16} />
            </button>
            {accessTabsInSidebar ? (
              <>
                <button
                  type="button"
                  onClick={toggleProtection}
                  title={isProtected ? 'Show in screenshots' : 'Hide from screenshots'}
                  className={`${CONTROL_CLASS} ${isProtected ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
                  style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
                >
                  {isProtected ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button
                  type="button"
                  onClick={() => setHeaderLocked((locked) => !locked)}
                  title={headerLocked ? 'Unlock frame' : 'Lock frame'}
                  className={`${CONTROL_CLASS} ${headerLocked ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
                  style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
                >
                  {headerLocked ? <Lock size={16} /> : <Unlock size={16} />}
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => setAgentPanelOpen((open) => !open)}
              title={agentPanelOpen ? 'Close assistant' : 'Open assistant'}
              aria-pressed={agentPanelOpen}
              className={CONTROL_CLASS}
              style={{
                WebkitAppRegion: 'no-drag',
                background: agentPanelOpen ? theme.surfaceBgActive : 'transparent',
                color: agentPanelOpen ? theme.text : theme.textMuted,
              } as CSSProperties}
            >
              <MessageCircle size={16} />
            </button>
          </div>
        </div>

        <ShortcutsMenu
          isOpen={showShortcutsMenu}
          onClose={() => setShowShortcutsMenu(false)}
          theme={theme}
          shortcuts={[
            { keys: ['⌘', 'E'], description: 'New note in current tab' },
            { keys: ['⌘', 'N'], description: 'New note in new window' },
            { keys: ['⌘', 'T'], description: 'New note in new tab' },
            { keys: ['⌘', 'W'], description: 'Close current tab' },
            { keys: ['⌘', '⇧', 'W'], description: 'Close window' },
            { keys: ['⌘', '⇧', 'T'], description: 'Reopen last closed tab' },
            { keys: ['⌘', '⇧', 'N'], description: 'Reopen last closed window' },
            { keys: ['⌘', '1-8'], description: 'Switch to tab 1-8' },
            { keys: ['⌘', '9'], description: 'Switch to last tab' },
            { keys: ['⌘', 'M'], description: 'Toggle assistant' },
            { keys: ['⌘', '⇧', 'S'], description: 'Toggle sidebar' },
            { keys: ['⌘', 'K'], description: 'Search notes' },
            { keys: ['⌘', 'F'], description: 'Find in note' },
            { keys: ['⌘', 'L'], description: 'Show shortcuts' },
            { keys: ['⌥', 'Drag'], description: 'Move panel' },
            { keys: ['⌘', '+'], description: 'Zoom in' },
            { keys: ['⌘', '-'], description: 'Zoom out' },
            { keys: ['⌘', '0'], description: 'Reset zoom' },
          ]}
          title="Notebook Shortcuts"
        />
      </div>
    </DockablePanel>
  )
}
