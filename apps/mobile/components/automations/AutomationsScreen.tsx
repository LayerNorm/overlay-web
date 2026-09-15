import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import type { AutomationRunSummary, AutomationSummary } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { EmptyState, MainScreenHeader, StatusPill, TopBarIconButton } from '../ui/AppChrome'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { FeatureGate } from '../ui/FeatureGate'
import { AutomationDetailSheet, formatSchedule } from './AutomationDetailSheet'
import { AutomationEditorSheet } from './AutomationEditorSheet'
import { AutomationRunSheet } from './AutomationRunSheet'
import {
  deleteAutomation,
  listAutomations,
  setAutomationEnabled,
} from '../../services/automationsService'

export function AutomationsScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { openDrawer } = useDrawer()
  const { isFeatureEnabled } = useAppSession()
  const [automations, setAutomations] = useState<AutomationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<AutomationSummary | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AutomationSummary | null>(null)
  const [selectedRun, setSelectedRun] = useState<AutomationRunSummary | null>(null)
  const [runSheetOpen, setRunSheetOpen] = useState(false)
  // Approval tokens are only returned to the client that triggered the run —
  // stash them by automation run id so the run sheet can offer approve/deny.
  const [approvalTokens, setApprovalTokens] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setAutomations(await listAutomations())
    } catch (error) {
      Alert.alert('Automations unavailable', error instanceof Error ? error.message : 'Could not load automations')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const sorted = useMemo(
    () => [...automations].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [automations],
  )

  function openDetail(item: AutomationSummary): void {
    setSelected(item)
    setDetailOpen(true)
  }

  function openCreate(): void {
    setEditing(null)
    setEditorOpen(true)
  }

  async function toggle(item: AutomationSummary, enabled: boolean): Promise<void> {
    setAutomations((prev) => prev.map((row) => row._id === item._id ? { ...row, enabled } : row))
    try {
      await setAutomationEnabled(item._id, enabled)
    } catch (error) {
      setAutomations((prev) => prev.map((row) => row._id === item._id ? { ...row, enabled: item.enabled } : row))
      Alert.alert('Could not update automation', error instanceof Error ? error.message : 'Try again.')
    }
  }

  function confirmDelete(item: AutomationSummary): void {
    Alert.alert('Delete automation', `Delete ${item.name || item.title || 'this automation'}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAutomation(item._id)
            setAutomations((prev) => prev.filter((row) => row._id !== item._id))
            setDetailOpen(false)
          } catch (error) {
            Alert.alert('Could not delete automation', error instanceof Error ? error.message : 'Try again.')
          }
        },
      },
    ])
  }

  if (!isFeatureEnabled('automations')) {
    return <FeatureGate title="Automations are turned off" />
  }

  return (
    <ScreenWithDrawer drawer={<DrawerSidebar variant="slide" theme={theme} chats={[]} activeChatId={null} onSelectChat={() => {}} onCreateChat={() => {}} />}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
        <MainScreenHeader
          theme={theme}
          isDark={isDark}
          topInset={insets.top}
          blurHeight={insets.top + 56}
          leftSlot={<TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />}
          centerSlot={<Text style={[styles.headerTitle, { color: theme.text }]}>Automations</Text>}
          rightSlot={<TopBarIconButton theme={theme} icon="plus" onPress={openCreate} />}
        />
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 72 }]}>
          {loading ? (
            <ActivityIndicator color={theme.textSecondary} />
          ) : sorted.length === 0 ? (
            <EmptyState theme={theme} icon="zap" title="No automations" description="Create scheduled workflows that run through the Overlay backend." />
          ) : sorted.map((item) => (
            <TouchableOpacity
              key={item._id}
              activeOpacity={0.82}
              onPress={() => openDetail(item)}
              style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
            >
              <View style={styles.cardTop}>
                <View style={styles.cardCopy}>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>{item.name || item.title || 'Untitled automation'}</Text>
                  <Text style={[styles.cardMeta, { color: theme.textSecondary }]}>{formatSchedule(item.schedule)}</Text>
                </View>
                <Switch value={item.enabled !== false} onValueChange={(next) => { void toggle(item, next) }} />
              </View>
              {item.description ? <Text style={[styles.cardDescription, { color: theme.textSecondary }]} numberOfLines={2}>{item.description}</Text> : null}
              <View style={styles.cardFooter}>
                <StatusPill theme={theme} label={item.lastRunStatus || (item.enabled === false ? 'Paused' : 'Active')} tone={item.enabled === false ? 'default' : 'active'} />
                <TouchableOpacity onPress={() => confirmDelete(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Feather name="trash-2" size={16} color="#EF4444" />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <AutomationDetailSheet
          visible={detailOpen}
          automation={selected}
          onClose={() => setDetailOpen(false)}
          onEdit={() => {
            setEditing(selected)
            setDetailOpen(false)
            setEditorOpen(true)
          }}
          onOpenRun={(run) => {
            setSelectedRun(run)
            setRunSheetOpen(true)
          }}
          onOpenChat={(conversationId) => router.push(`/chat/${conversationId}`)}
          onTriggerResult={(result) => {
            if (result.approvalRequired && result.approvalToken && result.runId) {
              setApprovalTokens((prev) => ({ ...prev, [result.runId!]: result.approvalToken! }))
            }
          }}
        />
        <AutomationEditorSheet
          visible={editorOpen}
          automation={editing}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false)
            void load()
          }}
        />
        <AutomationRunSheet
          visible={runSheetOpen}
          automationId={selected?._id ?? ''}
          run={selectedRun}
          approvalToken={selectedRun ? approvalTokens[selectedRun._id] : null}
          onClose={() => setRunSheetOpen(false)}
          onOpenChat={(conversationId) => router.push(`/chat/${conversationId}`)}
          onChanged={() => { void load() }}
        />
      </SafeAreaView>
    </ScreenWithDrawer>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTitle: { fontSize: fontSize.md, fontWeight: '700', textAlign: 'center' },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.xl, padding: spacing.md, gap: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  cardCopy: { flex: 1, gap: 4 },
  cardTitle: { fontSize: fontSize.md, fontWeight: '700' },
  cardMeta: { fontSize: fontSize.sm },
  cardDescription: { fontSize: fontSize.sm, lineHeight: 20 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
})
