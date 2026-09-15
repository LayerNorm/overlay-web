/**
 * Slack import panel — native counterpart of web `SlackImportPanel`, scoped
 * to what the `/api/v1/imports/slack` BFF exposes: connection check +
 * job list (`action=jobs`), channel pick list (`action=channels`), start
 * (`POST action=start`), cancel (`POST action=cancel`), and progress via
 * the job row's processed/total channels and coverage counters.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import {
  cancelSlackImport,
  loadSlackChannels,
  loadSlackImportJobs,
  startSlackImport,
  type SlackImportChannel,
  type SlackImportJob,
} from '../../services/workspaceManagementService'
import { SearchField } from '../ui/AppChrome'
import { ListRow, Section } from '../ui/primitives'

const JOB_POLL_MS = 5_000
const RUNNING_STATUSES = new Set(['queued', 'running', 'processing', 'in_progress'])

function jobStatusLabel(job: SlackImportJob): string {
  const processed = job.processedChannels ?? 0
  const total = job.totalChannels ?? job.selectedChannelIds.length
  if (RUNNING_STATUSES.has(job.status)) return `${job.status} · ${processed}/${total} channels`
  if (job.status === 'completed') {
    const imported = job.coverage?.messagesImported ?? job.totalMessages ?? 0
    return `completed · ${imported} messages`
  }
  return job.status
}

function channelIcon(channel: SlackImportChannel): React.ComponentProps<typeof Feather>['name'] {
  if (channel.type === 'im' || channel.type === 'mpim') return 'message-circle'
  return channel.isPrivate ? 'lock' : 'hash'
}

export function SlackImportPanel({ theme }: { theme: Theme }) {
  const [jobs, setJobs] = useState<SlackImportJob[]>([])
  const [connected, setConnected] = useState<boolean | null>(null)
  const [channels, setChannels] = useState<SlackImportChannel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => () => {
    mounted.current = false
  }, [])

  const refreshJobs = useCallback(async () => {
    try {
      const page = await loadSlackImportJobs()
      if (!mounted.current) return
      setJobs(page.jobs ?? [])
      setConnected(page.connected !== false)
      setError(null)
    } catch (jobsError) {
      if (!mounted.current) return
      const message = jobsError instanceof Error ? jobsError.message : ''
      // 400 = Slack not connected via integrations; show the connect hint.
      if (message.toLowerCase().includes('slack is not connected')) {
        setConnected(false)
      } else {
        setError(message || 'Could not load import jobs')
      }
    }
  }, [])

  useEffect(() => {
    void refreshJobs()
  }, [refreshJobs])

  // Poll while any job is running.
  const hasRunning = jobs.some((job) => RUNNING_STATUSES.has(job.status))
  useEffect(() => {
    if (!hasRunning) return
    const interval = setInterval(() => void refreshJobs(), JOB_POLL_MS)
    return () => clearInterval(interval)
  }, [hasRunning, refreshJobs])

  const loadChannels = useCallback(async () => {
    setChannelsLoading(true)
    setError(null)
    try {
      const all: SlackImportChannel[] = []
      let cursor: string | undefined
      for (let page = 0; page < 4; page += 1) {
        const result = await loadSlackChannels(cursor)
        all.push(...result.channels)
        if (!result.hasMore || !result.nextCursor) break
        cursor = result.nextCursor
      }
      if (mounted.current) setChannels(all)
    } catch (channelError) {
      if (mounted.current) {
        setError(channelError instanceof Error ? channelError.message : 'Could not list Slack channels')
      }
    } finally {
      if (mounted.current) setChannelsLoading(false)
    }
  }, [])

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return channels
      .filter((channel) => !needle || channel.name.toLowerCase().includes(needle))
      .slice(0, 40)
  }, [channels, query])

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const start = useCallback(async () => {
    if (selected.size === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await startSlackImport([...selected])
      setSelected(new Set())
      setPickerOpen(false)
      await refreshJobs()
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the import')
    } finally {
      setBusy(false)
    }
  }, [selected, busy, refreshJobs])

  const cancel = useCallback(
    async (jobId: string) => {
      setBusy(true)
      try {
        await cancelSlackImport(jobId)
        await refreshJobs()
      } catch {
        setError('Could not cancel the job')
      } finally {
        setBusy(false)
      }
    },
    [refreshJobs],
  )

  if (connected === null) {
    return (
      <View style={styles.centerWrap}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    )
  }
  if (connected === false) {
    return (
      <View style={styles.centerWrap}>
        <Feather name="download-cloud" size={26} color={theme.textSecondary} />
        <Text style={[styles.hintTitle, { color: theme.text }]}>Slack is not connected</Text>
        <Text style={[styles.hintText, { color: theme.textSecondary }]}>
          Connect Slack on the Extensions page first, then come back to import channels into this
          workspace.
        </Text>
      </View>
    )
  }

  return (
    <View>
      {error ? <Text style={[styles.errorText, { color: '#EF4444' }]}>{error}</Text> : null}

      <Section theme={theme}>
        {jobs.length === 0 ? (
          <ListRow
            theme={theme}
            title="No imports yet"
            subtitle="Bring Slack channels into this workspace as multiplayer rooms."
            disabled
          />
        ) : (
          jobs.map((job) => (
            <ListRow
              key={job._id}
              theme={theme}
              icon={RUNNING_STATUSES.has(job.status) ? 'loader' : 'check-circle'}
              title={`Import · ${job.selectedChannelIds.length} channel${job.selectedChannelIds.length === 1 ? '' : 's'}`}
              subtitle={jobStatusLabel(job)}
              accessory={
                RUNNING_STATUSES.has(job.status) ? (
                  <TouchableOpacity
                    disabled={busy}
                    onPress={() => void cancel(job._id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={[styles.cancelText, { color: '#EF4444' }]}>Cancel</Text>
                  </TouchableOpacity>
                ) : undefined
              }
            />
          ))
        )}
      </Section>

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => {
          const next = !pickerOpen
          setPickerOpen(next)
          if (next && channels.length === 0) void loadChannels()
        }}
        style={[styles.primaryButton, { backgroundColor: theme.foreground }]}
      >
        <Text style={[styles.primaryButtonText, { color: theme.background }]}>
          {pickerOpen ? 'Hide channel picker' : 'Start a Slack import'}
        </Text>
      </TouchableOpacity>

      {pickerOpen ? (
        <View style={styles.pickerBlock}>
          <SearchField
            theme={theme}
            value={query}
            onChangeText={setQuery}
            placeholder="Search Slack channels"
          />
          {channelsLoading ? (
            <View style={styles.centerWrap}>
              <ActivityIndicator color={theme.textSecondary} />
            </View>
          ) : (
            <Section theme={theme}>
              {candidates.map((channel) => (
                <ListRow
                  key={channel.id}
                  theme={theme}
                  icon={channelIcon(channel)}
                  title={channel.name}
                  subtitle={`${channel.memberCount} member${channel.memberCount === 1 ? '' : 's'} · ${channel.type.replace('_', ' ')}`}
                  selected={selected.has(channel.id)}
                  onPress={() => toggle(channel.id)}
                />
              ))}
              {candidates.length === 0 ? (
                <ListRow theme={theme} title="No matching channels" disabled />
              ) : null}
            </Section>
          )}
          {selected.size > 0 ? (
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={busy}
              onPress={() => void start()}
              style={[styles.primaryButton, { backgroundColor: theme.foreground }]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={theme.background} />
              ) : (
                <Text style={[styles.primaryButtonText, { color: theme.background }]}>
                  Import {selected.size} channel{selected.size === 1 ? '' : 's'}
                </Text>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  centerWrap: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  hintTitle: { fontSize: fontSize.md, fontWeight: '700' },
  hintText: { fontSize: fontSize.sm, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  errorText: { fontSize: fontSize.sm, paddingVertical: spacing.xs },
  cancelText: { fontSize: fontSize.sm, fontWeight: '600' },
  primaryButton: {
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: spacing.sm,
  },
  primaryButtonText: { fontSize: fontSize.sm, fontWeight: '700' },
  pickerBlock: { marginTop: spacing.sm, gap: spacing.xs },
})
