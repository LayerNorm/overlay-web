import { ReactElement, useState, useEffect, useCallback } from 'react'
import { Theme } from '../../utils/theme'
import { SettingsRow } from '../ui/SettingsRow'
import { Button } from '../ui/Button'
import { Pencil, RotateCw } from 'lucide-react'
import { TierBadge } from '../ui/TierBadge'
import { UsageBar } from '../ui/UsageBar'
import { useSubscription } from '../../hooks/useSubscription'
import { formatBytes } from '../../utils/formatBytes'
import {
  loadAuthSessionSecure,
  clearAuthSession,
  CUSTOM_AUTH_BASE_URL
} from '../../services/auth-service'
import type { AuthSession } from '../../services/auth-service'

const USER_PROFILE_KEY = 'overlay-user-profile'

const LANDING_PAGE_URL = CUSTOM_AUTH_BASE_URL

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'update-available'
  | 'downloading'
  | 'update-downloaded'
  | 'up-to-date'
  | 'error'

interface UserProfile {
  displayName: string
}

interface ServerProfile {
  deploymentId: string
  mode: 'cloud' | 'self-hosted'
  origin: string
  verifiedAt: number
}

function loadUserProfile(): UserProfile | null {
  try {
    const stored = localStorage.getItem(USER_PROFILE_KEY)
    if (stored) return JSON.parse(stored)
  } catch (e) {
    console.error('[Auth] Failed to load user profile:', e)
  }
  return null
}

function saveUserProfile(profile: UserProfile): void {
  localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile))
}

interface AccountSettingsProps {
  theme: Theme
  onSignOut: () => void
}

function StorageUsageBar({
  usedBytes,
  limitBytes,
  theme
}: {
  usedBytes: number
  limitBytes: number
  theme: Theme
}): ReactElement<any> {
  const normalizedUsed = Math.max(0, usedBytes)
  const normalizedLimit = Math.max(0, limitBytes)
  const remainingBytes = Math.max(0, normalizedLimit - normalizedUsed)
  const usedPct = normalizedLimit > 0 ? Math.min(100, (normalizedUsed / normalizedLimit) * 100) : 0
  const warning = usedPct >= 80
  const exhausted = normalizedLimit > 0 && remainingBytes <= 0
  const color = exhausted ? '#ef4444' : warning ? '#f59e0b' : theme.text

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', color }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          fontSize: '12px'
        }}
      >
        <span style={{ color }}>{formatBytes(remainingBytes)} available</span>
        <span
          style={{
            color: theme.textSecondary,
            fontSize: '11px',
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {formatBytes(normalizedUsed)} / {formatBytes(normalizedLimit)}
        </span>
      </div>
      <div
        style={{
          height: '6px',
          background: theme.border,
          borderRadius: '999px',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${usedPct}%`,
            background: color,
            borderRadius: '999px',
            transition: 'width 0.2s ease'
          }}
        />
      </div>
    </div>
  )
}

export function AccountSettings({ theme, onSignOut }: AccountSettingsProps): ReactElement<any> {
  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState('')
  const [serverProfile, setServerProfile] = useState<ServerProfile | null>(null)
  const [serverStatus, setServerStatus] = useState<string | null>(null)
  const subscription = useSubscription()

  // Update states
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [currentVersion, setCurrentVersion] = useState<string>('')
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [updateError, setUpdateError] = useState<string | null>(null)

  // Load the non-sensitive auth state owned by the main process.
  useEffect(() => {
    const profile = loadUserProfile()
    setUserProfile(profile)
    void loadAuthSessionSecure()
      .then(setAuthSession)
      .finally(() => setIsLoading(false))
    void window.bridge?.server?.getProfile?.().then(setServerProfile)

    // Listen for storage changes from other parts of the app (e.g., NameStep)
    const handleStorageChange = (e: StorageEvent): void => {
      if (e.key === USER_PROFILE_KEY) {
        const newProfile = loadUserProfile()
        setUserProfile(newProfile)
      }
    }
    window.addEventListener('storage', handleStorageChange)

    // Also re-check profile when window gains focus (for same-window updates)
    const handleFocus = (): void => {
      const freshProfile = loadUserProfile()
      setUserProfile(freshProfile)
    }
    window.addEventListener('focus', handleFocus)

    // Load current version
    window.bridge?.updater?.getCurrentVersion?.().then((version) => {
      setCurrentVersion(version)
    })

    // Check initial update status
    window.bridge?.updater?.getStatus?.().then((status) => {
      if (status.updateDownloaded) {
        setUpdateStatus('update-downloaded')
      } else if (status.updateAvailable) {
        setUpdateStatus('update-available')
      }
      if (status.latestVersion) {
        setLatestVersion(status.latestVersion)
      }
    })

    // Listen for update events
    const unsubscribe = window.bridge?.updater?.onStatus?.((statusEvent) => {
      console.log('[Updater] Status event:', statusEvent)
      switch (statusEvent.status) {
        case 'checking-for-update':
          setUpdateStatus('checking')
          setUpdateError(null)
          break
        case 'update-available':
          setUpdateStatus('update-available')
          if (statusEvent.data?.version) {
            setLatestVersion(statusEvent.data.version)
          }
          break
        case 'update-not-available':
          setUpdateStatus('up-to-date')
          break
        case 'download-progress':
          setUpdateStatus('downloading')
          if (statusEvent.data?.percent !== undefined) {
            setDownloadProgress(statusEvent.data.percent)
          }
          break
        case 'update-downloaded':
          setUpdateStatus('update-downloaded')
          if (statusEvent.data?.version) {
            setLatestVersion(statusEvent.data.version)
          }
          break
        case 'error':
          setUpdateStatus('error')
          setUpdateError(statusEvent.data?.message || 'An error occurred')
          break
      }
    })

    return () => {
      unsubscribe?.()
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  const handleSignOut = useCallback(async () => {
    console.log('[Auth] Signing out...')
    await clearAuthSession()
    localStorage.removeItem(USER_PROFILE_KEY)
    setAuthSession(null)
    setUserProfile(null)
    onSignOut()
  }, [onSignOut])

  const handleEditName = useCallback(() => {
    const currentName = userProfile?.displayName || authSession?.user.firstName || ''
    setEditName(currentName)
    setIsEditingName(true)
  }, [userProfile, authSession])

  const handleSaveName = useCallback(() => {
    if (editName.trim()) {
      const newProfile = { displayName: editName.trim() }
      saveUserProfile(newProfile)
      setUserProfile(newProfile)
    }
    setIsEditingName(false)
  }, [editName])

  const handleCancelEdit = useCallback(() => {
    setIsEditingName(false)
    setEditName('')
  }, [])

  const handleCheckForUpdates = useCallback(async () => {
    setUpdateStatus('checking')
    setUpdateError(null)
    try {
      await window.bridge?.updater?.checkForUpdates?.()
    } catch (error) {
      setUpdateStatus('error')
      setUpdateError(error instanceof Error ? error.message : 'Failed to check for updates')
    }
  }, [])

  const handleInstallUpdate = useCallback(() => {
    window.bridge?.updater?.quitAndInstall?.()
  }, [])

  const handleOpenBillingPortal = useCallback(async () => {
    // Billing changes require an interactive web session and server-side
    // reauthentication; bearer-authenticated desktop IPC cannot mutate billing.
    await window.bridge?.openExternal?.(`${serverProfile?.origin || LANDING_PAGE_URL}/account`)
  }, [serverProfile])

  const handleDeleteAccount = useCallback(async () => {
    const confirmed = window.confirm(
      'Delete this Overlay account and its cloud data? This cannot be undone.'
    )
    if (!confirmed) return
    await window.bridge?.openExternal?.(
      `${serverProfile?.origin || LANDING_PAGE_URL}/account?intent=delete-account`
    )
  }, [serverProfile])

  const switchServer = useCallback(
    async (origin: string) => {
      try {
        setServerStatus('Verifying server…')
        const profile = await window.bridge.server.verifyProfile(origin)
        const confirmed = window.confirm(
          `Trust and switch to ${profile.origin}?\n\nDeployment: ${profile.deploymentId}\n\nSwitching signs you out and credentials from the current server will not be reused.`
        )
        if (!confirmed) {
          setServerStatus(null)
          return
        }
        const activated = await window.bridge.server.activateProfile(profile, profile.origin)
        setServerProfile(activated)
        setAuthSession(null)
        setServerStatus('Server changed. Sign in to continue.')
        onSignOut()
      } catch (error) {
        setServerStatus(error instanceof Error ? error.message : 'Could not verify that server')
      }
    },
    [onSignOut]
  )

  const handleChooseSelfHosted = useCallback(() => {
    const origin = window.prompt(
      'Enter the exact HTTPS origin of your self-hosted Overlay Server (for example, https://overlay.example.com):'
    )
    if (origin?.trim()) void switchServer(origin.trim())
  }, [switchServer])

  if (isLoading) {
    return (
      <div style={{ color: theme.textSecondary, fontSize: '14px', padding: '24px' }}>
        Loading...
      </div>
    )
  }

  if (!authSession) {
    return (
      <div
        style={{
          padding: '24px',
          background: theme.surface,
          borderRadius: '12px',
          border: `1px solid ${theme.border}`,
          textAlign: 'center'
        }}
      >
        <p style={{ color: theme.textSecondary, margin: 0 }}>Not signed in</p>
      </div>
    )
  }

  const displayName = userProfile?.displayName || authSession.user.firstName || 'User'
  const email = authSession.user.email

  return (
    <div>
      <div
        style={{
          padding: '20px',
          marginBottom: '24px',
          background: theme.surface,
          borderRadius: '12px',
          border: `1px solid ${theme.border}`
        }}
      >
        <h3 style={{ margin: 0, marginBottom: '6px', color: theme.text, fontSize: '15px' }}>
          Overlay Server
        </h3>
        <p
          style={{ margin: 0, marginBottom: '14px', color: theme.textSecondary, fontSize: '12px' }}
        >
          {serverProfile
            ? `${serverProfile.mode === 'cloud' ? 'Overlay Cloud' : 'Self-hosted'} · ${serverProfile.origin}`
            : 'Loading server profile…'}
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            onClick={() => void switchServer('https://www.getoverlay.io')}
            disabled={serverProfile?.origin === 'https://www.getoverlay.io'}
          >
            Use Overlay Cloud
          </Button>
          <Button onClick={handleChooseSelfHosted}>Use self-hosted server</Button>
        </div>
        {serverStatus && (
          <p style={{ margin: '10px 0 0', color: theme.textSecondary, fontSize: '12px' }}>
            {serverStatus}
          </p>
        )}
      </div>

      {/* Profile Card */}
      <div
        style={{
          padding: '24px',
          marginBottom: '24px',
          background: theme.surface,
          borderRadius: '12px',
          border: `1px solid ${theme.border}`
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {authSession.user.profilePictureUrl ? (
            <img
              src={authSession.user.profilePictureUrl}
              alt="Profile"
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                objectFit: 'cover'
              }}
            />
          ) : (
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: theme.accent,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.background,
                fontSize: '24px',
                fontWeight: 600
              }}
            >
              {displayName[0]?.toUpperCase() || '?'}
            </div>
          )}
          <div style={{ flex: 1 }}>
            {isEditingName ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName()
                    if (e.key === 'Escape') handleCancelEdit()
                  }}
                  autoFocus
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '16px',
                    fontWeight: 600,
                    background: theme.background,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '8px',
                    color: theme.text,
                    outline: 'none'
                  }}
                />
                <button
                  onClick={handleSaveName}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    color: theme.text,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                    textDecoration: 'underline',
                    textDecorationThickness: '2px',
                    textUnderlineOffset: '3px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.border
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  Save
                </button>
                <button
                  onClick={handleCancelEdit}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    color: theme.textSecondary,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                    textDecoration: 'underline',
                    textDecorationThickness: '2px',
                    textUnderlineOffset: '3px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.border
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div
                  style={{
                    fontSize: '20px',
                    fontWeight: 600,
                    color: theme.text,
                    marginBottom: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                  onClick={handleEditName}
                  title="Click to edit name"
                >
                  {displayName}
                  <TierBadge tier={subscription.tier} size="md" />
                  <Pencil size={14} color={theme.textSecondary} />
                </div>
                <div style={{ fontSize: '14px', color: theme.textSecondary }}>{email}</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Usage Section */}
      <div
        style={{
          padding: '20px 24px',
          marginBottom: '24px',
          background: theme.surface,
          borderRadius: '12px',
          border: `1px solid ${theme.border}`
        }}
      >
        <div
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: theme.text,
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Usage</span>
            <button
              onClick={() => subscription.refresh()}
              title="Refresh usage"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                color: theme.textSecondary,
                transition: 'color 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = theme.text
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = theme.textSecondary
              }}
            >
              <RotateCw size={14} />
            </button>
          </div>
          <TierBadge tier={subscription.tier} />
        </div>

        {subscription.tier === 'free' ? (
          <div>
            {/* Weekly Requests Usage */}
            <div style={{ marginBottom: '8px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px'
                }}
              >
                <span style={{ fontSize: '12px', color: theme.textSecondary }}>
                  Weekly Requests
                </span>
                <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                  {Math.round(subscription.dailyUsagePercentage)}% remaining
                </span>
              </div>
              <UsageBar
                used={
                  subscription.dailyUsage.ask +
                  subscription.dailyUsage.write +
                  subscription.dailyUsage.agent
                }
                total={
                  subscription.dailyLimits.ask +
                  subscription.dailyLimits.write +
                  subscription.dailyLimits.agent
                }
                label=""
                isDark={theme.text === '#ffffff' || theme.text === '#fff'}
                showPercentage={false}
                showTooltip
                resetTime={subscription.weeklyResetTime}
              />
            </div>
            {/* Transcription Usage */}
            <div style={{ marginTop: '12px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px'
                }}
              >
                <span style={{ fontSize: '12px', color: theme.textSecondary }}>Transcription</span>
                <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                  {Math.round(subscription.transcriptionPercentage)}% remaining
                </span>
              </div>
              <UsageBar
                used={subscription.transcriptionMinutesUsed}
                total={subscription.transcriptionMinutesLimit}
                label=""
                isDark={theme.text === '#ffffff' || theme.text === '#fff'}
                showPercentage={false}
                showTooltip
                resetTime={subscription.weeklyResetTime}
              />
            </div>
            <button
              onClick={() => {
                const userId = authSession?.user?.id || ''
                const pricingUrl = userId
                  ? `${LANDING_PAGE_URL}/pricing?userId=${encodeURIComponent(userId)}`
                  : `${LANDING_PAGE_URL}/pricing`
                window.bridge?.openExternal?.(pricingUrl)
              }}
              style={{
                marginTop: '16px',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 500,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                color: theme.text === '#ffffff' || theme.text === '#fff' ? '#0a0a0a' : '#fafafa',
                background:
                  theme.text === '#ffffff' || theme.text === '#fff' ? '#fafafa' : '#0a0a0a',
                border: 'none',
                cursor: 'pointer',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  theme.text === '#ffffff' || theme.text === '#fff' ? '#e4e4e7' : '#27272a'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  theme.text === '#ffffff' || theme.text === '#fff' ? '#fafafa' : '#0a0a0a'
              }}
            >
              Upgrade to Pro
            </button>
          </div>
        ) : (
          <div>
            {/* Subscription Credits Usage Bar - Show as percentage */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px'
                }}
              >
                <span style={{ fontSize: '12px', color: theme.textSecondary }}>Credits</span>
                <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                  {Math.round(subscription.creditsPercentage)}% remaining
                </span>
              </div>
              <div
                style={{
                  height: '6px',
                  background: theme.border,
                  borderRadius: '3px',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${subscription.creditsPercentage}%`,
                    background:
                      theme.text === '#ffffff' || theme.text === '#fff' ? '#ffffff' : '#000000',
                    borderRadius: '3px'
                  }}
                />
              </div>
            </div>
            {/* Manage Subscription Button */}
            <button
              onClick={() => void handleOpenBillingPortal()}
              style={{
                marginTop: '16px',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 500,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                color: theme.text,
                background: 'transparent',
                border: `1px solid ${theme.border}`,
                cursor: 'pointer',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = theme.border
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              Manage Subscription
            </button>
          </div>
        )}

        <div
          style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${theme.border}` }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '6px'
            }}
          >
            <span style={{ fontSize: '12px', color: theme.textSecondary }}>Storage</span>
            <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
              {subscription.overlayStorageBytesLimit > 0
                ? `${Math.round(
                    Math.min(
                      100,
                      (subscription.overlayStorageBytesUsed /
                        subscription.overlayStorageBytesLimit) *
                        100
                    )
                  )}% used`
                : 'No limit'}
            </span>
          </div>
          <StorageUsageBar
            usedBytes={subscription.overlayStorageBytesUsed}
            limitBytes={subscription.overlayStorageBytesLimit}
            theme={theme}
          />
        </div>
      </div>

      {/* Account Settings */}
      <SettingsRow title="Display Name" description="Your name shown in the app" theme={theme}>
        <button
          onClick={handleEditName}
          style={{
            padding: '6px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: theme.text,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
            textDecoration: 'underline',
            textDecorationThickness: '2px',
            textUnderlineOffset: '3px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.border
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          Edit
        </button>
      </SettingsRow>

      <SettingsRow title="Email" description="Your account email address" theme={theme}>
        <span style={{ color: theme.textSecondary, fontSize: '14px' }}>{email}</span>
      </SettingsRow>

      <SettingsRow
        title="Sign Out"
        description="Sign out of your account on this device"
        theme={theme}
      >
        <button
          onClick={handleSignOut}
          style={{
            padding: '6px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#ef4444',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
            textDecoration: 'underline',
            textDecorationThickness: '2px',
            textUnderlineOffset: '3px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.border
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          Sign Out
        </button>
      </SettingsRow>

      <SettingsRow
        title="Delete Account"
        description="Permanently delete your account and cloud data"
        theme={theme}
      >
        <button
          onClick={() => void handleDeleteAccount()}
          style={{
            padding: '6px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#ef4444',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
            textDecoration: 'underline',
            textDecorationThickness: '2px',
            textUnderlineOffset: '3px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.border
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          Delete
        </button>
      </SettingsRow>

      <SettingsRow title="Terms of Service" description="View our terms of service" theme={theme}>
        <button
          onClick={() => window.bridge?.openExternal?.('https://www.getoverlay.io/terms')}
          style={{
            padding: '6px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: theme.text,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
            textDecoration: 'underline',
            textDecorationThickness: '2px',
            textUnderlineOffset: '3px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.border
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          View
        </button>
      </SettingsRow>

      <SettingsRow title="Privacy Policy" description="View our privacy policy" theme={theme}>
        <button
          onClick={() => window.bridge?.openExternal?.('https://www.getoverlay.io/privacy')}
          style={{
            padding: '6px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: theme.text,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
            textDecoration: 'underline',
            textDecorationThickness: '2px',
            textUnderlineOffset: '3px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.border
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          View
        </button>
      </SettingsRow>

      <SettingsRow
        title="Give Feedback"
        description="Email feedback directly to the founder"
        theme={theme}
      >
        <button
          onClick={() =>
            window.bridge?.openExternal?.(
              'mailto:work.dslalwani@gmail.com?subject=overlay%20feedback%3A%20'
            )
          }
          style={{
            padding: '6px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: theme.text,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
            textDecoration: 'underline',
            textDecorationThickness: '2px',
            textUnderlineOffset: '3px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.border
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          Give Feedback
        </button>
      </SettingsRow>

      <SettingsRow
        title="Check for Updates"
        description={getUpdateDescription(
          updateStatus,
          latestVersion,
          downloadProgress,
          updateError
        )}
        theme={theme}
      >
        {updateStatus === 'update-downloaded' ? (
          <button
            onClick={handleInstallUpdate}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.text,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
              textDecoration: 'underline',
              textDecorationThickness: '2px',
              textUnderlineOffset: '3px',
              fontWeight: 600
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            Restart to Update
          </button>
        ) : (
          <button
            onClick={handleCheckForUpdates}
            disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color:
                updateStatus === 'checking' || updateStatus === 'downloading'
                  ? theme.textSecondary
                  : theme.text,
              background: 'transparent',
              border: 'none',
              cursor:
                updateStatus === 'checking' || updateStatus === 'downloading'
                  ? 'not-allowed'
                  : 'pointer',
              transition: 'background 0.15s ease',
              textDecoration: 'underline',
              textDecorationThickness: '2px',
              textUnderlineOffset: '3px',
              opacity: updateStatus === 'checking' || updateStatus === 'downloading' ? 0.5 : 1
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {updateStatus === 'checking'
              ? 'Checking...'
              : updateStatus === 'downloading'
                ? `Downloading ${Math.round(downloadProgress)}%`
                : 'Check for Updates'}
          </button>
        )}
      </SettingsRow>

      {/* Version Number */}
      <div
        style={{
          marginTop: '32px',
          textAlign: 'center'
        }}
      >
        <span
          style={{
            fontSize: '12px',
            color: theme.textSecondary,
            fontFamily: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace'
          }}
        >
          <span style={{ fontFamily: "'Libre Baskerville', Georgia, serif" }}>overlay</span> v
          {currentVersion || '...'}
        </span>
      </div>
    </div>
  )
}

function getUpdateDescription(
  status: UpdateStatus,
  latestVersion: string | null,
  downloadProgress: number,
  error: string | null
): string {
  switch (status) {
    case 'checking':
      return 'Checking for updates...'
    case 'update-available':
      return latestVersion ? `Version ${latestVersion} is available` : 'A new version is available'
    case 'downloading':
      return `Downloading update... ${Math.round(downloadProgress)}%`
    case 'update-downloaded':
      return latestVersion
        ? `Version ${latestVersion} is ready to install`
        : 'Update is ready to install'
    case 'up-to-date':
      return "You're running the latest version"
    case 'error':
      return error || 'Failed to check for updates'
    default:
      return 'Check if a newer version is available'
  }
}
