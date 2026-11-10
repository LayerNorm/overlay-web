/**
 * Agent editor — create/edit an agent as a pushed screen.
 *
 * Mirrors web `AgentEditorPage` semantics: overlay vs BYO type, tool-group
 * grants (capability grant ids), creature avatar, model + instructions,
 * visibility, environment binding upsert/disable, and agent-computer
 * provision/destroy on save. Layout is native — grouped fields, radio rows,
 * bottom-sheet pickers — not the web form grid.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { hapticSelect } from '../../lib/haptics'
import type { ChatModel } from '@overlay/app-core'
import type {
  Computer,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { useTheme } from '../../hooks/useTheme'
import { useAppSession } from '../../contexts/AppSessionContext'
import type { Theme } from '../../constants/theme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { BottomSheet, EmptyState, SegmentedControl, TopBarIconButton } from '../ui/AppChrome'
import { FeatureGate } from '../ui/FeatureGate'
import { ListRow, Section } from '../ui/primitives'
import { AppIcon } from '../ui/AppIcon'
import { AgentCreature } from './AgentCreature'
import { AgentEditorView } from './AgentEditorView'
import { getRequestWorkspaceId } from '../../services/appApi'
import { ConnectMachineSheet } from './ConnectMachineSheet'
import {
  archiveAgent,
  createAgent,
  destroyAgentComputer,
  disableAgentBindings,
  getAgent,
  listAgentBindings,
  listAgentComputers,
  listAgentEnvironments,
  openAgentChat,
  provisionAgentComputer,
  updateAgent,
  upsertAgentBinding,
  type AgentEnvironmentItem,
} from '../../services/agentsService'
import {
  AGENT_AVATAR_COLORS,
  CREATURE_SHAPES,
  DEFAULT_AGENT_AVATAR_COLOR,
} from '../../lib/agentCreature'
import {
  AGENT_TOOL_GROUPS,
  DEFAULT_AGENT_TOOL_GROUP_IDS,
  enabledAgentToolGroupIds,
} from '../../lib/agentToolGroups'
import {
  availableByoHarnesses,
  buildWorkspaceAgentInput,
  defaultWorkingDirectory,
  environmentSupportsHarness,
  isAgentEditorValid,
  isDefaultMasterAgent,
  workspaceAgentUsesByo,
} from '../../lib/agentByo'

type AgentType = 'overlay' | 'byo'

export function AgentEditorScreen({ agentId }: { agentId: string }): React.ReactElement {
  const { theme, isDark } = useTheme()
  const router = useRouter()
  const { capabilities, chatModels, uiSettings, isFeatureEnabled } = useAppSession()
  const { activeWorkspaceId } = useWorkspace()
  const workspaceId = activeWorkspaceId ?? ''
  const isNew = agentId === 'new'

  const [agent, setAgent] = useState<WorkspaceAgentDirectoryItem | null>(null)
  const [advanced, setAdvanced] = useState(false)
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
  const [visibility, setVisibility] = useState<WorkspaceAgentVisibility>('workspace')
  const [enabledToolGroups, setEnabledToolGroups] = useState<Set<string>>(new Set(DEFAULT_AGENT_TOOL_GROUP_IDS))
  const [agentType, setAgentType] = useState<AgentType>('overlay')

  // BYO state
  const [environments, setEnvironments] = useState<AgentEnvironmentItem[]>([])
  const [environmentId, setEnvironmentId] = useState('')
  const [adapterId, setAdapterId] = useState('codex')
  const [workingDirectory, setWorkingDirectory] = useState('')
  const [connectOpen, setConnectOpen] = useState(false)

  // Agent computer (computer tool group ↔ persistent desktop)
  const [agentComputer, setAgentComputer] = useState<Computer | null>(null)

  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connectedAgentsEnabled = capabilities.connectedAgents
  const computersAvailable = capabilities.computers
  const isMaster = isDefaultMasterAgent(agent)

  const sortedModels = useMemo(
    () => [...chatModels].sort((a, b) => b.intelligence - a.intelligence),
    [chatModels],
  )

  const harnessOptions = useMemo(() => availableByoHarnesses(environments), [environments])
  const compatibleEnvironments = useMemo(
    () => environments.filter((environment) => (
      environment.status !== 'pending'
        && environment.status !== 'revoked'
        && environmentSupportsHarness(environment, adapterId)
    )),
    [adapterId, environments],
  )
  const bindingValid = Boolean(environmentId && ['codex', 'claude-code'].includes(adapterId) && workingDirectory.trim())

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
      connectedAgentsEnabled
        ? Promise.all([
            listAgentEnvironments(workspaceId),
            listAgentBindings(workspaceId, agentId),
          ])
        : Promise.resolve(null),
      computersAvailable ? listAgentComputers(workspaceId).catch(() => [] as Computer[]) : Promise.resolve([] as Computer[]),
    ]).then(([loaded, byo, computers]) => {
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
      if (byo) {
        const [envList, bindings] = byo
        setEnvironments(envList)
        const binding = bindings[0]
        if (binding && workspaceAgentUsesByo(loaded)) {
          setAgentType('byo')
          setEnvironmentId(binding.environmentId)
          const bindingAdapterId = typeof binding.adapterConfig.adapterId === 'string'
            ? binding.adapterConfig.adapterId
            : 'codex'
          setAdapterId(bindingAdapterId)
          setWorkingDirectory(typeof binding.adapterConfig.workingDirectory === 'string'
            ? binding.adapterConfig.workingDirectory
            : '')
        }
      } else if (workspaceAgentUsesByo(loaded)) {
        setAgentType('byo')
      }
      setAgentComputer(
        computers.find((computer) => computer.ownerType === 'agent' && computer.ownerId === loaded.id) ?? null,
      )
    }).catch((nextError) => {
      if (!cancelled) {
        setLoadError(nextError instanceof Error ? nextError.message : 'Could not load this agent.')
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [agentId, computersAvailable, connectedAgentsEnabled, defaultModelId, isNew, workspaceId])

  // Keep the environment list fresh while editing a BYO agent.
  const refreshEnvironments = useCallback(async () => {
    try {
      setEnvironments(await listAgentEnvironments(workspaceId))
    } catch {
      // Non-blocking; the picker shows whatever loaded last.
    }
  }, [workspaceId])

  const chooseEnvironment = useCallback((nextId: string) => {
    setEnvironmentId(nextId)
    setWorkingDirectory(defaultWorkingDirectory(environments.find((env) => env.id === nextId)))
  }, [environments])

  const toggleToolGroup = useCallback((groupId: string) => {
    hapticSelect()
    setEnabledToolGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  const isValid = isAgentEditorValid({
    name,
    instructions,
    modelId,
    agentType,
    connectedAgentsEnabled,
    bindingValid,
  })

  const performSave = useCallback(async () => {
    const input = {
      ...buildWorkspaceAgentInput({
        name, description, instructions, agentType,
        harnessLabel: harnessOptions.find((harness) => harness.id === adapterId)?.label ?? adapterId,
        adapterId, modelId, avatarColor, avatarShape, enabledToolGroups, visibility,
      }),
      teamIds: agent?.teamIds ?? [],
    }

    let saved: WorkspaceAgentDirectoryItem
    if (isNew) {
      saved = await createAgent(workspaceId, input)
      if (agentType === 'byo') {
        try {
          await upsertAgentBinding(workspaceId, {
            agentId: saved.id, environmentId, adapterId, workingDirectory: workingDirectory.trim(),
          })
        } catch {
          // Agent identity is durable — land on the new agent's editor so a
          // retry never creates a duplicate (web parity).
          router.replace({ pathname: '/agent/[id]', params: { id: saved.id } })
          return
        }
      }
      if (agentType === 'overlay' && computersAvailable && enabledToolGroups.has('computer')) {
        try {
          await provisionAgentComputer(workspaceId, saved.id, `${saved.name} computer`)
        } catch {
          router.replace({ pathname: '/agent/[id]', params: { id: saved.id } })
          return
        }
      }
    } else if (agent) {
      saved = await updateAgent(workspaceId, agent.id, input)
      if (agentType === 'byo') {
        await upsertAgentBinding(workspaceId, {
          agentId: saved.id, environmentId, adapterId, workingDirectory: workingDirectory.trim(),
        })
      } else if (workspaceAgentUsesByo(agent)) {
        await disableAgentBindings(workspaceId, saved.id).catch(() => undefined)
      }
      if (agentType === 'overlay' && computersAvailable) {
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
    adapterId, agent, agentComputer, agentType, avatarColor, avatarShape, computersAvailable,
    description, enabledToolGroups, environmentId, harnessOptions, instructions, isNew, modelId,
    name, router, visibility, workingDirectory, workspaceId,
  ])

  const save = useCallback(() => {
    if (!isValid || busy) return
    // Disabling the computer group destroys a provisioned machine — confirm first.
    if (agentType === 'overlay' && agentComputer && !enabledToolGroups.has('computer')) {
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
                .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Could not save agent.'))
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
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Could not save agent.'))
      .finally(() => setBusy(false))
  }, [agent?.name, agentComputer, agentType, busy, enabledToolGroups, isValid, performSave])

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
              .then(() => router.back())
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

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.textSecondary} style={styles.centered} />
      </SafeAreaView>
    )
  }

  if (loadError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        <View style={styles.navRow}>
          <TopBarIconButton theme={theme} icon="arrow-left" onPress={() => router.back()} />
        </View>
        <EmptyState theme={theme} icon="alert-circle" title="Agent unavailable" description={loadError} />
      </SafeAreaView>
    )
  }

  const selectedModel = sortedModels.find((model) => model.id === modelId)

  if (!isNew && !editable) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.surface }} edges={['top', 'bottom']}>
      <View style={styles.navRow}>
        <TopBarIconButton theme={theme} icon="arrow-left" onPress={() => router.back()} />
      </View>
      <EmptyState theme={theme} icon="lock" title="This agent is read-only" description="Only people with edit access can change this agent." />
    </SafeAreaView>
  )

  if (!advanced && agentType === 'overlay') return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.surface }} edges={['top', 'bottom']}>
      <AgentEditorView theme={theme} dark={isDark} agent={{ id: agent?.id ?? 'new', name, isDefault: agent?.isDefault, avatarColor, avatarShape }} name={name} description={description} modelId={modelId} models={sortedModels} groups={toolGroups.filter(group => ['web_search', 'knowledge', 'computer'].includes(group.id))} enabled={enabledToolGroups} onName={setName} onDescription={setDescription} onModel={setModelId} onToggle={toggleToolGroup} onAdvanced={() => setAdvanced(true)} onSave={save} onBack={() => router.back()} busy={busy || !editable} valid={isValid && editable} error={error} isNew={isNew} />
    </SafeAreaView>
  )

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <View style={[styles.navRow, { paddingHorizontal: spacing.md }]}>
        <TopBarIconButton theme={theme} icon="arrow-left" onPress={() => router.back()} />
        <Text style={[styles.navTitle, { color: theme.text }]} numberOfLines={1}>
          {isNew ? 'New agent' : agent?.name ?? 'Agent'}
        </Text>
        <View style={styles.navRight}>
          {!isNew && agent ? (
            <TouchableOpacity
              onPress={() => void startChat()}
              disabled={chatBusy}
              style={[styles.navIconButton, { backgroundColor: theme.surfaceSubtle }]}
              accessibilityRole="button"
              accessibilityLabel={`Chat with ${agent.name}`}
            >
              {chatBusy ? (
                <ActivityIndicator size="small" color={theme.textSecondary} />
              ) : (
                <AppIcon sfSymbol="bubble.left" featherIcon="message-circle" size={15} color={theme.text} />
              )}
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={save}
            disabled={!isValid || busy}
            style={[styles.saveButton, { backgroundColor: theme.foreground, opacity: !isValid || busy ? 0.45 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Save agent"
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.background} />
            ) : (
              <Text style={[styles.saveButtonText, { color: theme.background }]}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Live avatar preview */}
        <View style={styles.preview}>
          <AgentCreature shape={avatarShape} color={avatarColor} size={72} label={name || 'New agent'} />
          <Text style={[styles.previewName, { color: theme.text }]} numberOfLines={1}>
            {name.trim() || 'Untitled agent'}
          </Text>
        </View>

        {error ? (
          <View style={[styles.errorBanner, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
            <Text style={[styles.errorText, { color: '#EF4444' }]}>{error}</Text>
          </View>
        ) : null}

        <FieldCard theme={theme} label="Name">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Research assistant"
            placeholderTextColor={theme.textDisabled}
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            accessibilityLabel="Agent name"
          />
        </FieldCard>

        <FieldCard theme={theme} label="Description">
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="What this agent does for the workspace"
            placeholderTextColor={theme.textDisabled}
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            accessibilityLabel="Agent description"
          />
        </FieldCard>

        {/* Avatar */}
        <View style={styles.fieldBlock}>
          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Avatar</Text>
          <View style={styles.swatchRow}>
            {AGENT_AVATAR_COLORS.map((color) => {
              const active = avatarColor === color
              return (
                <TouchableOpacity
                  key={color}
                  onPress={() => setAvatarColor(color)}
                  style={[styles.swatch, { backgroundColor: color, borderColor: active ? theme.text : 'transparent' }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Avatar color ${color}`}
                  accessibilityState={{ selected: active }}
                />
              )
            })}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shapeRow}>
            {CREATURE_SHAPES.map((shape) => {
              const active = avatarShape === shape
              return (
                <TouchableOpacity
                  key={shape}
                  onPress={() => setAvatarShape(shape)}
                  style={[styles.shapeCell, { borderColor: active ? theme.text : theme.border, backgroundColor: active ? theme.surfaceSubtle : 'transparent' }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Shape ${shape}`}
                  accessibilityState={{ selected: active }}
                >
                  <AgentCreature shape={shape} color={avatarColor} size={34} label={shape} />
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </View>

        {/* Runtime type */}
        {!isMaster && connectedAgentsEnabled ? (
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Run on</Text>
            <SegmentedControl
              theme={theme}
              value={agentType}
              onChange={setAgentType}
              options={[
                { label: 'Overlay', value: 'overlay' },
                { label: 'Connected machine', value: 'byo' },
              ]}
            />
          </View>
        ) : null}

        {agentType === 'overlay' ? (
          <>
            {/* Model */}
            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Model</Text>
              <Section theme={theme}>
                <ListRow
                  theme={theme}
                  title={selectedModel?.name ?? 'Choose a model'}
                  subtitle={selectedModel?.provider}
                  icon="cpu"
                  iconSfSymbol="cpu"
                  showChevron
                  onPress={() => setModelPickerOpen(true)}
                />
              </Section>
            </View>

            <FieldCard theme={theme} label="Instructions">
              <TextInput
                value={instructions}
                onChangeText={setInstructions}
                placeholder="How this agent should behave, what it owns, and how it responds"
                placeholderTextColor={theme.textDisabled}
                multiline
                style={[styles.textArea, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                accessibilityLabel="Agent instructions"
              />
            </FieldCard>

            {/* Tool grants */}
            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Tools</Text>
              <Section theme={theme}>
                {toolGroups.map((group) => (
                  <View key={group.id} style={styles.toggleRow}>
                    <View style={styles.toggleBody}>
                      <Text style={[styles.toggleTitle, { color: theme.text }]}>{group.label}</Text>
                      <Text style={[styles.toggleDesc, { color: theme.textSecondary }]}>{group.description}</Text>
                    </View>
                    <Switch
                      value={enabledToolGroups.has(group.id)}
                      onValueChange={() => toggleToolGroup(group.id)}
                      trackColor={{ false: theme.toggleBg, true: theme.toggleBgActive }}
                      thumbColor={theme.toggleThumb}
                      accessibilityLabel={`${group.label} tool access`}
                    />
                  </View>
                ))}
              </Section>
              {computersAvailable && enabledToolGroups.has('computer') ? (
                <Text style={[styles.fieldHint, { color: theme.textSecondary }]}>
                  A persistent cloud desktop is provisioned for this agent on save.
                </Text>
              ) : null}
            </View>
          </>
        ) : (
          <>
            {/* BYO: harness → environment → working directory */}
            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Harness</Text>
              <Section theme={theme}>
                {harnessOptions.map((harness) => (
                  <ListRow
                    key={harness.id}
                    theme={theme}
                    title={harness.label}
                    subtitle={harness.description}
                    selected={adapterId === harness.id}
                    onPress={() => {
                      setAdapterId(harness.id)
                      const selected = environments.find((env) => env.id === environmentId)
                      if (selected && !environmentSupportsHarness(selected, harness.id)) {
                        setEnvironmentId('')
                        setWorkingDirectory('')
                      }
                    }}
                  />
                ))}
              </Section>
            </View>

            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Environment</Text>
              <Section theme={theme}>
                {compatibleEnvironments.map((environment) => (
                  <ListRow
                    key={environment.id}
                    theme={theme}
                    title={environment.name}
                    subtitle={`${environment.platform ?? environment.kind} · ${environment.status}`}
                    icon="server"
                    iconSfSymbol="server.rack"
                    selected={environmentId === environment.id}
                    onPress={() => chooseEnvironment(environment.id)}
                  />
                ))}
                <ListRow
                  theme={theme}
                  title="Connect a machine"
                  subtitle="Enroll a computer, VPS, or sandbox"
                  icon="plus"
                  iconSfSymbol="plus"
                  showChevron
                  onPress={() => setConnectOpen(true)}
                />
              </Section>
              {compatibleEnvironments.length === 0 ? (
                <Text style={[styles.fieldHint, { color: theme.textSecondary }]}>
                  No connected environment currently advertises this harness.
                </Text>
              ) : null}
            </View>

            <FieldCard theme={theme} label="Working directory">
              <TextInput
                value={workingDirectory}
                onChangeText={setWorkingDirectory}
                placeholder="/Users/you/Projects/app"
                placeholderTextColor={theme.textDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                accessibilityLabel="Working directory"
              />
              <Text style={[styles.fieldHint, { color: theme.textSecondary }]}>
                Must be inside the environment&apos;s approved roots. The environment may host other agents too.
              </Text>
            </FieldCard>
          </>
        )}

        {/* Visibility */}
        <View style={styles.fieldBlock}>
          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Access</Text>
          <Section theme={theme}>
            <ListRow
              theme={theme}
              title="Workspace"
              subtitle="Everyone in this workspace can see and chat with this agent"
              icon="users"
              iconSfSymbol="person.2"
              selected={visibility === 'workspace'}
              onPress={() => setVisibility('workspace')}
            />
            <ListRow
              theme={theme}
              title="Only me"
              subtitle="Private — other members can't see this agent"
              icon="lock"
              iconSfSymbol="lock"
              selected={visibility === 'creator'}
              onPress={() => setVisibility('creator')}
            />
          </Section>
        </View>

        {!isNew && agent && !isMaster ? (
          <View style={styles.fieldBlock}>
            <TouchableOpacity
              onPress={confirmArchive}
              disabled={busy}
              style={[styles.dangerButton, { borderColor: 'rgba(239,68,68,0.4)' }]}
              accessibilityRole="button"
            >
              <Text style={styles.dangerButtonText}>Archive agent</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>

      {/* Model picker */}
      <BottomSheet
        theme={theme}
        visible={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        title="Choose model"
      >
        <View style={styles.modelList}>
          {sortedModels.map((model) => (
            <ListRow
              key={model.id}
              theme={theme}
              title={model.name}
              subtitle={model.provider}
              selected={model.id === modelId}
              accessory={<ModelCapabilityChips theme={theme} model={model} />}
              onPress={() => {
                setModelId(model.id)
                setModelPickerOpen(false)
              }}
            />
          ))}
        </View>
      </BottomSheet>

      {/* BYO enrollment */}
      <ConnectMachineSheet
        theme={theme}
        visible={connectOpen}
        workspaceId={workspaceId}
        onClose={() => setConnectOpen(false)}
        onConnected={(environment) => {
          setConnectOpen(false)
          void refreshEnvironments()
          chooseEnvironment(environment.id)
        }}
      />
    </SafeAreaView>
  )
}

function FieldCard({
  theme,
  label,
  children,
}: {
  theme: Theme
  label: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text>
      {children}
    </View>
  )
}

function ModelCapabilityChips({ theme, model }: { theme: Theme; model: ChatModel }): React.ReactElement | null {
  if (!model.supportsVision && !model.supportsReasoning) return null
  return (
    <View style={styles.chipRow}>
      {model.supportsVision ? (
        <View style={[styles.chip, { backgroundColor: theme.surfaceSubtle }]}>
          <AppIcon sfSymbol="eye" featherIcon="eye" size={11} color={theme.textSecondary} />
        </View>
      ) : null}
      {model.supportsReasoning ? (
        <View style={[styles.chip, { backgroundColor: theme.surfaceSubtle }]}>
          <AppIcon sfSymbol="sparkles" featherIcon="star" size={11} color={theme.textSecondary} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  navTitle: { flex: 1, fontSize: fontSize.md, fontWeight: '600', textAlign: 'center' },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  navIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    minWidth: 56,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  saveButtonText: { fontSize: fontSize.sm, fontWeight: '700' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.lg },
  preview: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  previewName: { fontSize: fontSize.md, fontWeight: '600' },
  errorBanner: {
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  errorText: { fontSize: fontSize.sm },
  fieldBlock: { gap: spacing.sm },
  fieldLabel: { fontSize: fontSize.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldHint: { fontSize: fontSize.xs, lineHeight: 16 },
  input: {
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.md,
  },
  textArea: {
    minHeight: 120,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    fontSize: fontSize.sm,
    lineHeight: 19,
    textAlignVertical: 'top',
  },
  swatchRow: { flexDirection: 'row', gap: spacing.sm },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2.5,
  },
  shapeRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
  shapeCell: {
    width: 52,
    height: 52,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  toggleBody: { flex: 1, gap: 2 },
  toggleTitle: { fontSize: fontSize.md, fontWeight: '500' },
  toggleDesc: { fontSize: fontSize.xs, lineHeight: 16 },
  dangerButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dangerButtonText: { color: '#EF4444', fontSize: fontSize.sm, fontWeight: '600' },
  modelList: { paddingBottom: spacing.md },
  chipRow: { flexDirection: 'row', gap: 4 },
  chip: {
    width: 18,
    height: 18,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
