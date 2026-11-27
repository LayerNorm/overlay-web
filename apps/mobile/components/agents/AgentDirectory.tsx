import React, { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Image } from 'expo-image'
import type { Theme } from '../../constants/theme'
import type { AgentRecord } from '../../services/agentThreadService'
import { api, subscribeConvex } from '../../services/convexClient'
import { hapticSelect } from '../../lib/haptics'
import { AgentAvatar } from '../shell/AgentAvatar'
import { T } from '../shell/primitives'

type Status = 'needs' | 'working' | 'ready' | null

const QUICK_COUNT = 4
const recentKey = (workspaceId: string) => `overlay_recent_agents:${workspaceId}`

/** Remembers which agents were opened last on this device, newest first. */
function useRecentAgents(workspaceId: string | null) {
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    AsyncStorage.getItem(recentKey(workspaceId))
      .then((value) => {
        const ids = value ? (JSON.parse(value) as unknown) : []
        if (active && Array.isArray(ids)) setRecent(ids.filter((id): id is string => typeof id === 'string'))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [workspaceId])
  const remember = (agentId: string) => {
    if (!workspaceId) return
    const next = [agentId, ...recent.filter((id) => id !== agentId)].slice(0, 12)
    setRecent(next)
    void AsyncStorage.setItem(recentKey(workspaceId), JSON.stringify(next)).catch(() => undefined)
  }
  return { recent, remember }
}

/** The most urgent state across the agent's threads: needs you, working, then ready to review. */
function useAgentStatus(workspaceId: string | null, agentId: string): Status {
  const [status, setStatus] = useState<Status>(null)
  useEffect(() => {
    if (!workspaceId) return
    try {
      return subscribeConvex(
        api.agents.threads.activity,
        { workspaceId, agentId },
        (value) => {
          const states = new Set((value ?? []).map((item) => item.status))
          setStatus(
            states.has('needs_input') ? 'needs' : states.has('working') ? 'working' : states.has('ready') ? 'ready' : null,
          )
        },
        () => setStatus(null),
      )
    } catch {
      return undefined
    }
  }, [workspaceId, agentId])
  return status
}

function describe(agent: AgentRecord, short = false) {
  if (agent.isDefault) return short ? 'Chief of Staff' : 'Your AI Chief of Staff'
  return agent.description?.trim() || 'Ready when you are'
}

const STATUS_LABEL: Record<Exclude<Status, null>, string> = {
  needs: 'Needs you',
  working: 'Working…',
  ready: 'Ready to review',
}

function QuickAgent({ agent, workspaceId, theme, dark, onOpen }: RowProps) {
  const status = useAgentStatus(workspaceId, agent.id)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${agent.name}`}
      onPress={() => onOpen(agent)}
      style={({ pressed }) => ({ width: 93, paddingHorizontal: 4, alignItems: 'center', gap: 8, opacity: pressed ? 0.6 : 1 })}
    >
      <AgentAvatar agent={agent} dark={dark} foreground={theme.foreground} size={56} working={status === 'working'} />
      <View style={{ alignItems: 'center', gap: 2, alignSelf: 'stretch' }}>
        <T numberOfLines={1} style={{ color: theme.foreground, fontSize: 13, fontFamily: 'GeistMedium' }}>
          {agent.name}
        </T>
        <T numberOfLines={1} style={{ color: status ? theme.foreground : theme.muted, fontSize: 12 }}>
          {status ? STATUS_LABEL[status] : describe(agent, true)}
        </T>
      </View>
    </Pressable>
  )
}

type RowProps = {
  agent: AgentRecord
  workspaceId: string | null
  theme: Theme
  dark: boolean
  onOpen: (agent: AgentRecord) => void
}

function AgentRow({ agent, workspaceId, theme, dark, onOpen }: RowProps) {
  const status = useAgentStatus(workspaceId, agent.id)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${agent.name}`}
      onPress={() => onOpen(agent)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 20,
        paddingVertical: 12,
        backgroundColor: pressed ? theme.surfaceSubtle : 'transparent',
      })}
    >
      <AgentAvatar agent={agent} dark={dark} foreground={theme.foreground} size={44} working={status === 'working'} />
      <View style={{ flex: 1, gap: 2 }}>
        <T numberOfLines={1} style={{ color: theme.foreground, fontSize: 16, fontFamily: 'GeistMedium' }}>
          {agent.name}
        </T>
        <T numberOfLines={1} style={{ color: theme.muted, fontSize: 14 }}>
          {describe(agent)}
        </T>
        {status ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            {status === 'needs' ? (
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.foreground }} />
            ) : null}
            <T style={{ color: theme.foreground, fontSize: 13, fontFamily: status === 'needs' ? 'GeistMedium' : 'Geist' }}>
              {STATUS_LABEL[status]}
            </T>
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

/**
 * Agents tab: a quick-access row (the default agent and the ones opened most
 * recently on this device) above the full list. Each agent shows what it is for
 * and, live, whether it is working, needs you, or has something to review.
 */
export function AgentDirectoryView({
  agents,
  workspaceId,
  theme,
  dark,
  onOpen,
  onCreate,
}: {
  agents: AgentRecord[]
  workspaceId: string | null
  theme: Theme
  dark: boolean
  onOpen: (agent: AgentRecord) => void
  onCreate?: () => void
}) {
  const { recent, remember } = useRecentAgents(workspaceId)
  const open = (agent: AgentRecord) => {
    hapticSelect()
    remember(agent.id)
    onOpen(agent)
  }
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  // Quick row: the default agent, then the most recently opened, topped up in
  // directory order. It only helps once the list is longer than the row.
  const quick = agents.length > QUICK_COUNT
    ? [
        ...new Set([
          ...agents.filter((agent) => agent.isDefault),
          ...recent.map((id) => byId.get(id)).filter((agent): agent is AgentRecord => Boolean(agent)),
          ...agents,
        ]),
      ].slice(0, QUICK_COUNT)
    : []
  const quickIds = new Set(quick.map((agent) => agent.id))
  const ordered = [
    ...agents.filter((agent) => agent.isDefault && !quickIds.has(agent.id)),
    ...agents.filter((agent) => !agent.isDefault && !quickIds.has(agent.id)),
  ]
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={{ paddingBottom: 32 }}
    >
      {quick.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 12, paddingBottom: 20, gap: 0 }}
        >
          {quick.map((agent) => (
            <QuickAgent key={agent.id} agent={agent} workspaceId={workspaceId} theme={theme} dark={dark} onOpen={open} />
          ))}
        </ScrollView>
      ) : null}
      {quick.length && ordered.length ? (
        <T style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 4, color: theme.muted, fontSize: 13, fontFamily: 'GeistMedium' }}>
          All agents
        </T>
      ) : null}
      {ordered.map((agent) => (
        <AgentRow key={agent.id} agent={agent} workspaceId={workspaceId} theme={theme} dark={dark} onOpen={open} />
      ))}
      {onCreate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New agent"
          onPress={onCreate}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            paddingHorizontal: 20,
            paddingVertical: 12,
            backgroundColor: pressed ? theme.surfaceSubtle : 'transparent',
          })}
        >
          <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceSubtle }}>
            <Image alt="" source="sf:plus" style={{ width: 18, height: 18 }} contentFit="contain" tintColor={theme.foreground as string} />
          </View>
          <T style={{ color: theme.foreground, fontSize: 16, fontFamily: 'GeistMedium' }}>New agent</T>
        </Pressable>
      ) : null}
      {!agents.length && !onCreate ? (
        <T style={{ color: theme.muted, textAlign: 'center', padding: 48 }}>No agents in this workspace.</T>
      ) : null}
    </ScrollView>
  )
}
