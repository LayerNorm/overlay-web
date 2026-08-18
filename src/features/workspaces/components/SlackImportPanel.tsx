'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Hash,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
  Users,
  X,
} from 'lucide-react'
import { Button, EmptyState } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from './WorkspaceProvider'

interface SlackChannel {
  id: string
  name: string
  type: 'public_channel' | 'private_channel' | 'im' | 'mpim'
  isPrivate: boolean
  memberCount: number
}

interface SlackUser {
  id: string
  name: string
  displayName: string
  email: string | null
  avatar: string | null
  isBot: boolean
  isDeleted: boolean
  status: 'member' | 'invited' | 'new'
}

interface SlackImportJob {
  _id: string
  status: string
  selectedChannelIds: string[]
  totalChannels?: number
  processedChannels?: number
  totalMessages?: number
  coverage?: {
    publicChannels: number
    privateChannels: number
    dms: number
    mpims: number
    messagesImported: number
    filesDownloaded: number
    threadsImported: number
  }
  error?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
}

type ConnectionState = 'loading' | 'not_connected' | 'connected'

const CHANNEL_TYPE_ICON = {
  public_channel: Hash,
  private_channel: Lock,
  im: MessageSquare,
  mpim: Users,
} as const

const CHANNEL_TYPE_LABEL = {
  public_channel: 'Public',
  private_channel: 'Private',
  im: 'DM',
  mpim: 'Group DM',
} as const

const ACTIVE_JOB_STATUSES = new Set(['queued', 'listing_channels', 'importing'])
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled'])

/**
 * Fetch helper with retry on 429. Returns { ok, data, status }.
 * Retries up to 2 times with exponential backoff (1s, 2s).
 */
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 2,
): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { credentials: 'same-origin', ...options })
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      if (res.status === 429 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }
      return { ok: res.ok, data, status: res.status }
    } catch {
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }
      return { ok: false, data: { error: 'Network request failed' }, status: 0 }
    }
  }
  return { ok: false, data: { error: 'Max retries exceeded' }, status: 0 }
}

export function SlackImportPanel({ onBack }: { onBack?: () => void } = {}) {
  const { activeWorkspace } = useWorkspace()
  const { user } = useAuth()
  const workspaceId = activeWorkspace?.id
  const currentUserEmail = user?.email?.trim().toLowerCase() || null

  const [connectionState, setConnectionState] = useState<ConnectionState>('loading')
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [channelsLoaded, setChannelsLoaded] = useState(false)
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [channelsError, setChannelsError] = useState<string | null>(null)
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set())
  const [activeJob, setActiveJob] = useState<SlackImportJob | null>(null)
  const [jobs, setJobs] = useState<SlackImportJob[]>([])
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'people' | 'picker' | 'progress' | 'done'>('people')
  const [users, setUsers] = useState<SlackUser[]>([])
  const [usersLoaded, setUsersLoaded] = useState(false)
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())
  const [inviting, setInviting] = useState(false)
  const [oauthPolling, setOauthPolling] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const oauthPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  // ─── Load jobs list without touching the current view ───────────────────────
  const loadJobs = useCallback(async (): Promise<SlackImportJob[]> => {
    if (!workspaceId) return []
    const { ok, data } = await fetchWithRetry('/api/v1/imports/slack?action=jobs')
    if (!mountedRef.current) return []
    if (ok) {
      const jobList = (data.jobs ?? []) as SlackImportJob[]
      setJobs(jobList)
      return jobList
    }
    return []
  }, [workspaceId])

  // ─── Connection check via jobs endpoint ───────────────────────────────────
  // The jobs endpoint returns 400 "Slack is not connected" if there's no
  // connected Slack account. This avoids the heavy integrations catalog call.
  const checkConnection = useCallback(async (): Promise<boolean> => {
    if (!workspaceId) return false
    const { ok, data } = await fetchWithRetry('/api/v1/imports/slack?action=jobs')
    if (!mountedRef.current) return false
    if (ok) {
      const jobList = (data.jobs ?? []) as SlackImportJob[]
      setJobs(jobList)
      const active = jobList.find((j) => ACTIVE_JOB_STATUSES.has(j.status))
      if (active) {
        setActiveJob(active)
        setView('progress')
      }
      setConnectionState('connected')
      return true
    }
    // 400 with "not connected" message means Slack isn't connected yet
    const errMsg = String(data.error ?? '')
    if (errMsg.toLowerCase().includes('not connected') || data.error === 'Slack is not connected. Connect Slack via the integrations page first.') {
      setConnectionState('not_connected')
      return false
    }
    // Other errors (429, 500, etc.) — don't change state, just return false
    setConnectionState('not_connected')
    return false
  }, [workspaceId])

  // Initial mount check
  useEffect(() => {
    mountedRef.current = true
    void checkConnection()
    return () => {
      mountedRef.current = false
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      if (oauthPollRef.current) {
        clearInterval(oauthPollRef.current)
        oauthPollRef.current = null
      }
    }
  }, [checkConnection])

  // ─── Load channels ────────────────────────────────────────────────────────
  const loadChannels = useCallback(async (force = false) => {
    if (!workspaceId || connectionState !== 'connected') return
    if (channelsLoaded && !force) return
    setChannelsLoading(true)
    setChannelsError(null)
    try {
      const { ok, data } = await fetchWithRetry('/api/v1/imports/slack?action=channels')
      if (!mountedRef.current) return
      if (!ok) {
        throw new Error(String(data.error ?? 'Failed to load channels'))
      }
      const channelList = (data.channels ?? []) as SlackChannel[]
      setChannels(channelList)
      setChannelsLoaded(true)
    } catch (err) {
      if (!mountedRef.current) return
      setChannelsError(err instanceof Error ? err.message : 'Failed to load channels')
      // Mark as loaded to prevent the effect from re-firing infinitely.
      // The user can click "Try again" to reset and retry.
      setChannelsLoaded(true)
    } finally {
      if (mountedRef.current) setChannelsLoading(false)
    }
  }, [workspaceId, connectionState, channelsLoaded])

  // Load channels when entering picker view (not on mount — only when needed)
  useEffect(() => {
    if (view === 'picker' && connectionState === 'connected' && !channelsLoaded && !channelsLoading) {
      void loadChannels()
    }
  }, [view, connectionState, channelsLoaded, channelsLoading, loadChannels])

  // ─── Load Slack users and diff with workspace people ────────────────────────
  const loadUsers = useCallback(async (force = false) => {
    if (!workspaceId || connectionState !== 'connected') return
    if (usersLoaded && !force) return
    setUsersLoading(true)
    setUsersError(null)
    try {
      const { ok: usersOk, data: usersData } = await fetchWithRetry('/api/v1/imports/slack?action=users')
      if (!mountedRef.current) return
      if (!usersOk) {
        throw new Error(String(usersData.error ?? 'Failed to load Slack users'))
      }

      let mgmtData: { items: unknown[] } = { items: [] }
      try {
        mgmtData = await overlayAppClient.workspaces.management(activeWorkspace.id, 'people') as { items: unknown[] }
      } catch (err) {
        console.warn('[SlackImport] Failed to load workspace people:', err)
      }

      const slackUsers = (usersData.users ?? []) as Array<{
        id: string
        name: string
        displayName: string
        email: string | null
        avatar: string | null
        isBot: boolean
        isDeleted: boolean
      }>

      const mgmtItems = (mgmtData.items ?? []) as Array<{
        kind: string
        name: string
        description?: string
        status?: string
      }>

      const memberEmails = new Set<string>()
      const invitedEmails = new Set<string>()
      for (const item of mgmtItems) {
        const email = (item.kind === 'invitation' ? item.name : item.description)?.trim().toLowerCase()
        if (!email) continue
        if (item.kind === 'member' && item.status === 'active') memberEmails.add(email)
        else if (item.kind === 'invitation' && item.status === 'pending') invitedEmails.add(email)
      }

      // The signed-in user is, by definition, in the workspace. Their principal
      // email can be stale/missing in the management list, which would otherwise
      // mislabel their own Slack account as "New" — so add it explicitly.
      if (currentUserEmail) memberEmails.add(currentUserEmail)

      const merged = slackUsers
        .filter((u) => !u.isBot && !u.isDeleted && u.email)
        .map((u) => {
          const email = u.email!.toLowerCase()
          let status: SlackUser['status'] = 'new'
          if (memberEmails.has(email)) status = 'member'
          else if (invitedEmails.has(email)) status = 'invited'
          return { ...u, email, status } as SlackUser
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName))

      setUsers(merged)
      setUsersLoaded(true)
      // Auto-select all non-member users so the importer can invite them
      setSelectedUserIds(new Set(merged.filter((u) => u.status === 'new').map((u) => u.id)))
    } catch (err) {
      if (!mountedRef.current) return
      setUsersError(err instanceof Error ? err.message : 'Failed to load Slack users')
      setUsersLoaded(true)
    } finally {
      if (mountedRef.current) setUsersLoading(false)
    }
  }, [workspaceId, connectionState, usersLoaded, activeWorkspace?.id, currentUserEmail])

  useEffect(() => {
    if (view === 'people' && connectionState === 'connected' && !usersLoaded && !usersLoading) {
      void loadUsers()
    }
  }, [view, connectionState, usersLoaded, usersLoading, loadUsers])

  // ─── Poll active job for progress ─────────────────────────────────────────
  useEffect(() => {
    if (view !== 'progress' || !activeJob) return
    if (TERMINAL_JOB_STATUSES.has(activeJob.status)) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }

    const pollJob = async () => {
      if (!activeJob || !mountedRef.current) return
      const { ok, data } = await fetchWithRetry(
        `/api/v1/imports/slack?action=job&jobId=${activeJob._id}`,
      )
      if (!mountedRef.current) return
      if (ok) {
        const job = data as unknown as SlackImportJob
        setActiveJob(job)
        if (TERMINAL_JOB_STATUSES.has(job.status)) {
          if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
          // Land on the Done step; keep the completed job visible for the summary.
          setView('done')
          void loadJobs()
        }
      }
    }

    pollRef.current = setInterval(pollJob, 3000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeJob?._id, activeJob?.status])

  // ─── OAuth connect + poll for connection ──────────────────────────────────
  const handleConnect = useCallback(async () => {
    setError(null)
    setOauthPolling(true)
    const oauthTab = window.open('about:blank', '_blank')
    try {
      const res = await overlayAppClient.integrations.connectResponse({
        action: 'connect',
        providerKey: 'slackbot',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        oauthTab?.close()
        setError(data.error || 'Failed to connect to Slack')
        setOauthPolling(false)
      } else if (data.redirectUrl) {
        if (oauthTab) oauthTab.location.href = data.redirectUrl
        else window.open(data.redirectUrl, '_blank')

        // Poll for connection status every 3s for up to 5 minutes
        let pollCount = 0
        const maxPolls = 100 // 5 minutes at 3s intervals
        oauthPollRef.current = setInterval(async () => {
          pollCount++
          if (pollCount > maxPolls || !mountedRef.current) {
            if (oauthPollRef.current) {
              clearInterval(oauthPollRef.current)
              oauthPollRef.current = null
            }
            setOauthPolling(false)
            return
          }
          const connected = await checkConnection()
          if (connected && mountedRef.current) {
            if (oauthPollRef.current) {
              clearInterval(oauthPollRef.current)
              oauthPollRef.current = null
            }
            setOauthPolling(false)
          }
        }, 3000)
      } else {
        oauthTab?.close()
        setError('No connection URL was returned')
        setOauthPolling(false)
      }
    } catch (err) {
      oauthTab?.close()
      setError(err instanceof Error ? err.message : 'Failed to connect to Slack')
      setOauthPolling(false)
    }
  }, [checkConnection])

  // ─── Invite selected Slack users ──────────────────────────────────────────
  const handleInviteUsers = useCallback(async () => {
    if (!workspaceId) return
    const selected = users.filter((u) => selectedUserIds.has(u.id) && u.status === 'new' && u.email)
    if (selected.length === 0) {
      setView('picker')
      return
    }
    setInviting(true)
    setError(null)
    let failed = 0
    try {
      await Promise.all(
        selected.map((u) =>
          overlayAppClient.workspaces
            .invite(workspaceId, { email: u.email!, role: 'member' })
            .catch((err) => {
              console.error('[SlackImport] Failed to invite', u.email, err)
              failed++
            }),
        ),
      )
      if (failed > 0) {
        setError(`Failed to invite ${failed} user(s). You can continue and import channels for people already in the workspace.`)
      }
      // Refresh user list so newly-invited users appear as 'invited'
      void loadUsers(true)
      setView('picker')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitations')
    } finally {
      setInviting(false)
    }
  }, [workspaceId, users, selectedUserIds, loadUsers])

  // ─── Start import ─────────────────────────────────────────────────────────
  const handleStartImport = useCallback(async () => {
    if (selectedChannelIds.size === 0) return
    setStarting(true)
    setError(null)
    try {
      const { ok, data } = await fetchWithRetry('/api/v1/imports/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          selectedChannelIds: [...selectedChannelIds],
        }),
      })
      if (!ok) {
        const errMsg = String(data.error ?? 'Failed to start import')
        console.error('[SlackImport] Start import failed:', errMsg, data)
        throw new Error(errMsg)
      }
      // The POST response already includes job data — use it directly
      // instead of making a second request to fetch the job.
      const jobId = data.jobId as string
      if (!jobId) {
        console.error('[SlackImport] No jobId in response:', data)
        throw new Error('No job ID returned from server')
      }
      setActiveJob({
        _id: jobId,
        status: String(data.status ?? 'queued'),
        selectedChannelIds: [...selectedChannelIds],
        totalChannels: selectedChannelIds.size,
        processedChannels: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      setView('progress')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start import')
    } finally {
      setStarting(false)
    }
  }, [selectedChannelIds])

  // ─── Cancel import ────────────────────────────────────────────────────────
  const handleCancel = useCallback(async () => {
    if (!activeJob) return
    setCancelling(true)
    try {
      await fetchWithRetry('/api/v1/imports/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', jobId: activeJob._id }),
      })
    } catch {
      // ignore
    } finally {
      setCancelling(false)
    }
  }, [activeJob])

  // ─── Refresh channels ─────────────────────────────────────────────────────
  const handleRefreshChannels = useCallback(() => {
    setChannels([])
    setChannelsLoaded(false)
    void loadChannels(true)
  }, [loadChannels])

  // ─── Channel selection ────────────────────────────────────────────────────
  const toggleChannel = useCallback((channelId: string) => {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      return next
    })
  }, [])

  const selectAllPublic = useCallback(() => {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev)
      for (const ch of channels) {
        if (ch.type === 'public_channel') next.add(ch.id)
      }
      return next
    })
  }, [channels])

  const clearSelection = useCallback(() => {
    setSelectedChannelIds(new Set())
  }, [])

  // ─── Loading state ────────────────────────────────────────────────────────
  if (connectionState === 'loading') {
    return (
      <ImportFlow serviceLabel="Slack" step={null} onBack={onBack}>
        <div className="flex min-h-56 items-center justify-center px-5 text-sm text-[var(--muted)]">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Loading…
        </div>
      </ImportFlow>
    )
  }

  // ─── Not connected state ──────────────────────────────────────────────────
  if (connectionState === 'not_connected') {
    return (
      <ImportFlow serviceLabel="Slack" step={0} onBack={onBack}>
        <EmptyState
          className="min-h-56 px-6 py-10"
          icon={<Download size={30} strokeWidth={1.5} />}
          title="Connect Slack"
          description="Connect your Slack workspace to import channel history into Overlay conversations. Messages, threads, and files are imported deterministically — no AI processing."
          action={
            <Button size="sm" onClick={() => void handleConnect()} disabled={oauthPolling}>
              {oauthPolling ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {oauthPolling ? 'Waiting for connection…' : 'Connect Slack'}
            </Button>
          }
        />
      </ImportFlow>
    )
  }

  // ─── Progress view ────────────────────────────────────────────────────────
  if (view === 'progress' && activeJob) {
    return (
      <ImportFlow serviceLabel="Slack" step={3} onBack={onBack}>
        <JobProgressView
          job={activeJob}
          cancelling={cancelling}
          onCancel={() => void handleCancel()}
          onBackToPicker={() => {
            setView('picker')
            setActiveJob(null)
            void loadJobs()
          }}
        />
      </ImportFlow>
    )
  }

  // ─── Done view ────────────────────────────────────────────────────────────
  if (view === 'done' && activeJob) {
    return (
      <ImportFlow serviceLabel="Slack" step={4} onBack={onBack}>
        <JobDoneView
          job={activeJob}
          onBackToPicker={() => {
            setView('picker')
            setActiveJob(null)
            void loadJobs()
          }}
          onDone={onBack}
        />
      </ImportFlow>
    )
  }

  // ─── People view ──────────────────────────────────────────────────────────
  if (view === 'people') {
    return (
      <ImportFlow serviceLabel="Slack" step={1} onBack={onBack}>
      <div className="px-5 py-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Choose who to invite</h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Invite Slack members to your Overlay workspace before importing channels.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
            <button type="button" className="ml-auto shrink-0" onClick={() => setError(null)}>
              <X size={12} />
            </button>
          </div>
        )}

        {usersLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3">
                <span className="h-6 w-6 animate-pulse rounded-full bg-[var(--surface-subtle)]" />
                <span className="h-3 w-32 animate-pulse rounded bg-[var(--surface-subtle)]" />
              </div>
            ))}
          </div>
        ) : usersError ? (
          <EmptyState
            className="min-h-40 px-6 py-8"
            icon={<AlertCircle size={24} />}
            title="Could not load Slack users"
            description={usersError}
            action={
              <Button size="sm" onClick={() => void loadUsers(true)}>
                <RefreshCw size={12} />
                Try again
              </Button>
            }
          />
        ) : users.length === 0 ? (
          <EmptyState
            className="min-h-40 px-6 py-8"
            icon={<Users size={24} strokeWidth={1.5} />}
            title="No Slack users found"
            description="Your connected Slack account doesn't have access to the workspace member list."
          />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between text-xs text-[var(--muted)]">
              <span>{users.filter((u) => selectedUserIds.has(u.id)).length} selected</span>
              <span>
                {users.filter((u) => u.status === 'member').length} members ·{' '}
                {users.filter((u) => u.status === 'invited').length} invited ·{' '}
                {users.filter((u) => u.status === 'new').length} new
              </span>
            </div>

            <div className="max-h-80 space-y-1 overflow-y-auto">
              {users.map((u) => {
                const isSelected = selectedUserIds.has(u.id)
                return (
                  <label
                    key={u.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition-colors ${
                      isSelected
                        ? 'border-[var(--foreground)]/30 bg-[var(--surface-subtle)]'
                        : 'border-[var(--border)] hover:bg-[var(--surface-subtle)]/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setSelectedUserIds((prev) => {
                          const next = new Set(prev)
                          if (next.has(u.id)) next.delete(u.id)
                          else next.add(u.id)
                          return next
                        })
                      }}
                      disabled={u.status !== 'new'}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--foreground)]"
                    />
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[10px] text-[var(--muted)]">
                      {u.displayName.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--foreground)]">{u.displayName}</span>
                      <span className="text-[10px] text-[var(--muted-light)]">{u.email}</span>
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        u.status === 'member'
                          ? 'bg-green-500/10 text-green-600'
                          : u.status === 'invited'
                            ? 'bg-amber-500/10 text-amber-600'
                            : 'bg-[var(--surface-subtle)] text-[var(--muted)]'
                      }`}
                    >
                      {u.status === 'member' ? 'In workspace' : u.status === 'invited' ? 'Invited' : 'New'}
                    </span>
                  </label>
                )
              })}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
              <Button
                size="sm"
                onClick={() => {
                  setView('picker')
                }}
                variant="ghost"
                disabled={inviting}
              >
                Skip
              </Button>
              <Button
                size="sm"
                onClick={() => void handleInviteUsers()}
                disabled={selectedUserIds.size === 0 || inviting}
              >
                {inviting ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />}
                {inviting ? 'Inviting…' : 'Invite selected'}
              </Button>
            </div>
          </>
        )}
      </div>
      </ImportFlow>
    )
  }

  // ─── Channel picker view ──────────────────────────────────────────────────
  return (
    <ImportFlow serviceLabel="Slack" step={2} onBack={onBack}>
    <div className="px-5 py-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Choose channels</h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Select channels to import. Each becomes an Overlay conversation, including DMs and group DMs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleRefreshChannels} disabled={channelsLoading}>
            <RefreshCw size={12} className={channelsLoading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Recent jobs summary */}
      {jobs.length > 0 && (
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <CheckCircle2 size={12} />
            {jobs.filter((j) => j.status === 'completed').length} completed import(s).
            {jobs.some((j) => ACTIVE_JOB_STATUSES.has(j.status)) && (
              <button
                type="button"
                className="text-[var(--foreground)] underline"
                onClick={() => {
                  const active = jobs.find((j) => ACTIVE_JOB_STATUSES.has(j.status))
                  if (active) {
                    setActiveJob(active)
                    setView('progress')
                  }
                }}
              >
                View active job
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
          <button type="button" className="ml-auto shrink-0" onClick={() => setError(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Channels loading */}
      {channelsLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3">
              <span className="h-4 w-4 animate-pulse rounded bg-[var(--surface-subtle)]" />
              <span className="h-3 w-32 animate-pulse rounded bg-[var(--surface-subtle)]" />
            </div>
          ))}
        </div>
      ) : channelsError ? (
        <EmptyState
          className="min-h-40 px-6 py-8"
          icon={<AlertCircle size={24} />}
          title="Could not load channels"
          description={channelsError}
          action={
            <Button size="sm" onClick={handleRefreshChannels}>
              <RefreshCw size={12} />
              Try again
            </Button>
          }
        />
      ) : channels.length === 0 ? (
        <EmptyState
          className="min-h-40 px-6 py-8"
          icon={<Hash size={24} strokeWidth={1.5} />}
          title="No channels found"
          description="Your Slack workspace doesn't have any accessible channels. Check your Slack permissions."
        />
      ) : (
        <>
          {/* Selection controls */}
          <div className="mb-3 flex items-center gap-2 text-xs">
            <button
              type="button"
              className="text-[var(--foreground)] underline"
              onClick={selectAllPublic}
            >
              Select all public
            </button>
            <span className="text-[var(--muted-light)]">·</span>
            <button
              type="button"
              className="text-[var(--muted)] underline"
              onClick={clearSelection}
              disabled={selectedChannelIds.size === 0}
            >
              Clear
            </button>
            <span className="ml-auto text-[var(--muted)]">
              {selectedChannelIds.size} selected
            </span>
          </div>

          {/* Channel list */}
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {channels.map((ch) => {
              const Icon = CHANNEL_TYPE_ICON[ch.type] ?? Hash
              const displayName = ch.type === 'public_channel' ? ch.name.replace(/^#+/, '') : ch.name
              const isSelected = selectedChannelIds.has(ch.id)
              return (
                <label
                  key={ch.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition-colors ${
                    isSelected
                      ? 'border-[var(--foreground)]/30 bg-[var(--surface-subtle)]'
                      : 'border-[var(--border)] hover:bg-[var(--surface-subtle)]/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleChannel(ch.id)}
                    className="h-4 w-4 rounded border-[var(--border)] accent-[var(--foreground)]"
                  />
                  <Icon size={14} className="shrink-0 text-[var(--muted)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[var(--foreground)]">
                      {ch.type === 'public_channel' ? '#' : ''}
                      {displayName}
                    </span>
                    <span className="text-[10px] text-[var(--muted-light)]">
                      {CHANNEL_TYPE_LABEL[ch.type]}
                      {ch.memberCount > 0 ? ` · ${ch.memberCount} members` : ''}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          {/* Start import button */}
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button
              size="sm"
              onClick={() => void handleStartImport()}
              disabled={selectedChannelIds.size === 0 || starting}
            >
              {starting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {starting ? 'Starting…' : `Import ${selectedChannelIds.size} channel${selectedChannelIds.size === 1 ? '' : 's'}`}
            </Button>
          </div>
        </>
      )}
    </div>
    </ImportFlow>
  )
}

// ─── Import flow chrome (shared, service-agnostic) ───────────────────────────

/**
 * Consistent frame around every step of an import flow: a back control to the
 * service picker, the service label, and a five-step progress indicator. The
 * stepper is hidden (step === null) for transient states like loading.
 */
function ImportFlow({
  serviceLabel,
  step,
  onBack,
  children,
}: {
  serviceLabel: string
  step: 0 | 1 | 2 | 3 | 4 | null
  onBack?: () => void
  children: ReactNode
}) {
  const steps = ['Connect', 'People', 'Chats', 'Import', 'Done']
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--border)] px-5 pb-3 pt-4">
        <div className="flex items-center gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
            >
              <ArrowLeft size={13} />
              All services
            </button>
          ) : null}
          <span className="text-sm font-semibold text-[var(--foreground)]">Import from {serviceLabel}</span>
        </div>
        {step !== null ? (
          <ol className="flex items-center gap-1.5">
            {steps.map((label, index) => {
              const done = index < step
              const active = index === step
              return (
                <li key={label} className="flex items-center gap-1.5">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold transition-colors ${
                      done
                        ? 'bg-[var(--foreground)] text-[var(--background)]'
                        : active
                          ? 'border border-[var(--foreground)] text-[var(--foreground)]'
                          : 'border border-[var(--border)] text-[var(--muted-light)]'
                    }`}
                  >
                    {done ? <CheckCircle2 size={12} /> : index + 1}
                  </span>
                  <span className={`text-[11px] ${active ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--muted)]'}`}>
                    {label}
                  </span>
                  {index < steps.length - 1 ? (
                    <span className="mx-1 h-px w-5 bg-[var(--border)]" />
                  ) : null}
                </li>
              )
            })}
          </ol>
        ) : null}
      </div>
      {children}
    </div>
  )
}

// ─── Job Progress View ───────────────────────────────────────────────────────

function JobProgressView({
  job,
  cancelling,
  onCancel,
  onBackToPicker,
}: {
  job: SlackImportJob
  cancelling: boolean
  onCancel(): void
  onBackToPicker(): void
}) {
  const isActive = ACTIVE_JOB_STATUSES.has(job.status)
  const isCompleted = job.status === 'completed'
  const isFailed = job.status === 'failed'
  const isCancelled = job.status === 'cancelled'

  const totalChats = job.totalChannels ?? job.selectedChannelIds.length
  const processedChats = job.processedChannels ?? 0
  const isPreparing = job.status === 'queued' || job.status === 'listing_channels' || totalChats === 0
  const progressPct = totalChats > 0
    ? Math.round((processedChats / totalChats) * 100)
    : 0

  return (
    <div className="px-5 py-4">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBackToPicker}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            {isCompleted ? 'Import complete' : isFailed ? 'Import failed' : isCancelled ? 'Import cancelled' : 'Importing…'}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {totalChats} chat{totalChats === 1 ? '' : 's'} selected
          </p>
        </div>
        {isActive ? (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={cancelling}>
            {cancelling ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </Button>
        ) : null}
      </div>

      {/* Status banner */}
      {isFailed && job.error ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{job.error}</span>
        </div>
      ) : null}

      {/* Progress bar */}
      {isActive ? (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-[var(--muted)]">
            <span>
              {isPreparing
                ? 'Preparing…'
                : `Processing chat ${Math.min(processedChats + 1, totalChats)} of ${totalChats}`}
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
            <div
              className="h-full rounded-full bg-[var(--foreground)] transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {job.totalMessages !== undefined && job.totalMessages > 0 ? (
            <p className="mt-1.5 text-[10px] text-[var(--muted-light)]">
              {job.totalMessages.toLocaleString()} messages imported so far
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Completion summary */}
      {isCompleted && job.coverage ? (
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-[var(--foreground)]">
            <CheckCircle2 size={16} className="text-green-500" />
            Successfully imported
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <CoverageRow label="Messages" value={job.coverage.messagesImported} />
            <CoverageRow label="Thread replies" value={job.coverage.threadsImported} />
            <CoverageRow label="Files downloaded" value={job.coverage.filesDownloaded} />
            <CoverageRow label="Public channels" value={job.coverage.publicChannels} />
            <CoverageRow label="Private channels" value={job.coverage.privateChannels} />
            <CoverageRow label="DMs + Group DMs" value={job.coverage.dms + job.coverage.mpims} />
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-[10px] text-[var(--muted)]">
            Imported messages are read-only in Overlay. They appear as conversations in your workspace chat.
            Coverage reflects what the connected Slack account can access — not all workspace data may be visible.
          </div>
        </div>
      ) : null}

      {/* Spinner for active states */}
      {isActive ? (
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <Loader2 size={12} className="animate-spin" />
          {job.status === 'listing_channels'
            ? 'Fetching workspace users and channels…'
            : isPreparing
              ? 'Preparing import…'
              : 'Importing messages…'}
        </div>
      ) : null}

      {/* Back to picker */}
      {!isActive ? (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <Button size="sm" onClick={onBackToPicker}>
            <Download size={13} />
            Import more channels
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function CoverageRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-medium text-[var(--foreground)]">{value.toLocaleString()}</span>
    </div>
  )
}

// ─── Job Done View ───────────────────────────────────────────────────────────

function JobDoneView({
  job,
  onBackToPicker,
  onDone,
}: {
  job: SlackImportJob
  onBackToPicker(): void
  onDone?: () => void
}) {
  const isCompleted = job.status === 'completed'
  const isFailed = job.status === 'failed'
  const isCancelled = job.status === 'cancelled'

  return (
    <div className="px-5 py-4">
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBackToPicker}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            {isCompleted ? 'Import complete' : isFailed ? 'Import failed' : isCancelled ? 'Import cancelled' : 'Import finished'}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {job.totalChannels ?? 0} channel{(job.totalChannels ?? 0) === 1 ? '' : 's'} selected
          </p>
        </div>
      </div>

      {isFailed && job.error ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{job.error}</span>
        </div>
      ) : null}

      {isCompleted && job.coverage ? (
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-[var(--foreground)]">
            <CheckCircle2 size={16} className="text-green-500" />
            Successfully imported
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <CoverageRow label="Messages" value={job.coverage.messagesImported} />
            <CoverageRow label="Thread replies" value={job.coverage.threadsImported} />
            <CoverageRow label="Files downloaded" value={job.coverage.filesDownloaded} />
            <CoverageRow label="Public channels" value={job.coverage.publicChannels} />
            <CoverageRow label="Private channels" value={job.coverage.privateChannels} />
            <CoverageRow label="DMs + Group DMs" value={job.coverage.dms + job.coverage.mpims} />
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-[10px] text-[var(--muted)]">
            Imported messages are read-only in Overlay. They appear as conversations in your workspace chat.
            Coverage reflects what the connected Slack account can access — not all workspace data may be visible.
          </div>
        </div>
      ) : null}

      {isCancelled ? (
        <div className="mb-4 text-xs text-[var(--muted)]">The import was cancelled before it completed.</div>
      ) : null}

      <div className="mt-4 flex items-center gap-2 border-t border-[var(--border)] pt-4">
        <Button size="sm" onClick={onBackToPicker}>
          <Download size={13} />
          Import more channels
        </Button>
        {onDone ? (
          <Button size="sm" variant="secondary" onClick={onDone}>
            Done
          </Button>
        ) : null}
      </div>
    </div>
  )
}
