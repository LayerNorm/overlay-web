/**
 * New channel sheet — native counterpart of web `NewChannelDialog`.
 * Name + optional topic + public/private visibility; private channels get
 * the member picker (public channels are open to the whole workspace).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import type { ChannelVisibility } from '@overlay/workspace-contracts'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import {
  createChannel,
  searchWorkspacePrincipals,
  type RoomPrincipalOption,
} from '../../services/collaborationService'
import { BottomSheet, SearchField, SegmentedControl } from '../ui/AppChrome'
import { ListRow, Section } from '../ui/primitives'

export function NewChannelSheet({
  visible,
  workspaceId,
  theme,
  onClose,
  onCreated,
}: {
  visible: boolean
  workspaceId: string
  theme: Theme
  onClose: () => void
  onCreated?: (channel: { id: string; title: string }) => void
}) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [visibility, setVisibility] = useState<ChannelVisibility>('public')
  const [members, setMembers] = useState<RoomPrincipalOption[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Member picker loads only for private channels — same as web.
  useEffect(() => {
    if (!visible || visibility !== 'private') return
    let cancelled = false
    searchWorkspacePrincipals(workspaceId)
      .then(({ options }) => {
        if (!cancelled) setMembers(options)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load workspace members.')
      })
    return () => {
      cancelled = true
    }
  }, [visible, visibility, workspaceId])

  useEffect(() => {
    if (visible) {
      setName('')
      setTopic('')
      setVisibility('public')
      setSelected([])
      setQuery('')
      setError(null)
    }
  }, [visible])

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return members.filter(
      (option) =>
        !needle || `${option.name} ${option.description ?? ''}`.toLowerCase().includes(needle),
    )
  }, [members, query])

  const toggle = useCallback((principalId: string) => {
    setSelected((current) =>
      current.includes(principalId)
        ? current.filter((id) => id !== principalId)
        : [...current, principalId],
    )
  }, [])

  const submit = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const channel = await createChannel(workspaceId, {
        name: trimmed,
        ...(topic.trim() ? { topic: topic.trim() } : {}),
        visibility,
        ...(visibility === 'private' && selected.length ? { principalIds: selected } : {}),
      })
      onCreated?.({ id: channel!.conversationId, title: channel!.name })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the channel.')
    } finally {
      setBusy(false)
    }
  }, [name, topic, visibility, selected, busy, workspaceId, onCreated])

  return (
    <BottomSheet theme={theme} visible={visible} onClose={onClose} title="New channel">
      <View style={styles.fields}>
        <View style={[styles.inputRow, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
          <Feather name="hash" size={15} color={theme.textSecondary} />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="channel-name"
            placeholderTextColor={theme.textDisabled}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: theme.text }]}
          />
        </View>
        <TextInput
          value={topic}
          onChangeText={setTopic}
          placeholder="Topic (optional)"
          placeholderTextColor={theme.textDisabled}
          style={[
            styles.topicInput,
            { color: theme.text, backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
          ]}
        />
        <SegmentedControl
          theme={theme}
          value={visibility}
          options={[
            { label: 'Public', value: 'public' },
            { label: 'Private', value: 'private' },
          ]}
          onChange={setVisibility}
        />
        <Text style={[styles.visibilityHint, { color: theme.textSecondary }]}>
          {visibility === 'public'
            ? 'Everyone in the workspace can find and join this channel.'
            : 'Only the people you add can see this channel.'}
        </Text>
      </View>

      {visibility === 'private' ? (
        <View style={styles.membersBlock}>
          <SearchField
            theme={theme}
            value={query}
            onChangeText={setQuery}
            placeholder="Add people"
          />
          {candidates.length > 0 ? (
            <Section theme={theme}>
              {candidates.map((option) => (
                <ListRow
                  key={option.principalId}
                  theme={theme}
                  title={option.name}
                  subtitle={option.description}
                  icon={option.principalType === 'agent' ? 'cpu' : 'user'}
                  selected={selected.includes(option.principalId)}
                  onPress={() => toggle(option.principalId)}
                />
              ))}
            </Section>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={[styles.errorText, { color: '#EF4444' }]}>{error}</Text> : null}
      <TouchableOpacity
        activeOpacity={0.85}
        disabled={busy || !name.trim()}
        onPress={() => void submit()}
        style={[
          styles.submitButton,
          { backgroundColor: theme.foreground, opacity: busy || !name.trim() ? 0.45 : 1 },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={theme.background} />
        ) : (
          <Text style={[styles.submitText, { color: theme.background }]}>Create channel</Text>
        )}
      </TouchableOpacity>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  fields: {
    gap: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  input: {
    flex: 1,
    fontSize: fontSize.md,
    minHeight: 42,
  },
  topicInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
    minHeight: 44,
    textAlignVertical: 'center',
  },
  visibilityHint: {
    fontSize: fontSize.xs,
    lineHeight: 16,
  },
  membersBlock: {
    gap: spacing.sm,
  },
  errorText: {
    fontSize: fontSize.sm,
  },
  submitButton: {
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    marginTop: spacing.xs,
  },
  submitText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
})
