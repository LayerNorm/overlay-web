'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
import { useWorkspace } from './WorkspaceProvider'

interface SlackChannel {
  id: string
  name: string
  type: 'public_channel' | 'private_channel' | 'im' | 'mpim'
  isPrivate: boolean
  memberCount: number
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

export function SlackImportPanel() {
  const { activeWorkspace } = useWorkspace()
  const workspaceId = activeWorkspace?.id

  const [connectionState, setConnectionState] = useState<ConnectionState>('loading')
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [channelsError, setChannelsError] = useState<string | null>(null)
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set())
  const [activeJob, setActiveJob] = useState<SlackImportJob | null>(null)
  const [jobs, setJobs] = useState<SlackImportJob[]>([])
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'picker' | 'progress'>('picker')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Check connection status and load jobs on mount
  const checkConnectionAndJobs = useCallback(async () => {
    if (!workspaceId) return
    try {
      const res = await overlayAppClient.integrations.get<{ connected: string[] }>()
      const isConnected = (res.connected || []).includes('slackbot')
      setConnectionState(isConnected ? 'connected' : 'not_connected')

      if (isConnected) {
        const jobsRes = await fetch('/api/v1/imports/slack?action=jobs', {
          credentials: 'same-origin',
        })
        if (jobsRes.ok) {
          const data = await jobsRes.json() as { jobs: SlackImportJob[] }
          setJobs(data.jobs || [])
          const active = (data.jobs || []).find(
            (j) => j.status === 'queued' || j.status === 'listing_channels' || j.status === 'importing',
          )
          if (active) {
            setActiveJob(active)
            setView('progress')
          }
        }
      }
    } catch {
      setConnectionState('not_connected')
    }
  }, [workspaceId])

  useEffect(() => {
    void checkConnectionAndJobs()
  }, [checkConnectionAndJobs])

  // Load channels when connected and in picker view
  const loadChannels = useCallback(async () => {
    if (!workspaceId || connectionState !== 'connected') return
    setChannelsLoading(true)
    setChannelsError(null)
    try {
      const res = await fetch('/api/v1/imports/slack?action=channels', {
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load channels')
      }
      const data = await res.json() as { channels: SlackChannel[]; total: number }
      setChannels(data.channels || [])
    } catch (err) {
      setChannelsError(err instanceof Error ? err.message : 'Failed to load channels')
    } finally {
      setChannelsLoading(false)
    }
  }, [workspaceId, connectionState])

  useEffect(() => {
    if (view === 'picker' && connectionState === 'connected' && channels.length === 0 && !channelsLoading) {
      void loadChannels()
    }
  }, [view, connectionState, channels.length, channelsLoading, loadChannels])

  // Poll active job for progress updates
  useEffect(() => {
    if (view !== 'progress' || !activeJob) return
    if (activeJob.status === 'completed' || activeJob.status === 'failed' || activeJob.status === 'cancelled') {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }

    pollRef.current = setInterval(async () => {
      if (!activeJob) return
      try {
        const res = await fetch(`/api/v1/imports/slack?action=job&jobId=${activeJob._id}`, {
          credentials: 'same-origin',
        })
        if (res.ok) {
          const job = await res.json() as SlackImportJob
          setActiveJob(job)
          if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
            if (pollRef.current) {
              clearInterval(pollRef.current)
              pollRef.current = null
            }
            // Refresh jobs list
            void checkConnectionAndJobs()
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 2000)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [view, activeJob?._id, activeJob?.status, activeJob, checkConnectionAndJobs])

  // Handle connect
  const handleConnect = useCallback(async () => {
    setError(null)
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
      } else if (data.redirectUrl) {
        if (oauthTab) oauthTab.location.href = data.redirectUrl
        else window.open(data.redirectUrl, '_blank')
      } else {
        oauthTab?.close()
        setError('No connection URL was returned')
      }
    } catch (err) {
      oauthTab?.close()
      setError(err instanceof Error ? err.message : 'Failed to connect to Slack')
    }
  }, [])

  // Handle start import
  const handleStartImport = useCallback(async () => {
    if (selectedChannelIds.size === 0) return
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/imports/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          action: 'start',
          selectedChannelIds: [...selectedChannelIds],
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to start import')
      }
      const data = await res.json() as { jobId: string }
      // Fetch the job and switch to progress view
      const jobRes = await fetch(`/api/v1/imports/slack?action=job&jobId=${data.jobId}`, {
        credentials: 'same-origin',
      })
      if (jobRes.ok) {
        const job = await jobRes.json() as SlackImportJob
        setActiveJob(job)
        setView('progress')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start import')
    } finally {
      setStarting(false)
    }
  }, [selectedChannelIds])

  // Handle cancel
  const handleCancel = useCallback(async () => {
    if (!activeJob) return
    setCancelling(true)
    try {
      await fetch('/api/v1/imports/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'cancel', jobId: activeJob._id }),
      })
    } catch {
      // ignore
    } finally {
      setCancelling(false)
    }
  }, [activeJob])

  // Handle refresh channels
  const handleRefreshChannels = useCallback(() => {
    setChannels([])
    void loadChannels()
  }, [loadChannels])

  // Toggle channel selection
  const toggleChannel = useCallback((channelId: string) => {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      return next
    })
  }, [])

  // Select all public channels
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
      <div className="flex min-h-72 items-center justify-center text-sm text-[var(--muted)]">
        <Loader2 size={16} className="mr-2 animate-spin" />
        Loading…
      </div>
    )
  }

  // ─── Not connected state ──────────────────────────────────────────────────
  if (connectionState === 'not_connected') {
    return (
      <EmptyState
        className="min-h-72 px-6 py-12"
        icon={<Download size={30} strokeWidth={1.5} />}
        title="Import from Slack"
        description="Connect your Slack workspace to import channel history into Overlay conversations. Messages, threads, and files are imported deterministically — no AI processing."
        action={
          <Button size="sm" onClick={() => void handleConnect()}>
            <Download size={13} />
            Connect Slack
          </Button>
        }
      />
    )
  }

  // ─── Progress view ────────────────────────────────────────────────────────
  if (view === 'progress' && activeJob) {
    return (
      <JobProgressView
        job={activeJob}
        cancelling={cancelling}
        onCancel={() => void handleCancel()}
        onBackToPicker={() => {
          setView('picker')
          setActiveJob(null)
          void checkConnectionAndJobs()
        }}
      />
    )
  }

  // ─── Channel picker view ──────────────────────────────────────────────────
  return (
    <div className="px-5 py-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Import from Slack</h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Select channels to import. Each channel becomes an Overlay conversation.
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
            <button
              type="button"
              className="text-[var(--foreground)] underline"
              onClick={() => {
                const active = jobs.find(
                  (j) => j.status === 'queued' || j.status === 'listing_channels' || j.status === 'importing',
                )
                if (active) {
                  setActiveJob(active)
                  setView('progress')
                }
              }}
            >
              View active job
            </button>
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
                      {ch.name}
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
  const isActive = job.status === 'queued' || job.status === 'listing_channels' || job.status === 'importing'
  const isCompleted = job.status === 'completed'
  const isFailed = job.status === 'failed'
  const isCancelled = job.status === 'cancelled'

  const progressPct = job.totalChannels && job.totalChannels > 0
    ? Math.round(((job.processedChannels ?? 0) / job.totalChannels) * 100)
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
            {job.totalChannels ?? 0} channel{(job.totalChannels ?? 0) === 1 ? '' : 's'} selected
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
              {job.status === 'listing_channels' ? 'Preparing…' : `Processing channel ${job.processedChannels ?? 0} of ${job.totalChannels ?? 0}`}
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
          {job.status === 'listing_channels' ? 'Fetching workspace users and channels…' : 'Importing messages…'}
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
