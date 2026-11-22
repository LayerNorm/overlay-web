import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Pin } from 'lucide-react-native'
import { agentsForCreatorScope } from '../../../src/shared/agents/last-agent-by-workspace'
import { chiefRoleLabel, isPinnedChief, pinChiefs } from '../../../src/shared/agents/chief-identity'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useTheme } from '../../hooks/useTheme'
import { subscribeAgents, type ShellAgent } from '../../services/shellService'
import { AgentAvatar } from '../shell/AgentAvatar'
import { Button, IconButton, T } from '../shell/primitives'
import { WorkSheet } from './WorkControls'

type Scope = 'workspace' | 'personal'
type Directory = { agents: ShellAgent[]; viewerPrincipalId: string | null }

export function WorkOrganization({
  workspaceId,
  workspaceName,
  initialScope,
}: {
  workspaceId: string | null
  workspaceName?: string
  initialScope: Scope
}) {
  const { theme, isDark } = useTheme()
  const ready = useNativeDataReady()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [scope, setScope] = useState(initialScope)
  const [directory, setDirectory] = useState<Directory | null>(null)
  const [selection, select] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!workspaceId || !ready) return
    return subscribeAgents(
      workspaceId,
      (agents, viewerPrincipalId) => {
        setDirectory({ agents, viewerPrincipalId })
        setFailed(false)
      },
      () => setFailed(true),
    )
  }, [workspaceId, ready, attempt])

  const viewer = directory?.viewerPrincipalId
  const agents = pinChiefs(
    agentsForCreatorScope(
      (directory?.agents ?? []).filter((agent) => !agent.archivedAt),
      viewer,
      scope,
    ),
    viewer,
  )
  const chief = agents.find(
    (agent) => agent.agentRole === (scope === 'workspace' ? 'workspace_chief' : 'personal_chief'),
  )
  const selected = agents.find((agent) => agent.id === selection)
  const owner = (agent: ShellAgent) =>
    agent.agentRole === 'workspace_chief'
      ? workspaceName || 'Workspace'
      : (agent.createdByDisplayName || 'Member') +
        (agent.createdByPrincipalId === viewer ? ' · You' : '')

  function agentCard(agent: ShellAgent) {
    return (
      <Pressable
        key={agent.id}
        accessibilityRole="button"
        accessibilityLabel={`${agent.name}, ${chiefRoleLabel(agent)}, ${owner(agent)}`}
        onPress={() => select(agent.id)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 14,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          backgroundColor: pressed ? theme.surfaceSubtle : theme.surfaceElevated,
        })}
      >
        <AgentAvatar agent={agent} foreground={theme.foreground} dark={isDark} size={34} />
        <View style={{ flex: 1, gap: 3 }}>
          <T style={{ color: theme.foreground, fontWeight: '500' }}>{agent.name}</T>
          <T style={{ color: theme.muted, fontSize: 12 }}>{chiefRoleLabel(agent)}</T>
          <T style={{ color: theme.muted, fontSize: 12 }}>{owner(agent)}</T>
        </View>
        {isPinnedChief(agent, viewer) ? <Pin size={14} color={theme.muted} /> : null}
      </Pressable>
    )
  }

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: theme.surfaceElevated }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          height: 52,
        }}
      >
        <IconButton
          icon={ArrowLeft}
          label="Back to Work"
          theme={theme}
          onPress={() => router.dismissTo('/(tabs)/work')}
        />
        <T style={{ color: theme.foreground, fontWeight: '500' }}>Organization</T>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 12 }}
      >
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['workspace', 'personal'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: scope === value }}
              onPress={() => {
                setScope(value)
                select(null)
              }}
              style={{
                padding: 10,
                borderRadius: 7,
                backgroundColor: scope === value ? theme.surfaceSubtle : 'transparent',
              }}
            >
              <T style={{ color: scope === value ? theme.foreground : theme.muted }}>
                {value === 'workspace' ? 'Workspace' : 'Personal'}
              </T>
            </Pressable>
          ))}
        </View>
        {failed ? (
          <>
            <T accessibilityRole="alert" style={{ color: theme.foreground }}>
              Could not load the organization.
            </T>
            <Button
              theme={theme}
              onPress={() => {
                setFailed(false)
                setAttempt(attempt + 1)
              }}
            >
              Try again
            </Button>
          </>
        ) : !workspaceId ? (
          <T style={{ color: theme.muted }}>Choose a workspace to view its organization.</T>
        ) : !ready || !directory ? (
          <ActivityIndicator accessibilityLabel="Loading organization" color={theme.muted} />
        ) : (
          <>
            {chief ? (
              agentCard(chief)
            ) : (
              <T style={{ color: theme.muted }}>No chief of staff is available in this scope.</T>
            )}
            {agents.some(({ id }) => id !== chief?.id) ? (
              <View
                style={{
                  marginLeft: 16,
                  paddingLeft: 12,
                  borderLeftWidth: 1,
                  borderColor: theme.border,
                  gap: 8,
                }}
              >
                {agents.filter(({ id }) => id !== chief?.id).map(agentCard)}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      {selected ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => select(null)}>
          <WorkSheet
            title={selected.name}
            theme={theme}
            onClose={() => select(null)}
            bottomInset={insets.bottom}
          >
            <T style={{ color: theme.muted }}>
              {chiefRoleLabel(selected)} · {owner(selected)}
            </T>
            {selected.description ? (
              <T style={{ color: theme.foreground }}>{selected.description}</T>
            ) : null}
            <Button
              theme={theme}
              secondary
              onPress={() => {
                select(null)
                router.push({ pathname: '/agent/[id]', params: { id: selected.id } })
              }}
            >
              Open agent
            </Button>
          </WorkSheet>
        </Modal>
      ) : null}
    </View>
  )
}
