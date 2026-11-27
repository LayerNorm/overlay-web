/**
 * Per-resource share sheet — native counterpart of web `ShareDialog`:
 * grants list with role changes and impact-confirmed revokes, a directory
 * picker (people / agents / teams / rooms) where team+room grants disclose
 * who gains access before commit, and the public-link row.
 *
 * All calls go through `workspaceManagementService` → the typed
 * `SharingClient`; the resource ref is `{workspaceId, resourceType,
 * resourceId}` matching `WORKSPACE_SHARE_RESOURCE_TYPES`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import type {
  WorkspaceResourceGrant,
  WorkspaceShareAccessRole,
  WorkspaceShareDirectoryEntry,
} from '@overlay/workspace-contracts'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import {
  grantResourceShare,
  loadResourceShares,
  revokeResourceShare,
  shareImpact,
  type ShareResourceRef,
} from '../../services/workspaceManagementService'
import { BottomSheet, SearchField, SegmentedControl } from '../ui/AppChrome'
import { ListRow, Section } from '../ui/primitives'

const ACCESS_ROLES: Array<{ value: WorkspaceShareAccessRole; label: string }> = [
  { value: 'viewer', label: 'View' },
  { value: 'operator', label: 'Operate' },
  { value: 'editor', label: 'Edit' },
]

function targetKey(entry: { targetType: string; id: string }): string {
  return `${entry.targetType}:${entry.id}`
}

function directoryIcon(entry: WorkspaceShareDirectoryEntry): React.ComponentProps<typeof Feather>['name'] {
  switch (entry.targetType) {
    case 'team':
      return 'users'
    case 'room':
      return 'message-circle'
    default:
      return entry.kind === 'agent' ? 'cpu' : 'user'
  }
}

export function ShareSheet({
  visible,
  theme,
  resource,
  resourceTitle,
  publicUrl,
  publicVisibility,
  onSetPublicVisibility,
  onClose,
}: {
  visible: boolean
  theme: Theme
  /** The shareable resource; null while the parent resolves its id. */
  resource: ShareResourceRef | null
  resourceTitle: string
  /** Public link when the resource has one (chat share links, file links). */
  publicUrl?: string | null
  /**
   * Managed public-link toggle (files/outputs). When supplied, the public
   * link row gets an on/off control that calls back to PATCH visibility and
   * returns the share url (or null when made private).
   */
  publicVisibility?: 'private' | 'public'
  onSetPublicVisibility?: (
    visibility: 'private' | 'public',
  ) => Promise<string | null>
  onClose: () => void
}) {
  const [grants, setGrants] = useState<WorkspaceResourceGrant[]>([])
  const [directory, setDirectory] = useState<WorkspaceShareDirectoryEntry[]>([])
  const [publicLinksEnabled, setPublicLinksEnabled] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)
  const [role, setRole] = useState<WorkspaceShareAccessRole>('viewer')
  const [linkUrl, setLinkUrl] = useState<string | null>(publicUrl ?? null)
  const [linkVisibility, setLinkVisibility] = useState<'private' | 'public'>(
    publicVisibility ?? 'private',
  )

  const entriesByKey = useMemo(
    () => new Map(directory.map((entry) => [targetKey(entry), entry])),
    [directory],
  )
  const available = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return directory
      .filter(
        (entry) =>
          !grants.some(
            (grant) => grant.targetType === entry.targetType && grant.targetId === entry.id,
          ),
      )
      .filter(
        (entry) =>
          !needle ||
          `${entry.name} ${entry.description ?? ''}`.toLowerCase().includes(needle),
      )
      .slice(0, 12)
  }, [directory, grants, query])

  const load = useCallback(async () => {
    if (!resource) return
    setLoading(true)
    setError(null)
    try {
      const response = await loadResourceShares(resource)
      setGrants(response.grants)
      setDirectory([
        ...response.directory.principals,
        ...response.directory.teams,
        ...response.directory.rooms,
      ])
      setPublicLinksEnabled(response.publicLinksEnabled)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load sharing')
    } finally {
      setLoading(false)
    }
  }, [resource])

  useEffect(() => {
    if (!visible) return
    setSelectedTarget(null)
    setQuery('')
    setNotice(null)
    setLinkUrl(publicUrl ?? null)
    setLinkVisibility(publicVisibility ?? 'private')
    void load()
  }, [visible, load])

  /** Team/room targets grow over time — disclose who gains access first. */
  const requestGrant = useCallback(async () => {
    if (!resource || !selectedTarget) return
    const entry = entriesByKey.get(selectedTarget)
    if (!entry) return
    const doGrant = async () => {
      setBusyKey(selectedTarget)
      try {
        const grant = await grantResourceShare(resource, {
          targetType: entry.targetType,
          targetId: entry.id,
          accessRole: role,
          confirmRoomExpansion: true,
        })
        setGrants((current) => [
          ...current.filter((item) => item.id !== grant.id),
          grant,
        ])
        setSelectedTarget(null)
      } catch (grantError) {
        setNotice(grantError instanceof Error ? grantError.message : 'Could not grant access')
      } finally {
        setBusyKey(null)
      }
    }
    if (entry.targetType === 'principal') {
      await doGrant()
      return
    }
    setBusyKey(selectedTarget)
    try {
      const impact = await shareImpact(resource, {
        targetType: entry.targetType,
        targetId: entry.id,
      })
      const gaining = impact.gaining.map((p) => p.name).slice(0, 6).join(', ')
      Alert.alert(
        `Share with ${impact.targetName}?`,
        impact.gaining.length > 0
          ? `${impact.gaining.length} ${impact.targetType === 'team' ? 'member' : 'participant'}${impact.gaining.length === 1 ? '' : 's'} will gain access (${gaining}${impact.gaining.length > 6 ? '…' : ''}). New ${impact.targetType} members inherit it automatically.`
          : `Everyone who joins this ${impact.targetType} will inherit access.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Share', onPress: () => void doGrant() },
        ],
      )
    } catch {
      setNotice('Could not check who would gain access')
    } finally {
      setBusyKey(null)
    }
  }, [resource, selectedTarget, entriesByKey, role])

  const changeRole = useCallback(
    async (grant: WorkspaceResourceGrant, accessRole: WorkspaceShareAccessRole) => {
      if (!resource) return
      setBusyKey(grant.id)
      try {
        const updated = await grantResourceShare(resource, {
          targetType: grant.targetType,
          targetId: grant.targetId,
          accessRole,
          confirmRoomExpansion: true,
        })
        setGrants((current) => current.map((item) => (item.id === grant.id ? updated : item)))
      } catch {
        setNotice('Could not update access')
      } finally {
        setBusyKey(null)
      }
    },
    [resource],
  )

  const requestRevoke = useCallback(
    async (grant: WorkspaceResourceGrant) => {
      if (!resource) return
      setBusyKey(grant.id)
      try {
        const impact = await shareImpact(resource, { grantId: grant.id })
        const losing = impact.losing.map((p) => p.name).slice(0, 6).join(', ')
        Alert.alert(
          'Remove access?',
          impact.losing.length > 0
            ? `${impact.losing.length} ${impact.losing.length === 1 ? 'person' : 'people'} will lose access (${losing}${impact.losing.length > 6 ? '…' : ''}).`
            : `No one currently reaches this resource through ${impact.targetName}.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: () => {
                void revokeResourceShare(resource, grant.id)
                  .then(() =>
                    setGrants((current) => current.filter((item) => item.id !== grant.id)),
                  )
                  .catch(() => setNotice('Could not remove access'))
              },
            },
          ],
        )
      } catch {
        setNotice('Could not check who would lose access')
      } finally {
        setBusyKey(null)
      }
    },
    [resource],
  )

  const cycleRole = useCallback(
    (grant: WorkspaceResourceGrant) => {
      const order: WorkspaceShareAccessRole[] = ['viewer', 'operator', 'editor']
      const next = order[(order.indexOf(grant.accessRole) + 1) % order.length]!
      Alert.alert(
        'Change access level',
        `Set ${entriesByKey.get(`${grant.targetType}:${grant.targetId}`)?.name ?? grant.targetId} to ${next}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Change', onPress: () => void changeRole(grant, next) },
        ],
      )
    },
    [entriesByKey, changeRole],
  )

  return (
    <BottomSheet
      theme={theme}
      visible={visible}
      onClose={onClose}
      title={`Share “${resourceTitle}”`}
    >
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {onSetPublicVisibility ? (
          <Section theme={theme}>
            <ListRow
              theme={theme}
              icon="link"
              title="Public link"
              subtitle={
                !publicLinksEnabled
                  ? 'Public links are disabled by workspace policy.'
                  : linkVisibility === 'public'
                    ? linkUrl ?? 'Anyone with the link can view (read-only).'
                    : 'Off — enable to let anyone with the link view (read-only).'
              }
              accessory={
                <View style={styles.grantActions}>
                  {linkVisibility === 'public' && linkUrl ? (
                    <TouchableOpacity
                      onPress={() => void Clipboard.setStringAsync(linkUrl)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Feather name="copy" size={16} color={theme.textSecondary} />
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    disabled={busyKey !== null || !publicLinksEnabled}
                    onPress={() => {
                      const next = linkVisibility === 'public' ? 'private' : 'public'
                      setBusyKey('public-link')
                      void onSetPublicVisibility(next)
                        .then((url) => {
                          setLinkVisibility(next)
                          setLinkUrl(url)
                        })
                        .catch((toggleError) =>
                          setNotice(
                            toggleError instanceof Error
                              ? toggleError.message
                              : 'Could not update the public link',
                          ),
                        )
                        .finally(() => setBusyKey(null))
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {busyKey === 'public-link' ? (
                      <ActivityIndicator size="small" color={theme.textSecondary} />
                    ) : (
                      <Text style={[styles.roleLink, { color: theme.text }]}>
                        {linkVisibility === 'public' ? 'Turn off' : 'Turn on'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              }
            />
          </Section>
        ) : publicUrl ? (
          <Section theme={theme}>
            <ListRow
              theme={theme}
              icon="link"
              title="Public link"
              subtitle={
                publicLinksEnabled
                  ? 'Anyone with the link can view (read-only).'
                  : 'Public links are disabled by workspace policy.'
              }
              accessory={
                <TouchableOpacity
                  onPress={() => void Clipboard.setStringAsync(publicUrl)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="copy" size={16} color={theme.textSecondary} />
                </TouchableOpacity>
              }
            />
          </Section>
        ) : null}

        {error ? (
          <Text style={[styles.notice, { color: '#EF4444' }]}>{error}</Text>
        ) : null}
        {notice ? (
          <Text style={[styles.notice, { color: theme.textSecondary }]}>{notice}</Text>
        ) : null}

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : !resource ? null : (
          <>
            <Section theme={theme}>
              {grants.length === 0 ? (
                <ListRow
                  theme={theme}
                  title="Not shared yet"
                  subtitle="People, agents, teams, and rooms inherit access dynamically."
                  disabled
                />
              ) : (
                grants.map((grant) => {
                  const entry = entriesByKey.get(`${grant.targetType}:${grant.targetId}`)
                  return (
                    <ListRow
                      key={grant.id}
                      theme={theme}
                      icon={
                        grant.targetType === 'team'
                          ? 'users'
                          : grant.targetType === 'room'
                            ? 'message-circle'
                            : 'user'
                      }
                      title={entry?.name ?? grant.targetId}
                      subtitle={`${grant.targetType} · ${grant.accessRole}`}
                      accessory={
                        busyKey === grant.id ? (
                          <ActivityIndicator size="small" color={theme.textSecondary} />
                        ) : (
                          <View style={styles.grantActions}>
                            <TouchableOpacity
                              onPress={() => cycleRole(grant)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Text style={[styles.roleLink, { color: theme.text }]}>Role</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => void requestRevoke(grant)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Feather name="x" size={16} color={theme.textSecondary} />
                            </TouchableOpacity>
                          </View>
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
                placeholder="Search people, agents, teams, rooms"
              />
              {available.length > 0 ? (
                <Section theme={theme}>
                  {available.map((entry) => {
                    const key = targetKey(entry)
                    return (
                      <ListRow
                        key={key}
                        theme={theme}
                        icon={directoryIcon(entry)}
                        title={entry.name}
                        subtitle={entry.description ?? entry.targetType}
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
                    options={ACCESS_ROLES}
                    onChange={setRole}
                  />
                  <TouchableOpacity
                    activeOpacity={0.85}
                    disabled={busyKey !== null}
                    onPress={() => void requestGrant()}
                    style={[styles.grantButton, { backgroundColor: theme.foreground }]}
                  >
                    {busyKey === selectedTarget ? (
                      <ActivityIndicator size="small" color={theme.background} />
                    ) : (
                      <Text style={[styles.grantButtonText, { color: theme.background }]}>
                        Share
                      </Text>
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
  scroll: { maxHeight: 520 },
  loadingWrap: { alignItems: 'center', paddingVertical: spacing.xl },
  notice: { fontSize: fontSize.sm, paddingVertical: spacing.xs },
  grantActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  roleLink: { fontSize: fontSize.sm, fontWeight: '600' },
  addBlock: { marginTop: spacing.sm, gap: spacing.xs },
  addLabel: { fontSize: fontSize.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  grantBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grantButton: {
    borderRadius: borderRadius.full,
    paddingHorizontal: 18,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 76,
  },
  grantButtonText: { fontSize: fontSize.sm, fontWeight: '700' },
})
