import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import type { WorkspaceAgentCreatureShape } from '@overlay/workspace-contracts'
import { useTheme } from '../hooks/useTheme'
import { useAppSession } from '../contexts/AppSessionContext'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { AgentAvatar } from '../components/shell/AgentAvatar'
import { CREATURE_SHAPES } from '../lib/agentCreature'
import { DEFAULT_AGENT_TOOL_GROUP_IDS } from '../lib/agentToolGroups'
import { buildWorkspaceAgentInput } from '../lib/agentByo'
import { hapticSelect } from '../lib/haptics'
import { createAgent } from '../services/agentsService'
import { openAgentThread } from '../services/shellService'

/** Body colors offered for new agents (web `AVATAR_COLORS`). */
const COLORS = [
  '#f5f5f4', '#8a6240', '#dc2626', '#ea580c', '#f59e0b', '#16a34a',
  '#14b8a6', '#2563eb', '#7c3aed', '#db2777', '#64748b',
]

/**
 * Create-agent sheet: pick a creature, a name and what it should help with,
 * then land in its chat. Model and tools start from the defaults and are tuned
 * later from the agent's Edit screen.
 */
export default function CreateAgentSheet(): React.ReactElement {
  const router = useRouter()
  const { theme, isDark } = useTheme()
  const { chatModels, uiSettings } = useAppSession()
  const { activeWorkspaceId } = useWorkspace()
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [shape, setShape] = useState<WorkspaceAgentCreatureShape>('cloud')
  const [color, setColor] = useState(COLORS[9])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const modelId = useMemo(() => {
    const preferred = uiSettings.defaultActModelId
    if (preferred && chatModels.some((model) => model.id === preferred)) return preferred
    const sorted = [...chatModels].sort((a, b) => b.intelligence - a.intelligence)
    return sorted.find((model) => model.cost === 0)?.id ?? sorted[0]?.id ?? ''
  }, [chatModels, uiSettings.defaultActModelId])

  const create = async () => {
    if (!activeWorkspaceId || !name.trim() || !modelId) return
    setBusy(true)
    setError(null)
    try {
      const agent = await createAgent(activeWorkspaceId, buildWorkspaceAgentInput({
        name,
        description: purpose.trim(),
        instructions: purpose.trim()
          ? `You are ${name.trim()}. Help with: ${purpose.trim()}`
          : 'You are a helpful assistant.',
        agentType: 'overlay',
        harnessLabel: 'Overlay',
        adapterId: '',
        modelId,
        avatarColor: color,
        avatarShape: shape,
        enabledToolGroups: new Set(DEFAULT_AGENT_TOOL_GROUP_IDS),
        visibility: 'workspace',
      }))
      const thread = await openAgentThread(activeWorkspaceId, agent.id)
      router.dismiss()
      if (thread) router.push(`/dm/${thread.conversationId}` as never)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create this agent.')
    } finally {
      setBusy(false)
    }
  }

  const shuffle = () => {
    hapticSelect()
    setShape(CREATURE_SHAPES[Math.floor(Math.random() * CREATURE_SHAPES.length)])
    setColor(COLORS[Math.floor(Math.random() * COLORS.length)])
  }
  const ready = Boolean(name.trim() && modelId) && !busy

  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.dismiss()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="checkmark"
          variant="prominent"
          tintColor={theme.foreground as string}
          accessibilityLabel="Create agent"
          disabled={!ready}
          onPress={() => void create()}
        />
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32, gap: 28, alignItems: 'center' }}
      >
        <View style={{ paddingTop: 8 }}>
          <AgentAvatar
            agent={{ name: name || 'New agent', avatarShape: shape, avatarColor: color }}
            dark={isDark}
            foreground={theme.foreground}
            size={150}
            working
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Random look"
            onPress={shuffle}
            hitSlop={8}
            style={({ pressed }) => ({
              position: 'absolute',
              right: -8,
              bottom: 4,
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? theme.surfaceMuted : theme.surfaceSubtle,
            })}
          >
            <Image alt="" source="sf:shuffle" style={{ width: 18, height: 18 }} contentFit="contain" tintColor={theme.foreground as string} />
          </Pressable>
        </View>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name your agent"
          placeholderTextColor={theme.muted}
          accessibilityLabel="Agent name"
          textContentType="none"
          autoComplete="off"
          returnKeyType="done"
          maxLength={60}
          style={{
            alignSelf: 'stretch',
            height: 60,
            borderRadius: 20,
            borderCurve: 'continuous',
            backgroundColor: theme.surfaceSubtle,
            textAlign: 'center',
            fontFamily: 'GeistMedium',
            fontSize: 22,
            color: theme.foreground,
          }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14 }}>
          {CREATURE_SHAPES.map((option) => {
            const selected = option === shape
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityLabel={`${option} shape`}
                accessibilityState={{ selected }}
                onPress={() => {
                  hapticSelect()
                  setShape(option)
                }}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: selected ? theme.foreground : 'transparent',
                }}
              >
                <AgentAvatar agent={{ name: option, avatarShape: option, avatarColor: color }} dark={isDark} foreground={theme.foreground} size={46} />
              </Pressable>
            )
          })}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, maxWidth: 320 }}>
          {COLORS.map((option) => {
            const selected = option === color
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityLabel={`Color ${option}`}
                accessibilityState={{ selected }}
                onPress={() => {
                  hapticSelect()
                  setColor(option)
                }}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: selected ? theme.foreground : 'transparent',
                }}
              >
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: option, borderWidth: 0.5, borderColor: theme.border }} />
              </Pressable>
            )
          })}
        </View>
        <View style={{ alignSelf: 'stretch', gap: 8 }}>
          <Text style={{ fontFamily: 'GeistMedium', fontSize: 13, color: theme.muted, paddingHorizontal: 4 }}>
            What should this agent help with?
          </Text>
          <TextInput
            value={purpose}
            onChangeText={setPurpose}
            placeholder="Plan trips, triage email, or keep an eye on a project."
            placeholderTextColor={theme.muted}
            accessibilityLabel="What should this agent help with?"
            textContentType="none"
            autoComplete="off"
            multiline
            maxLength={500}
            style={{
              minHeight: 96,
              borderRadius: 20,
              borderCurve: 'continuous',
              backgroundColor: theme.surfaceSubtle,
              paddingHorizontal: 16,
              paddingTop: 14,
              paddingBottom: 14,
              fontFamily: 'Geist',
              fontSize: 16,
              lineHeight: 22,
              color: theme.foreground,
              textAlignVertical: 'top',
            }}
          />
        </View>
        {error ? (
          <Text accessibilityRole="alert" selectable style={{ fontFamily: 'Geist', color: theme.foreground, textAlign: 'center' }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </>
  )
}
