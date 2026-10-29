import { useState, useEffect, useCallback, ReactElement } from 'react'
import { useSettings } from '../hooks/useSettings'
import {
  Home,
  MessageSquare,
  Bot,
  BookOpen,
  Globe,
  Mic,
  FileText,
  Puzzle,
  Workflow
} from 'lucide-react'
import { OverlayMark } from '@overlay/ui'
import {
  ShellAdapterProvider,
  UnifiedSidebar,
  type PrimaryRailItem,
  type SecondaryPanelNav,
} from '@overlay/shell-react'
import { getTheme } from '../utils/theme'
import { getPanelTheme } from '../hooks/usePanelTheme'
import { UpdateNotification } from '../components/ui/UpdateNotification'
import { AgentDetailPage } from './AgentDetailPage'
import { AgentEditorPanel } from './AgentEditorPanel'
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
import { useTranscriptions } from '../hooks/useTranscriptions'
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
import { subscribeWorkspaceChanged } from '../services/workspace-store'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { desktopShellAdapter } from '../shell/DesktopShellAdapter'
import { DesktopWorkspaceSwitcher } from '../shell/DesktopWorkspaceSwitcher'
import {
  AgentSidebarSection,
  ChatSidebarSection,
  VoiceSidebarSection,
} from '../shell/DesktopSidebarSections'
import {
  DESKTOP_MORE_GROUPS,
  DESKTOP_SETTINGS_GROUPS,
  type ActiveTool,
} from '../shell/navigation'
import { useDesktopShellNav } from '../shell/useDesktopShellNav'

interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  version?: string
  progress?: number
  dismissed?: boolean
}

interface MainWindowProps {
  onOpenSettings?: (section?: string) => void
  onSignOut?: () => void
}

const PANEL_TITLES: Partial<Record<ActiveTool, string>> = {
  chat: 'chats',
  agents: 'agents',
  files: 'files',
  extensions: 'extensions',
  automations: 'automations',
  voice: 'voice',
  browser: 'browser'
}

const TITLEBAR_HEIGHT = 44

function scopedRows(page: ActiveTool, _scope: string) {
  const rows =
    page === 'files'
      ? [
          { id: 'files', label: 'Files' },
          { id: 'projects', label: 'Projects' }
        ]
      : page === 'agents'
        ? [
            { id: 'agents', label: 'Agents' },
            { id: 'threads', label: 'Threads' }
          ]
        : [{ id: page, label: PANEL_TITLES[page] ?? page }]
  const withScope = (value: string) => rows.map((row) => ({ ...row, id: `${value}:${row.id}` }))
  return [
    { id: 'personal', label: 'Personal', children: withScope('personal') },
    { id: 'workspace', label: 'Workspace', children: withScope('workspace') }
  ]
}

export function MainWindow({
  onOpenSettings,
  onSignOut
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
  const { activeWorkspaceId } = useWorkspace()
  const shellNav = useDesktopShellNav(activeWorkspaceId)
  const { transcriptions } = useTranscriptions()
  const selectedTranscription = transcriptions.find((item) => item.id === shellNav.itemId)
  const activeTool = shellNav.page
  const setActiveTool = shellNav.setPage
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [agentEditorOpen, setAgentEditorOpen] = useState<'new' | 'edit' | null>(null)
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
  // Keying the workspace surface forces every list (chats, files, projects,
  // automations, memories, skills, agents) to remount and refetch under the
  // new scope. Module caches were already dropped before the change event.
  const workspaceSurfaceKey = activeWorkspaceId ?? 'no-workspace'


  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [filesSearchOpen, setFilesSearchOpen] = useState(false)
  const [filesSearchQuery, setFilesSearchQuery] = useState('')
  const [filesSelectMode, setFilesSelectMode] = useState(false)

  const [browserSearchOpen, setBrowserSearchOpen] = useState(false)
  const [browserSearchQuery, setBrowserSearchQuery] = useState('')
  const [browserSelectMode, setBrowserSelectMode] = useState(false)

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
    setSelectedAgentId(null)
    setAgentEditorOpen(null)
    setSelectedAutomationId(null)
    setSelectedAutomationChatId(null)
    setSelectedNoteId(null)
    setSelectedOutputId(null)
    setSelectedFileId(null)
    setSelectedLocalDocumentId(null)
    setSelectedProjectId(null)
  }, [])

  // Selections and list state are workspace-scoped on the server. When the
  // workspace changes, drop the current selection and reload the lists so a
  // previous workspace's automations/projects never render as current.
  useEffect(() => {
    return subscribeWorkspaceChanged(() => {
      resetEmbeddedSelections()
      setAutomationsRefreshToken((prev) => prev + 1)
      setProjectsRefreshToken((prev) => prev + 1)
      window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
    })
  }, [resetEmbeddedSelections])

  const handleNewChat = useCallback(async (): Promise<void> => {
    const chat = await createNewChat()
    setLastOpenedChatId(chat.id)
    setActiveTool('chat')
    setSelectedChatId(chat.id)
  }, [])

  const handleNewAgentThread = useCallback(async (): Promise<void> => {
    const chat = await createNewChat(undefined, undefined, true, 'New thread')
    setLastOpenedChatId(chat.id)
    setActiveTool('chat')
    setSelectedChatId(chat.id)
  }, [])

  const handleNewAgent = useCallback((): void => {
    setSelectedAgentId(null)
    setAgentEditorOpen('new')
    setActiveTool('agents')
  }, [])

  const handleSelectAgent = useCallback((agentId: string): void => {
    setAgentEditorOpen(null)
    setSelectedAgentId(agentId)
  }, [])

  const handleAgentSaved = useCallback((agentId: string): void => {
    setAgentEditorOpen(null)
    setSelectedAgentId(agentId)
  }, [])

  const handleCloseAgentEditor = useCallback((): void => {
    setAgentEditorOpen(null)
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
      if (activeTool !== tool) resetEmbeddedSelections()
      setActiveTool(tool)
    },
    [activeTool, resetEmbeddedSelections, setActiveTool]
  )

  const handleInstallUpdate = useCallback((): void => {
    window.bridge?.updater?.quitAndInstall?.()
  }, [])

  const handleDismissUpdate = useCallback((): void => {
    setUpdateState((prev) => ({ ...prev, dismissed: true }))
    window.bridge?.updater?.dismissUpdate?.()
  }, [])

  const shouldStretchContent =
    (activeTool === 'chat' && selectedChatId) ||
    (activeTool === 'agents' && (selectedAgentId || agentEditorOpen)) ||
    (activeTool === 'automations' && selectedAutomationChatId) ||
    (activeTool === 'files' && selectedNoteId) ||
    (activeTool === 'files' && selectedOutputId) ||
    (activeTool === 'files' && selectedFileId) ||
    (activeTool === 'files' && selectedLocalDocumentId) ||
    (activeTool === 'files' && selectedProjectId) ||
    activeTool === 'extensions' ||
    activeTool === 'browser' ||
    (activeTool === 'voice' && Boolean(selectedTranscription))

  const sidebarPanelNav: SecondaryPanelNav | undefined =
    activeTool === 'home'
      ? undefined
      : {
          items: scopedRows(activeTool, shellNav.scope),
          activeId: shellNav.scope,
          activeChildId: shellNav.itemId ?? `${shellNav.scope}:${activeTool}`,
          onSelect: (id) => {
            if (id === 'personal' || id === 'workspace') {
              shellNav.setScope(id)
              shellNav.setItemId(null)
            } else {
              shellNav.setItemId(id)
            }
          }
        }
  const shellItems: PrimaryRailItem[] = [
    { id: 'home', label: 'Home', icon: Home, active: activeTool === 'home', onSelect: () => setActiveTool('home') },
    { id: 'agents', label: 'Agents', icon: Bot, active: activeTool === 'agents', onSelect: () => handleToolSelect('agents') },
    { id: 'chats', label: 'Chats', icon: MessageSquare, active: activeTool === 'chat', onSelect: () => handleToolSelect('chat') },
    { id: 'automations', label: 'Automations', icon: Workflow, active: activeTool === 'automations', onSelect: () => handleToolSelect('automations') },
    { id: 'files', label: 'Files', icon: FileText, active: activeTool === 'files', onSelect: () => handleToolSelect('files') },
    { id: 'extensions', label: 'Extensions', icon: Puzzle, active: activeTool === 'extensions', onSelect: () => handleToolSelect('extensions') },
    { id: 'voice', label: 'Voice', icon: Mic, active: activeTool === 'voice', onSelect: () => handleToolSelect('voice') },
    { id: 'browser', label: 'Browser', icon: Globe, active: activeTool === 'browser', onSelect: () => handleToolSelect('browser') }
  ]

  const renderSidebarSection = (id: string): ReactElement<any> | null => {
    if (activeTool === 'chat') {
      return (
        <ChatSidebarSection
          theme={theme}
          scope={shellNav.scope}
          selectedChatId={selectedChatId}
          searchOpen={chatSearchOpen}
          searchQuery={chatSearchQuery}
          onSearchQueryChange={setChatSearchQuery}
          onSelectChat={(chatId) => {
            setSelectedChatId(chatId)
            shellNav.setItemId(`${shellNav.scope}:chat`)
          }}
        />
      )
    }
    if (activeTool === 'agents' && id === 'agents') {
      return (
        <AgentSidebarSection
          theme={theme}
          selectedAgentId={selectedAgentId}
          onSelectAgent={handleSelectAgent}
          onNewAgent={handleNewAgent}
          onNewThread={() => {
            void handleNewAgentThread()
          }}
        />
      )
    }
    if (activeTool === 'agents' && id === 'threads') {
      return (
        <ChatSidebarSection
          theme={theme}
          scope="workspace"
          selectedChatId={selectedChatId}
          includeAgentChats
          searchOpen={chatSearchOpen}
          searchQuery={chatSearchQuery}
          onSearchQueryChange={setChatSearchQuery}
          onSelectChat={(chatId) => {
            setSelectedChatId(chatId)
            setActiveTool('chat')
          }}
        />
      )
    }
    if (activeTool === 'files' && id === 'projects') {
      return (
        <ProjectsListPage
          theme={theme}
          refreshToken={projectsRefreshToken}
          selectedProjectId={selectedProjectId}
          onSelectProject={(projectId) => {
            setSelectedProjectId(projectId)
            setActiveTool('files')
          }}
        />
      )
    }
    if (activeTool === 'files') {
      return (
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
      )
    }
    if (activeTool === 'automations') {
      return (
        <AutomationsListPage
          theme={theme}
          selectedAutomationId={selectedAutomationId}
          selectedConversationId={selectedAutomationChatId}
          onSelectAutomation={handleSelectAutomation}
          refreshToken={automationsRefreshToken}
        />
      )
    }
    if (activeTool === 'extensions') {
      return <ExtensionsNav theme={theme} activeView={activeExtensionView} onSelectView={setActiveExtensionView} />
    }
    if (activeTool === 'voice') {
      return (
        <VoiceSidebarSection
          theme={theme}
          selectedId={shellNav.itemId}
          onSelect={(transcription) => shellNav.setItemId(transcription.id)}
        />
      )
    }
    if (activeTool === 'browser') {
      return (
        <BrowserListPage
          theme={theme}
          openBehavior="embedded"
          isSearchOpen={browserSearchOpen}
          searchQuery={browserSearchQuery}
          onSearchQueryChange={setBrowserSearchQuery}
          isSelectMode={browserSelectMode}
          onSelectModeChange={setBrowserSelectMode}
        />
      )
    }
    return null
  }

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
        .desktop-shell-controls button,
        .desktop-shell-controls a,
        .desktop-shell-controls input {
          -webkit-app-region: no-drag;
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
            left: '80px',
            right: 0,
            zIndex: 1000,
            pointerEvents: 'none'
          } as React.CSSProperties
        }
      />

      <div className="shared-app-scope h-full shrink-0">
        <ShellAdapterProvider value={desktopShellAdapter}>
          <UnifiedSidebar
            brand={
              <span className="flex items-baseline gap-[0.4em] font-serif text-[17px]">
                <OverlayMark size={8.5} className="-translate-y-[0.02em]" />
                <span>overlay</span>
              </span>
            }
            collapsed={shellNav.collapsed}
            onCollapsedChange={shellNav.setCollapsed}
            items={shellItems}
            panelKind={activeTool === 'home' ? null : activeTool}
            panelNav={sidebarPanelNav}
            sectionActions={{
              chat: { label: 'New chat', onClick: handleNewChat },
              agents: { label: 'New agent', onClick: handleNewAgent },
              threads: { label: 'New thread', onClick: handleNewChat },
              files: { label: 'Add file', onClick: handleAddFile },
              projects: { label: 'New project', onClick: handleNewProject },
              automations: { label: 'New automation', onClick: handleNewAutomation },
              browser: { label: 'New tab', onClick: handleNewBrowserTab }
            }}
            renderSection={renderSidebarSection}
            onSearch={() => {
              if (activeTool === 'files') setFilesSearchOpen(true)
              else if (activeTool === 'browser') setBrowserSearchOpen(true)
              else {
                setActiveTool('chat')
                setChatSearchOpen(true)
              }
            }}
            scope={shellNav.scope}
            moreGroups={DESKTOP_MORE_GROUPS}
            settingsGroups={DESKTOP_SETTINGS_GROUPS}
            account={
              <DesktopWorkspaceSwitcher
                onOpenAccount={() => {
                  shellNav.setSettingsSection('account')
                  onOpenSettings?.('account')
                }}
                onOpenSettings={() => {
                  shellNav.setSettingsSection('general')
                  onOpenSettings?.('general')
                }}
                onSignOut={() => onSignOut?.()}
              />
            }
            keyboardShortcut
            resizable
            className="desktop-shell-controls h-full shrink-0"
          />
        </ShellAdapterProvider>
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
          key={workspaceSurfaceKey}
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
                  <OverlayMark size={44} className="mb-1" />
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
                  />
                </ChatErrorBoundary>
              </div>
            )}

            {activeTool === 'agents' && selectedAgentId && !agentEditorOpen && (
              <div
                key={selectedAgentId}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <AgentDetailPage
                  theme={theme}
                  agentId={selectedAgentId}
                  onEditAgent={() => setAgentEditorOpen('edit')}
                />
              </div>
            )}

            {activeTool === 'agents' && agentEditorOpen === 'new' && (
              <div
                key="agent-new"
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <AgentEditorPanel
                  theme={theme}
                  mode="new"
                  onClose={handleCloseAgentEditor}
                  onSaved={handleAgentSaved}
                />
              </div>
            )}

            {activeTool === 'agents' && agentEditorOpen === 'edit' && selectedAgentId && (
              <div
                key={`agent-edit-${selectedAgentId}`}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <AgentEditorPanel
                  theme={theme}
                  mode="edit"
                  agentId={selectedAgentId}
                  onClose={handleCloseAgentEditor}
                  onSaved={handleAgentSaved}
                />
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
                />
              </div>
            )}

            {activeTool === 'files' && selectedOutputId && (
              <div
                key={selectedOutputId}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <OutputPreviewPage outputId={selectedOutputId} />
              </div>
            )}

            {activeTool === 'files' && selectedFileId && (
              <div
                key={selectedFileId}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <RemoteFilePreviewPage fileId={selectedFileId} />
              </div>
            )}

            {activeTool === 'files' && selectedLocalDocumentId && (
              <div
                key={selectedLocalDocumentId}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <LocalDocumentPreviewPage
                  documentId={selectedLocalDocumentId}
                />
              </div>
            )}

            {activeTool === 'files' && selectedProjectId && (
              <div
                key={selectedProjectId}
                style={{ width: '100%', height: '100%', animation: 'mainFadeIn 0.15s ease-out' }}
              >
                <ProjectDetailPage
                  projectId={selectedProjectId}
                  theme={theme}
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
                />
              </div>
            )}

            {activeTool === 'voice' && selectedTranscription && (
              <article
                key={selectedTranscription.id}
                className="h-full w-full overflow-auto p-8"
              >
                <h1 className="mb-4 text-xl font-medium text-(--foreground)">
                  Voice session
                </h1>
                <time className="mb-6 block text-sm text-(--muted)">
                  {new Date(selectedTranscription.timestamp).toLocaleString()}
                </time>
                <p className="whitespace-pre-wrap text-sm leading-7 text-(--foreground)">
                  {selectedTranscription.text}
                </p>
              </article>
            )}

            {activeTool === 'browser' && (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  animation: 'mainFadeIn 0.15s ease-out'
                }}
              >
                <BrowserPanel embedded />
              </div>
            )}

            {activeTool !== 'home' &&
              !(activeTool === 'chat' && selectedChatId) &&
              !(activeTool === 'agents' && (selectedAgentId || agentEditorOpen)) &&
              !(activeTool === 'automations' && selectedAutomationChatId) &&
              !(activeTool === 'files' && selectedNoteId) &&
              !(activeTool === 'files' && selectedOutputId) &&
              !(activeTool === 'files' && selectedFileId) &&
              !(activeTool === 'files' && selectedLocalDocumentId) &&
              !(activeTool === 'files' && selectedProjectId) &&
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
