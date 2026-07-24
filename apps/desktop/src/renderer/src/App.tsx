import { useState, useEffect, useCallback, ReactElement } from 'react'
import * as Sentry from '@sentry/react'
import { getTheme } from './utils/theme'
import { MainWindow } from './pages/MainWindow'
import { SettingsPage } from './pages/SettingsPage'
import { OverlayWindow } from './pages/OverlayWindow'
import { NotebookPanel } from './pages/NotebookPanel'
import { ChatPanel } from './pages/ChatPanel'
import { TranscriptionPanel } from './pages/TranscriptionPanel'
import { BrowserPanel } from './pages/BrowserPanel'
import { NotificationPage } from './pages/NotificationPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { useSettings } from './hooks/useSettings'
import { useTranscriptions } from './hooks/useTranscriptions'
import { useWindowZoom } from './hooks/useWindowZoom'
import { analytics } from './services/analytics'
import { setRendererMonitoringConsent } from './services/monitoring'
import {
  clearAuthSession,
  dispatchAuthReady,
  loadVerifiedAuthSession,
  setAuthFailureReason
} from './services/auth-service'
import { forceDesktopSync, initializeDesktopSync } from './services/desktop-sync-service'
import { SubscriptionProvider } from './contexts/SubscriptionContext'
import { ChatProvider } from './contexts/ChatContext'
import { AppBootstrapProvider, useAppBootstrap } from './contexts/AppBootstrapContext'
import { migrateLocalChatsToCloud } from './utils/chatStorage'
import { migrateLegacyDesktopKnowledge } from './services/desktop-knowledge-migration'

interface DownloadProgress {
  modelId: string
  percent: number
  downloadedFormatted: string
  totalFormatted: string
}

function MainApp(): ReactElement {
  const [showSettings, setShowSettings] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null)
  const [showAuthOnly, setShowAuthOnly] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const { settings } = useSettings()
  const { refreshBootstrap } = useAppBootstrap()
  const theme = getTheme(settings.darkMode, settings.lightThemePreset, settings.darkThemePreset)

  useTranscriptions(settings.phraseReplacements)

  useEffect(() => {
    void analytics.setConsent(settings.analyticsConsentEnabled)
    setRendererMonitoringConsent(settings.analyticsConsentEnabled)
  }, [settings.analyticsConsentEnabled])

  useEffect(() => {
    initializeDesktopSync()
  }, [])

  // Check onboarding and auth status on mount
  useEffect(() => {
    const checkStatus = async (): Promise<void> => {
      try {
        const isComplete = await window.bridge?.checkOnboardingComplete?.()
        const session = await loadVerifiedAuthSession()
        const authed = Boolean(session?.authenticated && session.user?.id)
        dispatchAuthReady(authed)

        // If onboarding is complete, check if user is authenticated
        if (isComplete) {
          if (!authed) {
            // User completed onboarding before but is not signed in - show auth page
            console.log('[App] Not authenticated, showing auth page')
            setShowAuthOnly(true)
            setShowOnboarding(false)
          } else {
            // User is authenticated, proceed normally
            if (session?.user) {
              analytics.identify(session.user.id)
            }
            await migrateLegacyDesktopKnowledge(session!.user.id).catch((error) =>
              console.warn('[App] Local knowledge migration will resume later:', error)
            )
            void forceDesktopSync()
            void refreshBootstrap()
            // Migrate any legacy localStorage chats to cloud conversations (idempotent no-op
            // when no legacy local chats exist).
            void migrateLocalChatsToCloud().catch((error) =>
              console.warn('[App] Local chat migration failed:', error)
            )
            setShowOnboarding(false)
          }
        } else {
          // First time user, show full onboarding
          setShowOnboarding(true)
        }
      } catch (e) {
        console.error('Failed to check status:', e)
        const session = await loadVerifiedAuthSession().catch(() => null)
        const authed = Boolean(session?.authenticated && session?.user?.id)
        dispatchAuthReady(authed)
        if (!authed) {
          setShowAuthOnly(true)
        }
        setShowOnboarding(false)
      }
    }
    checkStatus()
  }, [refreshBootstrap])

  useEffect(() => {
    if (window.bridge) {
      window.bridge.updatePushToTalkHotkey(settings.pushToTalkHotkey)
      window.bridge.updateTranscriptionModeHotkey(settings.transcriptionModeHotkey)
      window.bridge.updateAutoMute(settings.autoMute)
      window.bridge.updateAssistantModeHotkey(settings.assistantModeHotkey)
      window.bridge.updateAssistantScreenshot(settings.assistantScreenshotEnabled)
      window.bridge.updateLocalTranscription(settings.localTranscription)
      if (window.bridge.updateCloudTranscription) {
        window.bridge.updateCloudTranscription(settings.cloudTranscription)
      }
      // Register panel hotkeys at startup
      if (settings.chatPanelHotkey) {
        window.bridge.updateChatPanelHotkey(settings.chatPanelHotkey)
      }
      if (settings.notebookPanelHotkey) {
        window.bridge.updateNotebookPanelHotkey(settings.notebookPanelHotkey)
      }
      if (settings.browserPanelHotkey) {
        window.bridge.updateBrowserPanelHotkey?.(settings.browserPanelHotkey)
      }
    }

    void window.bridge?.updateSoundEffects(settings.soundEffects)
    void window.bridge?.updateSmartTranscription(settings.smartTranscription)
    void window.bridge?.updateAssistantMode(settings.assistantModeEnabled)
    void window.bridge?.updateRecordingStorage(settings.recordingStorageEnabled)
    void window.bridge?.updateRecordingRetention(settings.recordingStorageRetention)
    void window.bridge?.updateShowPanelsOnStartup(settings.showPanelsOnStartup)
  }, [])

  // Listen for model download progress globally (persists across settings/main view)
  useEffect(() => {
    const removeListener = window.bridge?.onDownloadProgress?.((progress: DownloadProgress) => {
      if (progress.percent >= 100) {
        setTimeout(() => setDownloadProgress(null), 1500)
      }
      setDownloadProgress(progress)
    })

    return () => {
      if (removeListener) removeListener()
    }
  }, [])

  // Global session transfer listener - handles "Open in Overlay" from landing page
  // This works even when the user is past onboarding and using the main app
  useEffect(() => {
    const unsubscribeSessionTransfer = window.bridge?.onSessionTransfer?.(async (data) => {
      console.log('[App] Received session transfer from landing page')

      try {
        const session = await loadVerifiedAuthSession()
        if (!session || session.user.id !== data.user.id) {
          dispatchAuthReady(false)
          throw new Error('native_auth_bootstrap_verification_failed')
        }
        dispatchAuthReady(true)

        // Update analytics with new user
        analytics.identify(data.user.id)

        // Refresh bootstrap for the new user so the model catalog and entitlements are current
        await refreshBootstrap()

        console.log('[App] Session transfer complete - app state updated')

        // If currently showing auth-only page, switch to main app
        if (showAuthOnly) {
          setShowAuthOnly(false)
        }

        // Force a re-render of settings if visible to show new user
        if (showSettings) {
          setShowSettings(false)
          setTimeout(() => setShowSettings(true), 100)
        }
        await migrateLegacyDesktopKnowledge(data.user.id).catch((error) =>
          console.warn('[App] Local knowledge migration will resume later:', error)
        )
        void forceDesktopSync()
        void refreshBootstrap()
      } catch (error) {
        console.error('[App] Session transfer failed:', error)
      }
    })

    return () => {
      unsubscribeSessionTransfer?.()
    }
  }, [showAuthOnly, showSettings, refreshBootstrap])

  const handleOnboardingComplete = async (): Promise<void> => {
    try {
      await window.bridge?.setOnboardingComplete?.()
      const session = await loadVerifiedAuthSession()
      const authed = Boolean(session?.authenticated && session?.user?.id)
      dispatchAuthReady(authed)

      if (!authed) {
        setShowAuthOnly(true)
        setShowOnboarding(false)
        return
      }

      if (session?.user) {
        analytics.identify(session.user.id)
      }
      await migrateLegacyDesktopKnowledge(session!.user.id).catch((error) =>
        console.warn('[App] Local knowledge migration will resume later:', error)
      )
      void forceDesktopSync()
      void refreshBootstrap()
      setShowOnboarding(false)
    } catch (e) {
      console.error('Failed to set onboarding complete:', e)
      setShowOnboarding(false)
    }
  }

  const handleOpenSettings = useCallback((): void => {
    setShowSettings(true)
  }, [])

  const handleCloseSettings = useCallback((): void => {
    setShowSettings(false)
  }, [])

  const handleSignOut = useCallback(async (): Promise<void> => {
    await clearAuthSession()
    analytics.reset()
    setShowSettings(false)
    setShowAuthOnly(true)
  }, [])

  // Listen for forced sign-out from main process (e.g. when refresh token is permanently expired)
  useEffect(() => {
    const handler = (data?: { reason?: 'session_expired' }): void => {
      console.warn('[App] Forced sign-out received from main process')
      setAuthFailureReason(data?.reason === 'session_expired' ? 'session_expired' : null)
      void handleSignOut()
    }
    return window.bridge?.onForceSignOut?.(handler)
  }, [handleSignOut])

  const handleAuthComplete = useCallback(async (): Promise<void> => {
    const session = await loadVerifiedAuthSession()
    const authed = Boolean(session?.authenticated && session?.user?.id)

    if (!authed) {
      setShowAuthOnly(true)
      return
    }

    if (session?.user) {
      analytics.identify(session.user.id)
    }
    await migrateLegacyDesktopKnowledge(session!.user.id).catch((error) =>
      console.warn('[App] Local knowledge migration will resume later:', error)
    )
    void forceDesktopSync()
    void refreshBootstrap()
    setShowAuthOnly(false)
  }, [refreshBootstrap])

  // Show loading state while checking onboarding
  if (showOnboarding === null) {
    return <div style={{ background: 'transparent' }} />
  }

  if (showOnboarding) {
    return <OnboardingPage key="full-onboarding" onComplete={handleOnboardingComplete} />
  }

  // Show auth-only page after sign out (no full onboarding, just auth)
  if (showAuthOnly) {
    return (
      <OnboardingPage
        key="auth-only"
        onComplete={handleAuthComplete}
        startAtAuth
      />
    )
  }

  return (
    <>
      <div>
        {showSettings ? (
          <SettingsPage
            onBack={handleCloseSettings}
            onSignOut={handleSignOut}
            sidebarExpanded={sidebarExpanded}
            onToggleSidebar={() => setSidebarExpanded((prev) => !prev)}
          />
        ) : (
          <MainWindow
            onOpenSettings={handleOpenSettings}
            sidebarExpanded={sidebarExpanded}
            onToggleSidebar={() => setSidebarExpanded((prev) => !prev)}
          />
        )}
      </div>

      {/* Global Model Download Progress Indicator */}
      {downloadProgress && (
        <div
          style={{
            position: 'fixed',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: theme.background,
            border: `1px solid ${theme.border}`,
            borderRadius: '12px',
            padding: '12px 20px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 10000,
            minWidth: '300px',
            maxWidth: '400px',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px'
            }}
          >
            <span style={{ fontSize: '13px', color: theme.text, fontWeight: 500 }}>
              Downloading model...
            </span>
            <span style={{ fontSize: '12px', color: theme.textSecondary }}>
              {downloadProgress.percent}%
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: '4px',
              background: theme.buttonBg,
              borderRadius: '2px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${downloadProgress.percent}%`,
                height: '100%',
                background: theme.accent,
                transition: 'width 0.3s ease'
              }}
            />
          </div>
          <p
            style={{
              fontSize: '11px',
              color: theme.textSecondary,
              marginTop: '8px',
              marginBottom: 0,
              lineHeight: '1.3'
            }}
          >
            {downloadProgress.downloadedFormatted} / {downloadProgress.totalFormatted} — Whisper
            Base available for transcription
          </p>
        </div>
      )}
    </>
  )
}

export default function App(): ReactElement {
  useWindowZoom()

  // Sync auth with the main process as early as possible and signal readiness.
  // ChatProvider and other API consumers wait for this event before making
  // authenticated calls so they don't race the main process auth setup.
  useEffect(() => {
    const syncAuth = async (): Promise<void> => {
      try {
        const session = await loadVerifiedAuthSession()
        const authed = Boolean(session?.authenticated && session.user?.id)
        dispatchAuthReady(authed)
      } catch (error) {
        console.error('[App] Failed to sync auth state:', error)
        dispatchAuthReady(false)
      }
    }
    void syncAuth()
  }, [])

  const urlParams = new URLSearchParams(window.location.search)
  const windowType = urlParams.get('window') || 'overlay'

  // Panel windows apply zoom inside DockablePanel's content wrapper.
  // Non-panel windows need a zoom wrapper at this level.
  const isPanelWindow =
    windowType === 'chat' ||
    windowType === 'notebook' ||
    windowType === 'browser' ||
    windowType === 'notification'

  const content = (() => {
    switch (windowType) {
      case 'main':
        return <MainApp />
      case 'notebook':
        return <NotebookPanel />
      case 'chat':
        return <ChatPanel />
      case 'transcription':
        return <TranscriptionPanel />
      case 'browser':
        return <BrowserPanel />
      case 'notification':
        return <NotificationPage />
      default:
        return <OverlayWindow />
    }
  })()

  return (
    <Sentry.ErrorBoundary fallback={<p>An error occurred.</p>}>
      <AppBootstrapProvider>
        <SubscriptionProvider>
          <ChatProvider>
            {isPanelWindow ? (
              content
            ) : (
              <div style={{ width: '100%', height: '100%', zoom: 'var(--app-zoom, 1)' }}>
                {content}
              </div>
            )}
          </ChatProvider>
        </SubscriptionProvider>
      </AppBootstrapProvider>
    </Sentry.ErrorBoundary>
  )
}
