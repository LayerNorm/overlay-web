/**
 * New direct message / add-people sheet — native counterpart of web
 * `NewDirectMessageDialog`. Loads workspace people + agents via the
 * management surface, multi-selects principals, then either creates a DM
 * (or group DM) or adds them to an existing channel.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import type { Theme } from '../../constants/theme'
import { fontSize, spacing, borderRadius } from '../../constants/theme'
import {
  addRoomParticipant,
  createDirectMessage,
  searchWorkspacePrincipals,
  type RoomPrincipalOption,
} from '../../services/collaborationService'
import { BottomSheet, SearchField } from '../ui/AppChrome'
import { ListRow, Section } from '../ui/primitives'

export function NewDirectMessageSheet({
  visible,
  workspaceId,
  theme,
  sourceConversationId,
  addToConversationId,
  addToConversationType = 'channel',
  excludedPrincipalIds = [],
  onClose,
  onCreated,
  onParticipantsAdded,
}: {
  visible: boolean
  workspaceId: string
  theme: Theme
  /** Fork a personal chat into a DM with the chosen people (web parity). */
  sourceConversationId?: string
  /** When set for a channel, selections are added as participants instead. */
  addToConversationId?: string
  addToConversationType?: 'dm' | 'channel'
  excludedPrincipalIds?: string[]
  onClose: () => void
  onCreated?: (dm: { id: string; title: string }) => void
  onParticipantsAdded?: () => void
}) {
  const [options, setOptions] = useState<RoomPrincipalOption[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setSelected([])
    setQuery('')
    setError(null)
    let cancelled = false
    setLoading(true)
    searchWorkspacePrincipals(workspaceId)
      .then(({ options: items }) => {
        if (!cancelled) setOptions(items)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load workspace members.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [visible, workspaceId])

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return options
      .filter((option) => !excludedPrincipalIds.includes(option.principalId))
      .filter(
        (option) =>
          !needle ||
          `${option.name} ${option.description ?? ''}`.toLowerCase().includes(needle),
      )
  }, [options, excludedPrincipalIds, query])

  const toggle = useCallback((principalId: string) => {
    setSelected((current) =>
      current.includes(principalId)
        ? current.filter((id) => id !== principalId)
        : [...current, principalId],
    )
  }, [])

  const submit = useCallback(async () => {
    if (selected.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      if (addToConversationId && addToConversationType === 'channel') {
        await Promise.all(
          selected.map((principalId) => addRoomParticipant(addToConversationId, principalId)),
        )
        onParticipantsAdded?.()
        return
      }
      const dm = await createDirectMessage(workspaceId, {
        principalIds: addToConversationId
          ? [...excludedPrincipalIds, ...selected]
          : selected,
        ...(sourceConversationId ? { sourceConversationId } : {}),
      })
      onCreated?.({ id: dm.conversationId, title: dm.title })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the message.')
    } finally {
      setBusy(false)
    }
  }, [
    selected,
    busy,
    addToConversationId,
    addToConversationType,
    excludedPrincipalIds,
    sourceConversationId,
    workspaceId,
    onCreated,
    onParticipantsAdded,
  ])

  const title = addToConversationId
    ? addToConversationType === 'dm'
      ? 'Start a group DM'
      : 'Add people'
    : sourceConversationId
      ? 'Continue with people'
      : 'New direct message'

  return (
    <BottomSheet theme={theme} visible={visible} onClose={onClose} title={title}>
      <SearchField
        theme={theme}
        value={query}
        onChangeText={setQuery}
        placeholder="Search people and agents"
      />
      {error ? <Text style={[styles.errorText, { color: '#EF4444' }]}>{error}</Text> : null}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : candidates.length === 0 ? (
        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
          {query.trim() ? 'No matches.' : 'Nobody else is in this workspace yet.'}
        </Text>
      ) : (
        <Section theme={theme}>
          {candidates.map((option) => {
            const isSelected = selected.includes(option.principalId)
            return (
              <ListRow
                key={option.principalId}
                theme={theme}
                title={option.name}
                subtitle={option.description}
                icon={option.principalType === 'agent' ? 'cpu' : 'user'}
                selected={isSelected}
                onPress={() => toggle(option.principalId)}
              />
            )
          })}
        </Section>
      )}
      <TouchableOpacity
        activeOpacity={0.85}
        disabled={busy || selected.length === 0}
        onPress={() => void submit()}
        style={[
          styles.submitButton,
          {
            backgroundColor: theme.foreground,
            opacity: busy || selected.length === 0 ? 0.45 : 1,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={theme.background} />
        ) : (
          <Text style={[styles.submitText, { color: theme.background }]}>
            {addToConversationId
              ? addToConversationType === 'dm'
                ? 'Start group DM'
                : 'Add people'
              : selected.length > 1
                ? `Start group message (${selected.length})`
                : 'Start message'}
          </Text>
        )}
      </TouchableOpacity>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  emptyText: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingVertical: spacing.lg,
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
