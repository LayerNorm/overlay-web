/**
 * Agent editor — create/edit an agent as a pushed screen.
 *
 * Mirrors web `AgentEditorPage` semantics: tool-group grants (capability
 * grant ids), creature avatar, model + instructions, who can use it, and
 * agent-computer provision/destroy on save. Visibility is one-way: an only-me
 * agent can move to the workspace, never back. Layout is a native SwiftUI
 * form under the navigation bar, saved from the toolbar check.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { Button, ConfirmationDialog, Form, Host, LabeledContent, Menu, RNHostView, Section, Text, TextField, Toggle } from '@expo/ui/swift-ui'
import {
  lineLimit,
  scrollDismissesKeyboard,
  submitLabel,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import { hapticSelect } from '../../lib/haptics'
import { modelSections } from '../../lib/chatModels'
import type {
  Computer,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { useTheme } from '../../hooks/useTheme'
import { useSwitchTint } from '../../lib/nativeControls'
import { useAppSession } from '../../contexts/AppSessionContext'
import type { Theme } from '../../constants/theme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useMode } from '../../contexts/ModeContext'
import { FeatureGate } from '../ui/FeatureGate'
import { CreatureEmpty } from '../creatures/CreatureEmpty'
import { AgentAvatar } from '../shell/AgentAvatar'
import { AgentComputerPanel } from './AgentComputerPreview'
import { getRequestWorkspaceId } from '../../services/appApi'
import {
  archiveAgent,
  createAgent,
  destroyAgentComputer,
  getAgent,
  listAgentComputers,
  openAgentChat,
  provisionAgentComputer,
  updateAgent,
} from '../../services/agentsService'
import {
  CREATURE_COLORS,
  CREATURE_SHAPES,
  DEFAULT_AGENT_AVATAR_COLOR,
} from '../../lib/agentCreature'
import {
  AGENT_TOOL_GROUPS,
  DEFAULT_AGENT_TOOL_GROUP_IDS,
  enabledAgentToolGroupIds,
} from '../../lib/agentToolGroups'
import {
  agentSaveErrorMessage,
  buildWorkspaceAgentInput,
  buildWorkspaceAgentUpdateInput,
  isAgentEditorValid,
  isDefaultMasterAgent,
} from '../../lib/agentEditorInput'

export function AgentEditorScreen({ agentId }: { agentId: string }): React.ReactElement {
  const { theme, isDark } = useTheme()
  const router = useRouter()
  const { capabilities, chatModels, uiSettings, isFeatureEnabled } = useAppSession()
  const { activeWorkspaceId } = useWorkspace()
  const workspaceId = activeWorkspaceId ?? ''
  const isNew = agentId === 'new'

  const switchTint = useSwitchTint()
  const [agent, setAgent] = useState<WorkspaceAgentDirectoryItem | null>(null)
  const [editable, setEditable] = useState(isNew)
  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('You are a helpful assistant.')
  const [modelId, setModelId] = useState('')
  const [avatarColor, setAvatarColor] = useState<string>(DEFAULT_AGENT_AVATAR_COLOR)
  const [avatarShape, setAvatarShape] = useState<WorkspaceAgentCreatureShape>('circle')
  // New agents belong to the mode they are made in (only you in Personal).
  const { mode } = useMode()
  const [visibility, setVisibility] = useState<WorkspaceAgentVisibility>(mode === 'personal' ? 'creator' : 'workspace')
  const [confirmMove, setConfirmMove] = useState(false)
  const [enabledToolGroups, setEnabledToolGroups] = useState<Set<string>>(new Set(DEFAULT_AGENT_TOOL_GROUP_IDS))

  // Agent computer (computer tool group ↔ persistent desktop)
  const [agentComputer, setAgentComputer] = useState<Computer | null>(null)

  // Bumped once an agent loads so the uncontrolled native fields pick up its values.
  const [loadedKey, setLoadedKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const computersAvailable = capabilities.computers
  const isMaster = isDefaultMasterAgent(agent)

  const sortedModels = useMemo(
    () => [...chatModels].sort((a, b) => b.intelligence - a.intelligence),
    [chatModels],
  )

  const toolGroups = useMemo(
    () => (computersAvailable ? AGENT_TOOL_GROUPS : AGENT_TOOL_GROUPS.filter((group) => group.id !== 'computer')),
    [computersAvailable],
  )

  // Default model for new agents: the app's configured default when present,
  // else the highest-intelligence model (bootstrap order is quality-sorted).
  const defaultModelId = useMemo(() => {
    const preferred = uiSettings.defaultActModelId
    if (preferred && sortedModels.some((model) => model.id === preferred)) return preferred
    const free = sortedModels.find((model) => model.cost === 0)
    return free?.id ?? sortedModels[0]?.id ?? ''
  }, [sortedModels, uiSettings.defaultActModelId])

  useEffect(() => {
    if (isNew) {
      setModelId((current) => current || defaultModelId)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void Promise.all([
      getAgent(workspaceId, agentId),
      computersAvailable ? listAgentComputers(workspaceId).catch(() => [] as Computer[]) : Promise.resolve([] as Computer[]),
    ]).then(([loaded, computers]) => {
      if (cancelled) return
      setAgent(loaded)
      setEditable(loaded.canEdit)
      setName(loaded.name)
      setDescription(loaded.description ?? '')
      setInstructions(loaded.instructions)
      setModelId(loaded.modelId)
      setAvatarColor(loaded.avatarColor ?? DEFAULT_AGENT_AVATAR_COLOR)
      setAvatarShape(loaded.avatarShape ?? 'circle')
      setVisibility(loaded.visibility)
      setEnabledToolGroups(enabledAgentToolGroupIds(loaded.allowedToolIds))
      setAgentComputer(
        computers.find((computer) => computer.ownerType === 'agent' && computer.ownerId === loaded.id) ?? null,
      )
      setLoadedKey((key) => key + 1)
    }).catch((nextError) => {
      if (!cancelled) {
        setLoadError(nextError instanceof Error ? nextError.message : 'Could not load this agent.')
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [agentId, computersAvailable, defaultModelId, isNew, workspaceId])

  const toggleToolGroup = useCallback((groupId: string) => {
    hapticSelect()
    setEnabledToolGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  const isValid = isAgentEditorValid({ name, instructions, modelId })

  const performSave = useCallback(async () => {
    const input = {
      ...buildWorkspaceAgentInput({
        name, description, instructions, modelId, avatarColor, avatarShape, enabledToolGroups, visibility,
      }),
      teamIds: agent?.teamIds ?? [],
    }

    let saved: WorkspaceAgentDirectoryItem
    if (isNew) {
      saved = await createAgent(workspaceId, input)
      if (computersAvailable && enabledToolGroups.has('computer')) {
        try {
          await provisionAgentComputer(workspaceId, saved.id, `${saved.name} computer`)
        } catch {
          router.replace({ pathname: '/agent/[id]', params: { id: saved.id } })
          return
        }
      }
    } else if (agent) {
      saved = await updateAgent(workspaceId, agent.id, buildWorkspaceAgentUpdateInput(
        input, agent.avatarColor ?? DEFAULT_AGENT_AVATAR_COLOR,
      ))
      if (computersAvailable) {
        if (enabledToolGroups.has('computer') && (!agentComputer || agentComputer.status === 'error')) {
          await provisionAgentComputer(workspaceId, saved.id, `${saved.name} computer`)
        } else if (!enabledToolGroups.has('computer') && agentComputer) {
          await destroyAgentComputer(workspaceId, agentComputer.id)
        }
      }
    } else {
      return
    }
    if (getRequestWorkspaceId() === workspaceId) router.back()
  }, [
    agent, agentComputer, avatarColor, avatarShape, computersAvailable,
    description, enabledToolGroups, instructions, isNew, modelId,
    name, router, visibility, workspaceId,
  ])

  const save = useCallback(() => {
    if (!isValid || busy) return
    // Disabling the computer group destroys a provisioned machine — confirm first.
    if (agentComputer && !enabledToolGroups.has('computer')) {
      Alert.alert(
        `Delete ${agent?.name ?? 'this agent'}'s computer?`,
        'Its disk state is destroyed permanently.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete and save',
            style: 'destructive',
            onPress: () => {
              setBusy(true)
              setError(null)
              void performSave()
                .catch((nextError) => setError(agentSaveErrorMessage(nextError, 'Could not save agent.')))
                .finally(() => setBusy(false))
            },
          },
        ],
      )
      return
    }
    setBusy(true)
    setError(null)
    void performSave()
      .catch((nextError) => setError(agentSaveErrorMessage(nextError, 'Could not save agent.')))
      .finally(() => setBusy(false))
  }, [agent?.name, agentComputer, busy, enabledToolGroups, isValid, performSave])

  // One-way move: an only-me agent becomes a workspace agent, never the reverse.
  const moveToWorkspace = useCallback(() => {
    if (!agent || busy) return
    setBusy(true)
    setError(null)
    void updateAgent(workspaceId, agent.id, { visibility: 'workspace' })
      .then((saved) => {
        setAgent((current) => (current ? { ...current, ...saved } : current))
        setVisibility('workspace')
      })
      .catch((nextError) => setError(agentSaveErrorMessage(nextError, 'Could not move this agent to the workspace.')))
      .finally(() => setBusy(false))
  }, [agent, busy, workspaceId])

  const confirmArchive = useCallback(() => {
    if (!agent) return
    Alert.alert(
      `Archive ${agent.name}?`,
      'It stops appearing in the roster and can\'t be chatted with.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            setBusy(true)
            void archiveAgent(workspaceId, agent.id)
              .then(() => router.dismissTo('/(tabs)/agents'))
              .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Archive failed.'))
              .finally(() => setBusy(false))
          },
        },
      ],
    )
  }, [agent, router, workspaceId])

  const startChat = useCallback(async () => {
    if (!agent || chatBusy) return
    setChatBusy(true)
    try {
      const conversationId = await openAgentChat(workspaceId, agent)
      router.push({ pathname: '/chat/[id]', params: { id: conversationId } })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not open a chat with this agent.')
    } finally {
      setChatBusy(false)
    }
  }, [agent, chatBusy, router, workspaceId])

  if (!isFeatureEnabled('agents')) {
    return <FeatureGate title="Agents are turned off" />
  }

  const title = isNew ? 'New agent' : 'Edit agent'
  const screenOptions = <Stack.Screen options={{ title, headerLargeTitle: false }} />

  if (loading) {
    return (
      <>
        {screenOptions}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
          <ActivityIndicator color={theme.muted as string} />
        </View>
      </>
    )
  }

  if (loadError) {
    return (
      <>
        {screenOptions}
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={{ flexGrow: 1 }}>
          <CreatureEmpty title="Agent unavailable" detail={loadError} shape="cloud" color="#64748b" />
        </ScrollView>
      </>
    )
  }

  const selectedModel = sortedModels.find((model) => model.id === modelId)
  const computerPreview = computersAvailable && workspaceId === agentComputer?.workspaceId &&
    agentComputer.ownerType === 'agent' && agentComputer.ownerId === agent?.id
    ? <AgentComputerPanel key={agentComputer.id} computer={agentComputer} theme={theme} canManage={editable} onChange={setAgentComputer} />
    : null

  if (!isNew && !editable) {
    return (
      <>
        {screenOptions}
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={{ flexGrow: 1 }}>
          <CreatureEmpty
            title="This agent is read-only"
            detail="Only people with edit access can change this agent."
            shape={avatarShape}
            color={avatarColor}
          />
          {computerPreview ? <View style={{ padding: 16 }}>{computerPreview}</View> : null}
        </ScrollView>
      </>
    )
  }

  // Provider groups ordered by each provider's best model, with display names (shared with the chat picker).
  const providerSections = modelSections(sortedModels, [])
  const fieldModifiers = [textInputAutocapitalization('sentences')]
  const canSave = isValid && !busy && editable
  // Chiefs keep their place; only an only-me agent you can edit may move, and only to the workspace.
  const canMove = Boolean(
    !isNew && agent && editable && visibility === 'creator' &&
      agent.agentRole !== 'personal_chief' && agent.agentRole !== 'workspace_chief',
  )

  return (
    <>
      {screenOptions}
      <Stack.Toolbar placement="right">
        {!isNew && agent ? (
          <Stack.Toolbar.Button
            icon="bubble.left"
            accessibilityLabel={`Chat with ${agent.name}`}
            disabled={chatBusy}
            onPress={() => void startChat()}
          />
        ) : null}
        <Stack.Toolbar.Button
          icon="checkmark"
          variant="prominent"
          tintColor={theme.foreground as string}
          accessibilityLabel={isNew ? 'Create agent' : 'Save agent'}
          disabled={!canSave}
          onPress={save}
        />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string), scrollDismissesKeyboard('interactively')]}>
          <Section>
            <RNHostView matchContents>
              <AppearancePicker
                theme={theme}
                dark={isDark}
                name={name}
                shape={avatarShape}
                color={avatarColor}
                isDefault={Boolean(agent?.isDefault)}
                onShape={(shape) => {
                  hapticSelect()
                  setAvatarShape(shape)
                }}
                onColor={(color) => {
                  hapticSelect()
                  setAvatarColor(color)
                }}
              />
            </RNHostView>
          </Section>

          <Section title="Name">
            <TextField
              key={`name:${loadedKey}`}
              defaultValue={name}
              placeholder="Research assistant"
              onValueChange={setName}
              modifiers={[...fieldModifiers, submitLabel('done')]}
            />
          </Section>

          <Section title="What it helps with">
            <TextField
              key={`description:${loadedKey}`}
              defaultValue={description}
              placeholder="Plan trips, triage email, or keep an eye on a project."
              axis="vertical"
              onValueChange={setDescription}
              modifiers={[...fieldModifiers, lineLimit({ min: 2, max: 5 })]}
            />
          </Section>

          <Section title="Model">
            <Menu label={selectedModel?.name ?? 'Choose a model'}>
              {providerSections.map((section) => (
                <Menu key={section.id} label={section.label}>
                  {section.models
                    .map((model) => (
                      <Button
                        key={model.id}
                        label={model.name}
                        systemImage={model.id === modelId ? 'checkmark' : undefined}
                        onPress={() => {
                          hapticSelect()
                          setModelId(model.id)
                        }}
                      />
                    ))}
                </Menu>
              ))}
            </Menu>
          </Section>

          <Section title="Instructions" footer={<Text>How the agent should behave, what it owns and how it replies.</Text>}>
            <TextField
              key={`instructions:${loadedKey}`}
              defaultValue={instructions}
              placeholder="You are a helpful assistant."
              axis="vertical"
              onValueChange={setInstructions}
              modifiers={[...fieldModifiers, lineLimit({ min: 4, max: 12 })]}
            />
          </Section>

          <Section
            title="Tools"
            footer={computersAvailable && enabledToolGroups.has('computer') && !agentComputer
              ? <Text>A cloud computer is set up for this agent when you save.</Text>
              : undefined}
          >
            {toolGroups.map((group) => (
              <Toggle
                modifiers={switchTint}
                key={group.id}
                label={group.label}
                isOn={enabledToolGroups.has(group.id)}
                onIsOnChange={() => toggleToolGroup(group.id)}
              />
            ))}
          </Section>

          {computerPreview ? (
            <Section title="Computer">
              <RNHostView matchContents>
                <View style={{ paddingVertical: 4 }}>{computerPreview}</View>
              </RNHostView>
            </Section>
          ) : null}

          <Section
            title="Who can use it"
            footer={visibility === 'creator'
              ? <Text>Only you can use this agent. Moving it to the workspace lets everyone use it, and it can’t move back.</Text>
              : undefined}
          >
            <LabeledContent label="Access">
              <Text>{visibility === 'creator' ? 'Only me' : 'Workspace'}</Text>
            </LabeledContent>
            {canMove ? (
              <ConfirmationDialog
                title="Move to workspace?"
                titleVisibility="visible"
                isPresented={confirmMove}
                onIsPresentedChange={setConfirmMove}
              >
                <ConfirmationDialog.Trigger>
                  <Button label="Move to workspace" systemImage="arrow.up.right.square" onPress={() => setConfirmMove(true)} />
                </ConfirmationDialog.Trigger>
                <ConfirmationDialog.Actions>
                  <Button label="Move to workspace" onPress={moveToWorkspace} />
                </ConfirmationDialog.Actions>
                <ConfirmationDialog.Message>
                  <Text>Everyone in the workspace will be able to use it. You can’t move it back to Personal.</Text>
                </ConfirmationDialog.Message>
              </ConfirmationDialog>
            ) : null}
          </Section>

          {error ? (
            <Section>
              <Text>{error}</Text>
            </Section>
          ) : null}

          {!isNew && agent && !isMaster ? (
            <Section>
              <Button role="destructive" label="Archive agent" onPress={confirmArchive} />
            </Section>
          ) : null}
        </Form>
      </Host>
    </>
  )
}

/** Live creature preview with shape and color choices, hosted inside the form. */
function AppearancePicker({
  theme,
  dark,
  name,
  shape,
  color,
  isDefault,
  onShape,
  onColor,
}: {
  theme: Theme
  dark: boolean
  name: string
  shape: WorkspaceAgentCreatureShape
  color: string
  isDefault: boolean
  onShape: (shape: WorkspaceAgentCreatureShape) => void
  onColor: (color: string) => void
}): React.ReactElement {
  const agent = { name: name || 'Agent', isDefault, avatarShape: shape, avatarColor: color }
  // The hosted view doesn't inherit the card's width: size it to the inset
  // grouped card (20pt margins, 16pt row padding) so rows wrap evenly.
  const { width: screen } = useWindowDimensions()
  const width = Math.min(screen, 700) - 66
  const half = <T,>(items: readonly T[]) => [items.slice(0, Math.ceil(items.length / 2)), items.slice(Math.ceil(items.length / 2))]
  return (
    <View style={{ width, alignItems: 'center', gap: 16, paddingVertical: 12 }}>
      <AgentAvatar agent={agent} dark={dark} foreground={theme.foreground} size={96} working />
      {isDefault ? null : (
        <>
          {half(CREATURE_SHAPES).map((row, index) => (
          <View key={index} style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
            {row.map((option) => {
              const selected = option === shape
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityLabel={`${option} shape`}
                  accessibilityState={{ selected }}
                  onPress={() => onShape(option)}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: selected ? theme.foreground : 'transparent',
                  }}
                >
                  <AgentAvatar agent={{ name: option, avatarShape: option, avatarColor: color }} dark={dark} foreground={theme.foreground} size={30} />
                </Pressable>
              )
            })}
          </View>
          ))}
          {half(CREATURE_COLORS).map((row, index) => (
          <View key={`c${index}`} style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            {row.map((option) => {
              const selected = option === color
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityLabel={`Color ${option}`}
                  accessibilityState={{ selected }}
                  onPress={() => onColor(option)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: selected ? theme.foreground : 'transparent',
                  }}
                >
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: option, borderWidth: 0.5, borderColor: theme.border }} />
                </Pressable>
              )
            })}
          </View>
          ))}
        </>
      )}
    </View>
  )
}
