/**
 * Knowledge-base sharing sheet — the dedicated KB grants model
 * (`/knowledge-bases/[id]/grants` + `/knowledge-bases/share-directory`):
 * principals are users / groups / roles with viewer|editor access — not the
 * unified workspace `/shares` (that dialog covers files, projects,
 * conversations, automations, agents).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import type { Theme } from '../../constants/theme'
import { fontSize, spacing } from '../../constants/theme'
import {
  knowledgeBaseShareDirectory,
  listKnowledgeBaseGrants,
  revokeKnowledgeBaseShare,
  shareKnowledgeBase,
  type KnowledgeBaseGrant,
  type KnowledgeBaseShareDirectory,
} from '../../services/knowledgeBasesService'
import { BottomSheet, SearchField, SegmentedControl } from '../ui/AppChrome'
import { ListRow, Section } from '../ui/primitives'

type DirectoryEntry = KnowledgeBaseShareDirectory['users'][number] & {
  principalType: 'user' | 'group' | 'role'
}

function entryKey(entry: DirectoryEntry): string {
  return `${entry.principalType}:${entry.id}`
}

export function KbShareSheet({
  visible,
  theme,
  knowledgeBaseId,
  knowledgeBaseTitle,
  onClose,
}: {
  visible: boolean
  theme: Theme
  knowledgeBaseId: string
  knowledgeBaseTitle: string
  onClose: () => void
}): React.ReactElement {
  const [grants, setGrants] = useState<KnowledgeBaseGrant[]>([])
  const [directory, setDirectory] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer')

  const directoryByKey = useMemo(
    () => new Map(directory.map((entry) => [entryKey(entry), entry])),
    [directory],
  )

  const available = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return directory
      .filter(
        (entry) =>
          !grants.some(
            (grant) => grant.principalType === entry.principalType && grant.principalId === entry.id,
          ),
      )
      .filter(
        (entry) =>
          !needle ||
          `${entry.name} ${entry.description ?? ''} ${entry.email ?? ''}`
            .toLowerCase()
            .includes(needle),
      )
      .slice(0, 12)
  }, [directory, grants, query])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [grantsResponse, directoryResponse] = await Promise.all([
        listKnowledgeBaseGrants(knowledgeBaseId),
        knowledgeBaseShareDirectory(),
      ])
      setGrants(grantsResponse)
      setDirectory([
        ...directoryResponse.users.map((entry) => ({ ...entry, principalType: 'user' as const })),
        ...directoryResponse.groups.map((entry) => ({ ...entry, principalType: 'group' as const })),
        ...directoryResponse.roles.map((entry) => ({ ...entry, principalType: 'role' as const })),
      ])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load sharing')
    } finally {
      setLoading(false)
    }
  }, [knowledgeBaseId])

  useEffect(() => {
    if (!visible) return
    setSelectedTarget(null)
    setQuery('')
    setNotice(null)
    void load()
  }, [visible, load])

  const grant = useCallback(async () => {
    if (!selectedTarget) return
    const entry = directoryByKey.get(selectedTarget)
    if (!entry) return
    setBusyKey(selectedTarget)
    try {
      const created = await shareKnowledgeBase(knowledgeBaseId, {
        principalType: entry.principalType,
        principalId: entry.id,
        accessRole: role,
      })
      setGrants((current) => [...current, created])
      setSelectedTarget(null)
      setNotice(`Shared with ${entry.name}.`)
    } catch (grantError) {
      setNotice(grantError instanceof Error ? grantError.message : 'Could not share')
    } finally {
      setBusyKey(null)
    }
  }, [selectedTarget, directoryByKey, knowledgeBaseId, role])

  const revoke = useCallback(
    async (grantId: string) => {
      setBusyKey(grantId)
      try {
        await revokeKnowledgeBaseShare(knowledgeBaseId, grantId)
        setGrants((current) => current.filter((item) => item.id !== grantId))
      } catch (revokeError) {
        setNotice(revokeError instanceof Error ? revokeError.message : 'Could not revoke access')
      } finally {
        setBusyKey(null)
      }
    },
    [knowledgeBaseId],
  )

  const principalIcon = (type: string): React.ComponentProps<typeof Feather>['name'] =>
    type === 'group' ? 'users' : type === 'role' ? 'shield' : 'user'

  return (
    <BottomSheet
      theme={theme}
      visible={visible}
      onClose={onClose}
      title={`Share “${knowledgeBaseTitle}”`}
    >
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {error ? <Text style={[styles.notice, { color: '#EF4444' }]}>{error}</Text> : null}
        {notice ? <Text style={[styles.notice, { color: theme.textSecondary }]}>{notice}</Text> : null}

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : (
          <>
            <Section theme={theme}>
              {grants.length === 0 ? (
                <ListRow
                  theme={theme}
                  title="Not shared yet"
                  subtitle="Only you can see this knowledge base."
                  disabled
                />
              ) : (
                grants.map((item) => {
                  const entry = directoryByKey.get(`${item.principalType}:${item.principalId}`)
                  return (
                    <ListRow
                      key={item.id}
                      theme={theme}
                      icon={principalIcon(item.principalType)}
                      title={entry?.name ?? item.principalId}
                      subtitle={`${item.principalType} · ${item.accessRole}`}
                      accessory={
                        busyKey === item.id ? (
                          <ActivityIndicator size="small" color={theme.textSecondary} />
                        ) : (
                          <TouchableOpacity
                            onPress={() => void revoke(item.id)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Feather name="x" size={16} color={theme.textSecondary} />
                          </TouchableOpacity>
                        )
                      }
                    />
                  )
                })
              )}
            </Section>

            <View style={styles.addBlock}>
              <Text style={[styles.addLabel, { color: theme.textSecondary }]}>Add access</Text>
              <SearchField
                theme={theme}
                value={query}
                onChangeText={setQuery}
                placeholder="Search people, groups, roles"
              />
              {available.length > 0 ? (
                <Section theme={theme}>
                  {available.map((entry) => {
                    const key = entryKey(entry)
                    return (
                      <ListRow
                        key={key}
                        theme={theme}
                        icon={principalIcon(entry.principalType)}
                        title={entry.name}
                        subtitle={entry.description ?? entry.email ?? entry.principalType}
                        selected={selectedTarget === key}
                        onPress={() => setSelectedTarget(selectedTarget === key ? null : key)}
                      />
                    )
                  })}
                </Section>
              ) : null}
              {selectedTarget ? (
                <View style={styles.grantBar}>
                  <SegmentedControl
                    theme={theme}
                    value={role}
                    options={[
                      { value: 'viewer', label: 'Viewer' },
                      { value: 'editor', label: 'Editor' },
                    ]}
                    onChange={setRole}
                  />
                  <TouchableOpacity
                    activeOpacity={0.85}
                    disabled={busyKey !== null}
                    onPress={() => void grant()}
                    style={[styles.grantButton, { backgroundColor: theme.foreground }]}
                  >
                    {busyKey === selectedTarget ? (
                      <ActivityIndicator size="small" color={theme.background} />
                    ) : (
                      <Text style={[styles.grantButtonText, { color: theme.background }]}>Share</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  notice: { fontSize: fontSize.sm, marginBottom: spacing.sm },
  loadingWrap: { alignItems: 'center', paddingVertical: spacing.xl },
  addBlock: { gap: spacing.sm, marginTop: spacing.md },
  addLabel: { fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  grantBar: { gap: spacing.sm },
  grantButton: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  grantButtonText: { fontSize: fontSize.sm, fontWeight: '700' },
})
