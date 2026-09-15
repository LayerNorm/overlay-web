import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import {
  EmptyState,
  MainScreenHeader,
  SegmentedControl,
  TopBarIconButton,
} from '../ui/AppChrome'
import { Badge } from '../ui/primitives'
import { AppIcon } from '../ui/AppIcon'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { FeatureGate } from '../ui/FeatureGate'
import { AgentCreature } from './AgentCreature'
import { EnvironmentsPanel } from './EnvironmentsPanel'
import {
  listAgents,
  openAgentChat,
  type AgentDirectoryItem,
} from '../../services/agentsService'
import { workspaceAgentUsesByo } from '../../lib/agentByo'

type AgentsTab = 'agents' | 'environments'

export function AgentsScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { openDrawer } = useDrawer()
  const { isFeatureEnabled, capabilities } = useAppSession()
  const { activeWorkspaceId, activeWorkspace } = useWorkspace()
  const router = useRouter()

  const [tab, setTab] = useState<AgentsTab>('agents')
  const [agents, setAgents] = useState<AgentDirectoryItem[]>([])
  const [canCreate, setCanCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatBusyId, setChatBusyId] = useState<string | null>(null)

  const workspaceId = activeWorkspaceId ?? ''

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const directory = await listAgents(workspaceId)
      setAgents(directory.agents)
      setCanCreate(directory.canCreate)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load agents.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [workspaceId])

  // Reload whenever the screen gains focus or the active workspace changes.
  useFocusEffect(useCallback(() => { void load() }, [load]))

  const startChat = useCallback(async (agent: AgentDirectoryItem) => {
    if (chatBusyId) return
    setChatBusyId(agent.id)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      const conversationId = await openAgentChat(workspaceId, agent)
      router.push({ pathname: '/chat/[id]', params: { id: conversationId } })
    } catch (nextError) {
      Alert.alert(
        'Could not open chat',
        nextError instanceof Error ? nextError.message : 'Something went wrong starting this conversation.',
      )
    } finally {
      setChatBusyId(null)
    }
  }, [chatBusyId, router, workspaceId])

  if (!isFeatureEnabled('agents')) {
    return <FeatureGate title="Agents are turned off" />
  }

  const renderAgentRow = (agent: AgentDirectoryItem) => {
    const subtitle = agent.description?.trim()
      || (workspaceAgentUsesByo(agent) ? 'Connected environment' : 'Overlay agent')
    return (
      <TouchableOpacity
        key={agent.id}
        activeOpacity={0.82}
        onPress={() => router.push({ pathname: '/agent/[id]', params: { id: agent.id } })}
        style={[styles.agentRow, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}
        accessibilityRole="button"
        accessibilityLabel={`${agent.name}. ${subtitle}`}
      >
        <AgentCreature shape={agent.avatarShape} color={agent.avatarColor} size={40} label={agent.name} />
        <View style={styles.agentBody}>
          <View style={styles.agentTitleRow}>
            <Text style={[styles.agentName, { color: theme.text }]} numberOfLines={1}>
              {agent.name}
            </Text>
            {agent.isDefault ? <Badge theme={theme} label="Default" /> : null}
            {agent.visibility === 'creator' ? <Badge theme={theme} label="Private" /> : null}
          </View>
          <Text style={[styles.agentSubtitle, { color: theme.textSecondary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => void startChat(agent)}
          disabled={chatBusyId !== null}
          hitSlop={8}
          style={[styles.chatButton, { backgroundColor: theme.surfaceSubtle }]}
          accessibilityRole="button"
          accessibilityLabel={`Chat with ${agent.name}`}
        >
          {chatBusyId === agent.id ? (
            <ActivityIndicator size="small" color={theme.textSecondary} />
          ) : (
            <AppIcon sfSymbol="bubble.left" featherIcon="message-circle" size={16} color={theme.text} />
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    )
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
          centerSlot={<Text style={[styles.headerTitle, { color: theme.text }]}>Agents</Text>}
          rightSlot={
            tab === 'agents' && canCreate ? (
              <TopBarIconButton
                theme={theme}
                icon="plus"
                onPress={() => router.push({ pathname: '/agent/[id]', params: { id: 'new' } })}
              />
            ) : undefined
          }
        />
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 72 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={theme.textSecondary}
            />
          }
        >
          <View style={styles.workspaceHint}>
            <Text style={[styles.workspaceHintText, { color: theme.textSecondary }]} numberOfLines={1}>
              {activeWorkspace?.name ?? 'Workspace'}
            </Text>
          </View>
          <SegmentedControl
            theme={theme}
            value={tab}
            onChange={setTab}
            options={[
              { label: 'Agents', value: 'agents' },
              { label: 'Environments', value: 'environments' },
            ]}
          />
          {tab === 'agents' ? (
            loading ? (
              <ActivityIndicator color={theme.textSecondary} style={styles.loading} />
            ) : error ? (
              <EmptyState
                theme={theme}
                icon="alert-circle"
                title="Agents unavailable"
                description={error}
                action={
                  <TouchableOpacity
                    onPress={() => void load()}
                    style={[styles.retryButton, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
                  >
                    <Text style={[styles.retryText, { color: theme.text }]}>Try again</Text>
                  </TouchableOpacity>
                }
              />
            ) : agents.length === 0 ? (
              <EmptyState
                theme={theme}
                icon="cpu"
                title="No agents yet"
                description={canCreate
                  ? 'Agents are persistent collaborators with their own instructions, model, and tools.'
                  : 'This workspace has no agents you can see.'}
                action={canCreate ? (
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/agent/[id]', params: { id: 'new' } })}
                    style={[styles.primaryButton, { backgroundColor: theme.foreground }]}
                  >
                    <Text style={[styles.primaryButtonText, { color: theme.background }]}>New agent</Text>
                  </TouchableOpacity>
                ) : undefined}
              />
            ) : (
              <View style={styles.agentList}>{agents.map(renderAgentRow)}</View>
            )
          ) : (
            <EnvironmentsPanel
              theme={theme}
              workspaceId={workspaceId}
              connectedAgentsEnabled={capabilities.connectedAgents}
            />
          )}
        </ScrollView>
      </SafeAreaView>
    </ScreenWithDrawer>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '600' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  workspaceHint: { alignItems: 'center' },
  workspaceHintText: { fontSize: fontSize.xs, fontWeight: '500' },
  loading: { marginTop: spacing.xl },
  agentList: { gap: spacing.sm },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
  },
  agentBody: { flex: 1, gap: 2, minWidth: 0 },
  agentTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  agentName: { fontSize: fontSize.md, fontWeight: '600', flexShrink: 1 },
  agentSubtitle: { fontSize: fontSize.sm, lineHeight: 18 },
  chatButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retryText: { fontSize: fontSize.sm, fontWeight: '600' },
  primaryButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.full,
  },
  primaryButtonText: { fontSize: fontSize.sm, fontWeight: '600' },
})
