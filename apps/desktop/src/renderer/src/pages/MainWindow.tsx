import { useState, useEffect, useCallback, ReactElement } from 'react'
import { useSettings } from '../hooks/useSettings'
import { SettingsIcon } from '../components/icons'
import {
  MessageSquare,
  BookOpen,
  Globe,
  Mic,
  FolderOpen,
  FileText,
  ChevronLeft,
  ChevronRight,
  Plus,
  Puzzle,
  Search,
  Square,
  Workflow
} from 'lucide-react'
import overlayLogo from '../../../../resources/logos/logo-big-no-bg.png'
import { getTheme } from '../utils/theme'
import { getPanelTheme } from '../hooks/usePanelTheme'
import { UpdateNotification } from '../components/ui/UpdateNotification'
import { ChatsListPage } from './ChatsListPage'
import { TranscriptionListPage } from './TranscriptionListPage'
import { ProjectsListPage } from './ProjectsListPage'
import { FilesListPage } from './FilesListPage'
import {
  AutomationsListPage,
  AUTOMATIONS_UPDATED_EVENT,
  type Automation
} from './AutomationsListPage'
import { ExtensionsNav, ExtensionsPage, type ExtensionView } from './ExtensionsPage'
import { ChatConversationView } from '../components/chat/ChatConversationView'
import { ChatErrorBoundary } from '../components/chat/ChatErrorBoundary'
import { DesktopNotebookEditor } from '../features/notebook/DesktopNotebookEditor'
import { BrowserListPage } from './BrowserListPage'
import { BrowserPanel } from './BrowserPanel'
import { ProjectDetailPage } from './ProjectDetailPage'
import { OutputPreviewPage } from './OutputPreviewPage'
import { RemoteFilePreviewPage } from './RemoteFilePreviewPage'
import { LocalDocumentPreviewPage } from './LocalDocumentPreviewPage'
import {
  createDesktopKnowledgeRepository,
  createDesktopNoteReplicaPort
} from '../adapters/desktopKnowledgeSurfaceAdapters'
import { createDesktopLocalKnowledgeRepository } from '../adapters/desktopLocalKnowledgeSurfaceAdapters'
import { getDesktopKnowledgeAuthority } from '../services/desktop-knowledge-migration'
import { FILES_RECONCILE_EVENT } from './fileListRefresh'
import { fetchDesktopFileList } from '../services/files-list-cache'
import { prehydrateDesktopIntegrations } from '../services/integrations-cache'
import { createNewChat, setLastOpenedChatId } from '../utils/chatStorage'
import { PROJECTS_CHANGED_EVENT } from '../utils/projectStorage'
import { desktopAppJson } from '../services/app-api-client'

type ActiveTool =
  | 'home'
  | 'projects'
  | 'chat'
  | 'files'
  | 'extensions'
  | 'automations'
  | 'transcriptions'
  | 'browser'

interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  version?: string
  progress?: number
  dismissed?: boolean
}

interface MainWindowProps {
  onOpenSettings?: () => void
  sidebarExpanded: boolean
  onToggleSidebar: () => void
}

const SIDEBAR_TOOLS: {
  id: ActiveTool
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>
  label: string
}[] = [
  { id: 'chat', icon: MessageSquare, label: 'chats' },
  { id: 'files', icon: FileText, label: 'files' },
  { id: 'extensions', icon: Puzzle, label: 'extensions' },
  { id: 'projects', icon: FolderOpen, label: 'projects' },
  { id: 'automations', icon: Workflow, label: 'automations' },
  { id: 'browser', icon: Globe, label: 'browser' },
  { id: 'transcriptions', icon: Mic, label: 'voice' }
]

const PANEL_TITLES: Partial<Record<ActiveTool, string>> = {
  projects: 'projects',
  chat: 'chats',
  files: 'files',
  extensions: 'extensions',
  automations: 'automations',
  transcriptions: 'voice',
  browser: 'browser'
}

const COLLAPSED_WIDTH = 68
const EXPANDED_WIDTH = 180
const TITLEBAR_HEIGHT = 44

interface HeaderAction {
  key: string
  title: string
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>
  onClick: () => void
  active?: boolean
}

export function MainWindow({
  onOpenSettings,
  sidebarExpanded,
  onToggleSidebar
}: MainWindowProps): ReactElement<any> {
  const { settings } = useSettings()
  const theme = getTheme(settings.darkMode, settings.lightThemePreset, settings.darkThemePreset)
  const panelTheme = getPanelTheme(
    settings.darkMode,
    settings.lightThemePreset,
    settings.darkThemePreset
  )
  const embeddedPanelTheme = {
    ...panelTheme,
    panelBg: theme.background
  }
  const isDark = settings.darkMode
  const [activeTool, setActiveTool] = useState<ActiveTool>('home')
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null)
  const [selectedAutomationChatId, setSelectedAutomationChatId] = useState<string | null>(null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [selectedLocalDocumentId, setSelectedLocalDocumentId] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectsRefreshToken, setProjectsRefreshToken] = useState(0)
  const [automationsRefreshToken, setAutomationsRefreshToken] = useState(0)
  const [activeExtensionView, setActiveExtensionView] = useState<ExtensionView>('connectors')

  // Per-tool secondary panel collapsed state (persisted in localStorage)
  const PANEL_COLLAPSED_KEY = 'overlay-main-panel-collapsed'
  const [collapsedState, setCollapsedState] = useState<
    Record<Exclude<ActiveTool, 'home'>, boolean>
  >(() => {
    try {
      const raw = localStorage.getItem(PANEL_COLLAPSED_KEY)
      const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
      return {
        projects: parsed.projects ?? false,
        chat: parsed.chat ?? false,
        files: parsed.files ?? false,
        automations: parsed.automations ?? false,
        transcriptions: parsed.transcriptions ?? false,
        browser: parsed.browser ?? false,
        extensions: parsed.extensions ?? false
      }
    } catch {
      return {
        projects: false,
        chat: false,
        files: false,
        automations: false,
        transcriptions: false,
        browser: false,
        extensions: false
      }
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_COLLAPSED_KEY, JSON.stringify(collapsedState))
    } catch {
      // ignore storage failures
    }
  }, [collapsedState])

  const isCollapsed = activeTool !== 'home' && collapsedState[activeTool]
  const toggleCollapsed = useCallback(() => {
    if (activeTool === 'home') return
    setCollapsedState((prev) => ({ ...prev, [activeTool]: !prev[activeTool] }))
  }, [activeTool])

  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [chatSelectMode, setChatSelectMode] = useState(false)

  const [filesSearchOpen, setFilesSearchOpen] = useState(false)
  const [filesSearchQuery, setFilesSearchQuery] = useState('')
  const [filesSelectMode, setFilesSelectMode] = useState(false)

  const [browserSearchOpen, setBrowserSearchOpen] = useState(false)
  const [browserSearchQuery, setBrowserSearchQuery] = useState('')
  const [browserSelectMode, setBrowserSelectMode] = useState(false)

  const [transcriptionSearchOpen, setTranscriptionSearchOpen] = useState(false)
  const [transcriptionSearchQuery, setTranscriptionSearchQuery] = useState('')
  const [transcriptionSelectMode, setTranscriptionSelectMode] = useState(false)

  useEffect(() => {
    const authority = getDesktopKnowledgeAuthority() === 'cloud' ? 'cloud' : 'on-this-mac'
    void fetchDesktopFileList({ authority }).catch((error) => {
      console.warn('[MainWindow] Failed to prehydrate files sidebar:', error)
    })
    prehydrateDesktopIntegrations()
  }, [])

  useEffect(() => {
    const unsubscribe = window.bridge?.updater?.onStatus?.((statusData) => {
      const { status, data } = statusData
      switch (status) {
        case 'checking-for-update':
          setUpdateState((prev) => ({ ...prev, status: 'checking' }))
          break
        case 'update-available':
          setUpdateState((prev) => ({
            ...prev,
            status: 'downloading',
            version: (data as { version?: string })?.version,
            dismissed: false
          }))
          break
        case 'download-progress':
          setUpdateState((prev) => ({
            ...prev,
            status: 'downloading',
            progress: (data as { percent?: number })?.percent
          }))
          break
        case 'update-downloaded':
          setUpdateState((prev) => ({
            ...prev,
            status: 'ready',
            version: (data as { version?: string })?.version
          }))
          break
        case 'error':
          setUpdateState((prev) => ({ ...prev, status: 'error' }))
          break
        default:
          break
      }
    })

    window.bridge?.updater
      ?.getStatus?.()
      .then((status) => {
        if (status?.updateDownloaded) {
          setUpdateState({
            status: 'ready',
            version: status.latestVersion,
            dismissed: status.updateDismissed || false
          })
        }
      })
      .catch((err) => {
        console.error('[MainWindow] Failed to get update status:', err)
      })

    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (activeTool === 'browser') {
      void window.bridge.browser.ensureWindow()
    }
  }, [activeTool])

  const resetEmbeddedSelections = useCallback(() => {
    setSelectedChatId(null)
    setSelectedAutomationId(null)
    setSelectedAutomationChatId(null)
    setSelectedNoteId(null)
    setSelectedOutputId(null)
    setSelectedFileId(null)
    setSelectedLocalDocumentId(null)
    setSelectedProjectId(null)
  }, [])

  const handleNewChat = useCallback(async (): Promise<void> => {
    const chat = await createNewChat()
    setLastOpenedChatId(chat.id)
    setActiveTool('chat')
    setSelectedChatId(chat.id)
  }, [])

  const handleNewNote = useCallback(async (): Promise<void> => {
    if (getDesktopKnowledgeAuthority() === 'on-this-mac') {
      const note = await createDesktopLocalKnowledgeRepository().create({
        name: 'Untitled',
        kind: 'note',
        parentId: null,
        content: ''
      })
      const localId = note.clientId || note.id.replace(/^local-note:/, '')
      setActiveTool('files')
      setSelectedOutputId(null)
      setSelectedFileId(null)
      setSelectedLocalDocumentId(null)
      setSelectedNoteId(localId)
      return
    }
    const noteReplicas = createDesktopNoteReplicaPort()
    if (!noteReplicas) throw new Error('Desktop note storage is unavailable')
    const repository = createDesktopKnowledgeRepository(undefined, window, noteReplicas)
    const note = await repository.create({
      name: 'Untitled',
      kind: 'note',
      parentId: null,
      content: ''
    })
    const localId = await noteReplicas.ensure(note)
    setActiveTool('files')
    setSelectedOutputId(null)
    setSelectedFileId(null)
    setSelectedLocalDocumentId(null)
    setSelectedNoteId(localId)
  }, [])

  const handleOpenLocalDocument = useCallback((documentId: string): void => {
    setSelectedNoteId(null)
    setSelectedOutputId(null)
    setSelectedFileId(null)
    setSelectedLocalDocumentId(documentId)
  }, [])

  const handleNewAutomation = useCallback(async (): Promise<void> => {
    const chat = await createNewChat(undefined, undefined, true, 'New automation')
    setLastOpenedChatId(chat.id)
    localStorage.setItem('overlay-agent-mode-enabled', 'true')
    setActiveTool('automations')
    setSelectedAutomationId(null)
    setSelectedAutomationChatId(chat.id)
    window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
    setAutomationsRefreshToken((prev) => prev + 1)
  }, [])

  const handleSelectAutomation = useCallback((automation: Automation): void => {
    const conversationId = automation.sourceConversationId || automation.conversationId
    setSelectedAutomationId(automation._id)
    if (conversationId) {
      setLastOpenedChatId(conversationId)
      setSelectedAutomationChatId(conversationId)
    } else {
      setSelectedAutomationChatId(null)
    }
  }, [])

  const handleNewProject = useCallback((): void => {
    void desktopAppJson('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Project' })
    })
      .then((result) => {
        const projectId =
          (result as { project?: { _id?: string }; id?: string }).project?._id ||
          (result as { id?: string }).id
        if (projectId) setSelectedProjectId(projectId)
      })
      .finally(() => {
        window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
        setProjectsRefreshToken((prev) => prev + 1)
      })
  }, [])

  const handleAddFile = useCallback((): void => {
    setActiveTool('files')
    void (async () => {
      const result = await window.bridge.document.ingestDialog({ waitForIndex: true })
      if (result.success && !result.canceled) {
        window.dispatchEvent(
          new CustomEvent(FILES_RECONCILE_EVENT, { detail: { reason: 'explicit-refresh' } })
        )
      }
    })()
  }, [])

  const handleNewBrowserTab = useCallback((): void => {
    setActiveTool('browser')
    resetEmbeddedSelections()
    void (async () => {
      await window.bridge.browser.ensureWindow()
      await window.bridge.browser.createTab()
    })()
  }, [resetEmbeddedSelections])

  const handleToolSelect = useCallback(
    (tool: ActiveTool): void => {
      setActiveTool((prev) => {
        if (prev !== tool) resetEmbeddedSelections()
        return prev === tool ? 'home' : tool
      })
    },
    [resetEmbeddedSelections]
  )

  const handleInstallUpdate = useCallback((): void => {
    window.bridge?.updater?.quitAndInstall?.()
  }, [])

  const handleDismissUpdate = useCallback((): void => {
    setUpdateState((prev) => ({ ...prev, dismissed: true }))
    window.bridge?.updater?.dismissUpdate?.()
  }, [])

  const toggleSearch = useCallback((tool: 'chat' | 'files' | 'browser' | 'transcriptions') => {
    switch (tool) {
      case 'chat':
        setChatSearchOpen((prev) => {
          if (prev) setChatSearchQuery('')
          return !prev
        })
        break
      case 'files':
        setFilesSearchOpen((prev) => {
          if (prev) setFilesSearchQuery('')
          return !prev
        })
        break
      case 'browser':
        setBrowserSearchOpen((prev) => {
          if (prev) setBrowserSearchQuery('')
          return !prev
        })
        break
      case 'transcriptions':
        setTranscriptionSearchOpen((prev) => {
          if (prev) setTranscriptionSearchQuery('')
          return !prev
        })
        break
    }
  }, [])

  const showPanel = activeTool !== 'home'

  const iconColor = (_id: ActiveTool): string => theme.text

  const toolButtonBg = (id: ActiveTool): string =>
    activeTool === id ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)') : 'transparent'

  const sidebarWidth = sidebarExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH

  const labelStyle = (color: string): React.CSSProperties => ({
    fontSize: '13px',
    fontFamily: "'Libre Baskerville', Georgia, serif",
    color,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    maxWidth: sidebarExpanded ? '140px' : '0px',
    opacity: sidebarExpanded ? 1 : 0,
    transition: sidebarExpanded
      ? 'max-width 0.2s ease, opacity 0.12s ease 0.1s'
      : 'max-width 0.2s ease 0.02s, opacity 0.06s ease',
    lineHeight: 'normal',
    pointerEvents: 'none'
  })

  const sidebarRowStyle = (bg: string): React.CSSProperties => ({
    width: '100%',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    background: bg,
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    padding: '0 6px',
    flexShrink: 0,
    overflow: 'hidden'
  })

  const headerActionButtonStyle = (active = false): React.CSSProperties => ({
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: active ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : 'transparent',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    color: active ? theme.text : theme.textSecondary,
    transition: 'background 0.1s ease',
    flexShrink: 0
  })

  const getHeaderActions = (): HeaderAction[] => {
    switch (activeTool) {
      case 'projects':
        return [{ key: 'new-project', title: 'New project', icon: Plus, onClick: handleNewProject }]
      case 'chat':
        return [
          {
            key: 'search-chats',
            title: 'Search chats',
            icon: Search,
            onClick: () => toggleSearch('chat'),
            active: chatSearchOpen
          },
          {
            key: 'select-chats',
            title: 'Select chats',
            icon: Square,
            onClick: () => setChatSelectMode((prev) => !prev),
            active: chatSelectMode
          },
          { key: 'new-chat', title: 'New chat', icon: Plus, onClick: handleNewChat }
        ]
      case 'files':
        return [
          {
            key: 'search-files',
            title: 'Search files',
            icon: Search,
            onClick: () => toggleSearch('files'),
            active: filesSearchOpen
          },
          {
            key: 'select-files',
            title: 'Select files',
            icon: Square,
            onClick: () => setFilesSelectMode((prev) => !prev),
            active: filesSelectMode
          },
          { key: 'add-file', title: 'Add file', icon: Plus, onClick: handleAddFile }
        ]
      case 'automations':
        return [
          {
            key: 'new-automation',
            title: 'New automation',
            icon: Plus,
            onClick: handleNewAutomation
          }
        ]
      case 'browser':
        return [
          {
            key: 'search-tabs',
            title: 'Search tabs',
            icon: Search,
            onClick: () => toggleSearch('browser'),
            active: browserSearchOpen
          },
          {
            key: 'select-tabs',
            title: 'Select tabs',
            icon: Square,
            onClick: () => setBrowserSelectMode((prev) => !prev),
            active: browserSelectMode
          },
          { key: 'new-tab', title: 'New tab', icon: Plus, onClick: handleNewBrowserTab }
        ]
      case 'transcriptions':
        return [
          {
            key: 'search-voice',
            title: 'Search voice',
            icon: Search,
            onClick: () => toggleSearch('transcriptions'),
            active: transcriptionSearchOpen
          },
          {
            key: 'select-voice',
            title: 'Select voice',
            icon: Square,
            onClick: () => setTranscriptionSelectMode((prev) => !prev),
            active: transcriptionSelectMode
          }
        ]
      default:
        return []
    }
  }

  const headerActions = getHeaderActions()
  const shouldStretchContent =
    (activeTool === 'chat' && selectedChatId) ||
    (activeTool === 'automations' && selectedAutomationChatId) ||
    (activeTool === 'files' && selectedNoteId) ||
    (activeTool === 'files' && selectedOutputId) ||
    (activeTool === 'files' && selectedFileId) ||
    (activeTool === 'files' && selectedLocalDocumentId) ||
    (activeTool === 'projects' && selectedProjectId) ||
    activeTool === 'extensions' ||
    activeTool === 'browser'

  const expandButton = isCollapsed ? (
    <button
      type="button"
      title="Expand panel"
      onClick={toggleCollapsed}
      style={{
        width: '28px',
        height: '28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        color: theme.textSecondary,
        transition: 'background 0.1s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <ChevronRight size={16} strokeWidth={1.5} />
    </button>
  ) : null

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        background: theme.background,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        display: 'flex',
        flexDirection: 'row',
        position: 'relative',
        userSelect: 'none',
        overflow: 'hidden'
      }}
    >
      <style>{`
        @keyframes panelSlideIn {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes mainFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        style={
          {
            WebkitAppRegion: 'drag',
            height: `${TITLEBAR_HEIGHT}px`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000
          } as React.CSSProperties
        }
      />

      <div
        style={{
          width: `${sidebarWidth}px`,
          transition: 'width 0.2s ease',
          height: '100%',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: theme.background,
          overflow: 'hidden',
          zIndex: 5,
          paddingTop: `${TITLEBAR_HEIGHT + 10}px`,
          paddingBottom: '16px',
          paddingLeft: '10px',
          paddingRight: '10px',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ flex: 1 }} />

        <button
          onClick={() => setActiveTool('home')}
          title="Home"
          style={{
            ...sidebarRowStyle('transparent'),
            marginBottom: '4px'
          }}
        >
          <span
            style={{
              width: '36px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              flexShrink: 0
            }}
          >
            <img
              src={overlayLogo}
              alt="Overlay"
              style={{ width: '16px', height: '16px', objectFit: 'contain' }}
            />
          </span>
          <span style={labelStyle(theme.text)}>overlay</span>
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {SIDEBAR_TOOLS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => handleToolSelect(id)}
              title={label}
              style={sidebarRowStyle(toolButtonBg(id))}
              onMouseEnter={(e) => {
                if (activeTool !== id) e.currentTarget.style.background = theme.border
              }}
              onMouseLeave={(e) => {
                if (activeTool !== id) e.currentTarget.style.background = toolButtonBg(id)
              }}
            >
              <span
                style={{
                  width: '36px',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  flexShrink: 0
                }}
              >
                <Icon size={16} strokeWidth={1.5} color={iconColor(id)} />
              </span>
              <span style={labelStyle(iconColor(id))}>{label}</span>
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <button
            onClick={onOpenSettings}
            title="Settings"
            style={sidebarRowStyle('transparent')}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <span
              style={{
                width: '36px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                flexShrink: 0
              }}
            >
              <SettingsIcon color={theme.text} size={16} />
            </span>
            <span style={labelStyle(theme.text)}>settings</span>
          </button>
          <button
            onClick={onToggleSidebar}
            title={sidebarExpanded ? 'Hide' : 'Show'}
            style={sidebarRowStyle('transparent')}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <span
              style={{
                width: '36px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                flexShrink: 0
              }}
            >
              {sidebarExpanded ? (
                <ChevronLeft size={16} strokeWidth={1.5} color={theme.text} />
              ) : (
                <ChevronRight size={16} strokeWidth={1.5} color={theme.text} />
              )}
            </span>
            <span style={labelStyle(theme.text)}>{sidebarExpanded ? 'hide' : 'show'}</span>
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0
        }}
      >
        <div style={{ height: `${TITLEBAR_HEIGHT}px`, flexShrink: 0 }} />

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            overflow: 'hidden',
            borderLeft: `1px solid ${theme.border}`,
            borderTop: `1px solid ${theme.border}`,
            borderTopLeftRadius: '8px'
          }}
        >
          {showPanel && (
            <div
              style={{
                width: isCollapsed ? 0 : 260,
                height: '100%',
                borderRight: isCollapsed ? 'none' : `1px solid ${theme.border}`,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                flexShrink: 0,
                transition: 'width 0.2s ease, opacity 0.1s ease',
                opacity: isCollapsed ? 0 : 1,
                animation: isCollapsed ? undefined : 'panelSlideIn 0.18s ease-out'
              }}
            >
              <div
                style={{
                  height: '44px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 12px 0 16px',
                  borderBottom: `1px solid ${theme.border}`,
                  flexShrink: 0
                }}
              >
                <span
                  style={{
                    fontFamily: "'Libre Baskerville', Georgia, serif",
                    fontSize: '19px',
                    fontWeight: 400,
                    color: theme.text,
                    lineHeight: 1
                  }}
                >
                  {PANEL_TITLES[activeTool]}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  {headerActions.map(({ key, title, icon: Icon, onClick, active }) => (
                    <button
                      key={key}
                      title={title}
                      onClick={onClick}
                      style={headerActionButtonStyle(active)}
                      onMouseEnter={(e) => {
                        if (!active) {
                          e.currentTarget.style.background = isDark
                            ? 'rgba(255,255,255,0.08)'
                            : 'rgba(0,0,0,0.06)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = active
                          ? isDark
                            ? 'rgba(255,255,255,0.1)'
                            : 'rgba(0,0,0,0.08)'
                          : 'transparent'
                      }}
                    >
                      <Icon size={13} />
                    </button>
                  ))}
                  <button
                    type="button"
                    title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
                    onClick={toggleCollapsed}
                    style={headerActionButtonStyle(false)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(0,0,0,0.06)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <ChevronLeft size={16} strokeWidth={1.5} />
                  </button>
                </div>
              </div>

              <div
                style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
              >
                {activeTool === 'projects' && (
                  <ProjectsListPage
                    theme={theme}
                    refreshToken={projectsRefreshToken}
                    selectedProjectId={selectedProjectId}
                    onSelectProject={setSelectedProjectId}
                  />
                )}
                {activeTool === 'chat' && (
                  <ChatsListPage
                    theme={theme}
                    onSelectChat={setSelectedChatId}
                    selectedChatId={selectedChatId}
                    isSearchOpen={chatSearchOpen}
                    searchQuery={chatSearchQuery}
                    onSearchQueryChange={setChatSearchQuery}
                    isSelectMode={chatSelectMode}
                    onSelectModeChange={setChatSelectMode}
                  />
                )}
                {activeTool === 'files' && (
                  <FilesListPage
                    theme={theme}
                    onSelectNote={(noteId) => {
                      setSelectedOutputId(null)
                      setSelectedFileId(null)
                      setSelectedLocalDocumentId(null)
                      setSelectedNoteId(noteId)
                    }}
                    onSelectOutput={(outputId) => {
                      setSelectedNoteId(null)
                      setSelectedFileId(null)
                      setSelectedLocalDocumentId(null)
                      setSelectedOutputId(outputId)
                    }}
                    onSelectFile={(fileId) => {
                      setSelectedNoteId(null)
                      setSelectedOutputId(null)
                      setSelectedLocalDocumentId(null)
                      setSelectedFileId(fileId)
                    }}
                    onSelectLocalDocument={handleOpenLocalDocument}
                    selectedNoteId={selectedNoteId}
                    selectedOutputId={selectedOutputId}
                    selectedFileId={selectedFileId}
                    selectedLocalDocumentId={selectedLocalDocumentId}
                    isSearchOpen={filesSearchOpen}
                    searchQuery={filesSearchQuery}
                    onSearchQueryChange={setFilesSearchQuery}
                    isSelectMode={filesSelectMode}
                    onSelectModeChange={setFilesSelectMode}
                  />
                )}
                {activeTool === 'automations' && (
                  <AutomationsListPage
                    theme={theme}
                    selectedAutomationId={selectedAutomationId}
                    selectedConversationId={selectedAutomationChatId}
                    onSelectAutomation={handleSelectAutomation}
                    refreshToken={automationsRefreshToken}
                  />
                )}
                {activeTool === 'extensions' && (
                  <ExtensionsNav
                    theme={theme}
                    activeView={activeExtensionView}
                    onSelectView={setActiveExtensionView}
                  />
                )}
                {activeTool === 'transcriptions' && (
                  <TranscriptionListPage
                    theme={theme}
                    isSearchOpen={transcriptionSearchOpen}
                    searchQuery={transcriptionSearchQuery}
                    onSearchQueryChange={setTranscriptionSearchQuery}
                    isSelectMode={transcriptionSelectMode}
                    onSelectModeChange={setTranscriptionSelectMode}
                  />
                )}
                {activeTool === 'browser' && (
                  <BrowserListPage
                    theme={theme}
                    openBehavior="embedded"
                    isSearchOpen={browserSearchOpen}
                    searchQuery={browserSearchQuery}
                    onSearchQueryChange={setBrowserSearchQuery}
                    isSelectMode={browserSelectMode}
                    onSelectModeChange={setBrowserSelectMode}
                  />
                )}
              </div>
            </div>
          )}

          <div
            style={{
              flex: 1,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: shouldStretchContent ? 'stretch' : 'center',
              justifyContent: shouldStretchContent ? 'flex-start' : 'center',
              overflow: 'hidden',
              position: 'relative',
              background: theme.background
            }}
          >
            {isCollapsed && !shouldStretchContent && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 16,
                  zIndex: 2
                }}
              >
                {expandButton}
              </div>
            )}
            {activeTool === 'home' && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '24px',
                  marginTop: '-24px',
                  animation: 'mainFadeIn 0.2s ease-out',
                  width: '100%',
                  maxWidth: '320px',
                  padding: '0 24px'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <img
                    src={overlayLogo}
                    alt="Overlay"
                    style={{
                      width: '44px',
                      height: '44px',
                      objectFit: 'contain',
                      marginBottom: '4px'
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "'Libre Baskerville', Georgia, serif",
                      fontSize: '28px',
                      fontWeight: 400,
                      color: theme.text,
                      letterSpacing: '-0.5px',
                      lineHeight: 1
                    }}
                  >
                    overlay
                  </span>
                  <p
                    style={{
                      fontFamily: "'Libre Baskerville', Georgia, serif",
                      fontSize: '13px',
                      color: theme.textSecondary,
                      margin: '4px 0 0',
                      textAlign: 'center'
                    }}
                  >
                    personal computing, reimagined
                  </p>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                    width: '100%'
                  }}
                >
                  {[
                    { label: 'New Chat', icon: MessageSquare, action: handleNewChat },
                    { label: 'New Automation', icon: Workflow, action: handleNewAutomation },
                    {
                      label: 'New Note',
                      icon: BookOpen,
                      action: () => {
                        void handleNewNote()
                      }
                    },
                    { label: 'New Tab', icon: Globe, action: handleNewBrowserTab }
                  ].map(({ label, icon: Icon, action }) => (
                    <button
                      key={label}
                      onClick={action}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '8px',
                        padding: '12px',
                        background: 'transparent',
                        border: `1px solid ${theme.border}`,
                        borderRadius: '10px',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        textAlign: 'left'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = theme.surface
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <Icon size={15} strokeWidth={1.5} color={theme.textSecondary} />
                      <span style={{ fontSize: '12px', color: theme.text, lineHeight: 1 }}>
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTool === 'chat' && selectedChatId && (
              <div
                key={selectedChatId}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <ChatErrorBoundary key={`chat-boundary-${selectedChatId}`}>
                  <ChatConversationView
                    chatId={selectedChatId}
                    theme={embeddedPanelTheme}
                    onChatIdChange={setSelectedChatId}
                    embedded
                    headerLeftSlot={expandButton}
                  />
                </ChatErrorBoundary>
              </div>
            )}

            {activeTool === 'automations' && selectedAutomationChatId && (
              <div
                key={selectedAutomationChatId}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <ChatErrorBoundary key={`automation-boundary-${selectedAutomationChatId}`}>
                  <ChatConversationView
                    chatId={selectedAutomationChatId}
                    theme={embeddedPanelTheme}
                    onChatIdChange={setSelectedAutomationChatId}
                    mode="automate"
                    embedded
                    headerLeftSlot={expandButton}
                  />
                </ChatErrorBoundary>
              </div>
            )}

            {activeTool === 'files' && selectedNoteId && (
              <div
                key={selectedNoteId}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <DesktopNotebookEditor
                  noteId={selectedNoteId}
                  hideBackButton
                  compactHeader
                  headerLeading={expandButton}
                />
              </div>
            )}

            {activeTool === 'files' && selectedOutputId && (
              <div
                key={selectedOutputId}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <OutputPreviewPage outputId={selectedOutputId} headerLeftSlot={expandButton} />
              </div>
            )}

            {activeTool === 'files' && selectedFileId && (
              <div
                key={selectedFileId}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <RemoteFilePreviewPage fileId={selectedFileId} headerLeftSlot={expandButton} />
              </div>
            )}

            {activeTool === 'files' && selectedLocalDocumentId && (
              <div
                key={selectedLocalDocumentId}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <LocalDocumentPreviewPage
                  documentId={selectedLocalDocumentId}
                  headerLeftSlot={expandButton}
                />
              </div>
            )}

            {activeTool === 'projects' && selectedProjectId && (
              <div
                key={selectedProjectId}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <ProjectDetailPage
                  projectId={selectedProjectId}
                  theme={theme}
                  headerLeftSlot={expandButton}
                  onOpenChat={(chatId) => {
                    setLastOpenedChatId(chatId)
                    setSelectedChatId(chatId)
                    setActiveTool('chat')
                  }}
                />
              </div>
            )}

            {activeTool === 'extensions' && (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  animation: 'mainFadeIn 0.15s ease-out'
                }}
              >
                <ExtensionsPage
                  theme={theme}
                  activeView={activeExtensionView}
                  headerLeftSlot={expandButton}
                />
              </div>
            )}

            {activeTool === 'browser' && (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  animation: 'mainFadeIn 0.15s ease-out'
                }}
              >
                <BrowserPanel embedded headerLeftSlot={expandButton} />
              </div>
            )}

            {activeTool !== 'home' &&
              !(activeTool === 'chat' && selectedChatId) &&
              !(activeTool === 'automations' && selectedAutomationChatId) &&
              !(activeTool === 'files' && selectedNoteId) &&
              !(activeTool === 'files' && selectedOutputId) &&
              !(activeTool === 'files' && selectedFileId) &&
              !(activeTool === 'files' && selectedLocalDocumentId) &&
              !(activeTool === 'projects' && selectedProjectId) &&
              activeTool !== 'extensions' &&
              activeTool !== 'browser' && (
                <div
                  key={activeTool}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                    animation: 'mainFadeIn 0.2s ease-out'
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Libre Baskerville', Georgia, serif",
                      fontSize: '28px',
                      fontWeight: 400,
                      color: theme.text,
                      lineHeight: 1
                    }}
                  >
                    {PANEL_TITLES[activeTool]}
                  </span>
                  <p style={{ fontSize: '12px', color: theme.textSecondary, margin: 0 }}>
                    Select an item or create a new one
                  </p>
                </div>
              )}
          </div>
        </div>
      </div>

      {updateState.status === 'ready' && !updateState.dismissed && (
        <UpdateNotification
          theme={theme}
          version={updateState.version}
          onInstall={handleInstallUpdate}
          onDismiss={handleDismissUpdate}
        />
      )}

      {updateState.status === 'downloading' && updateState.progress !== undefined && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: '9999px',
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            zIndex: 9998
          }}
        >
          <div
            style={{
              width: '120px',
              height: '4px',
              background: theme.border,
              borderRadius: '2px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${updateState.progress}%`,
                height: '100%',
                background: theme.text,
                borderRadius: '2px',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
          <span style={{ fontSize: '12px', color: theme.textSecondary, fontWeight: 500 }}>
            {Math.round(updateState.progress)}%
          </span>
        </div>
      )}
    </div>
  )
}
