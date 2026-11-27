import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { borderRadius, fontSize, spacing, type Theme } from '../../constants/theme'
import { BottomSheet } from '../ui/AppChrome'
import {
  COMPUTER_SIZES,
  destroyComputer,
  listComputers,
  openComputerDesktop,
  provisionComputer,
  startComputer,
  stopComputer,
  type Computer,
  type ComputerOwnerType,
  type ComputerSize,
} from '../../services/computersService'
import { listAgents } from '../../services/agentsService'
import { SettingsSection, settingsStyles } from './primitives'

/**
 * Computers settings section — parity of web `ComputerSettings`: persistent
 * cloud desktops for the user and their agents. "Open desktop" mints a
 * short-lived stream ticket and opens it in the in-app browser; the ticket
 * URL is a bearer secret and is never logged or stored.
 */

const STATUS_COLORS: Record<string, string> = {
  ready: '#22C55E',
  provisioning: '#F59E0B',
  stopped: '#94A3B8',
  error: '#EF4444',
}

export function ComputersSection({
  theme,
  workspaceId,
  userId,
}: {
  theme: Theme
  workspaceId: string
  userId: string | null
}): React.ReactElement {
  const [computers, setComputers] = useState<Computer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [provisionOpen, setProvisionOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      setComputers(await listComputers(workspaceId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Computer list unavailable')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function runAction(computer: Computer, action: 'start' | 'stop' | 'desktop' | 'destroy'): Promise<void> {
    if (busyId) return
    setBusyId(computer.id)
    try {
      if (action === 'start') await startComputer(workspaceId, computer.id)
      else if (action === 'stop') await stopComputer(workspaceId, computer.id)
      else if (action === 'destroy') {
        await destroyComputer(workspaceId, computer.id)
      } else {
        const ticket = await openComputerDesktop(workspaceId, computer.id)
        await WebBrowser.openBrowserAsync(ticket.url)
      }
      await refresh()
    } catch (err) {
      Alert.alert('Computer action failed', err instanceof Error ? err.message : 'Try again.')
    } finally {
      setBusyId(null)
    }
  }

  function confirmDestroy(computer: Computer): void {
    Alert.alert(
      'Destroy computer',
      `Permanently destroy ${computer.name ?? computer.id}? Its cloud machine is deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Destroy', style: 'destructive', onPress: () => void runAction(computer, 'destroy') },
      ],
    )
  }

  return (
    <>
      <SettingsSection
        theme={theme}
        title="Computers"
        icon="monitor"
        accessory={
          <TouchableOpacity onPress={() => setProvisionOpen(true)} hitSlop={8}>
            <Feather name="plus" size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        }
      >
        {loading && computers === null ? (
          <ActivityIndicator size="small" color={theme.textSecondary} />
        ) : error ? (
          <Text style={[settingsStyles.helperText, { color: '#EF4444' }]}>{error}</Text>
        ) : (computers ?? []).length === 0 ? (
          <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
            No computers. Provision a persistent cloud desktop for yourself or an agent.
          </Text>
        ) : (
          (computers ?? []).map((computer) => (
            <ComputerRow
              key={computer.id}
              theme={theme}
              computer={computer}
              busy={busyId === computer.id}
              onAction={(action) =>
                action === 'destroy' ? confirmDestroy(computer) : void runAction(computer, action)
              }
            />
          ))
        )}
      </SettingsSection>

      <ProvisionComputerSheet
        theme={theme}
        visible={provisionOpen}
        workspaceId={workspaceId}
        userId={userId}
        onClose={() => setProvisionOpen(false)}
        onCreated={() => {
          setProvisionOpen(false)
          void refresh()
        }}
      />
    </>
  )
}

function ComputerRow({
  theme,
  computer,
  busy,
  onAction,
}: {
  theme: Theme
  computer: Computer
  busy: boolean
  onAction: (action: 'start' | 'stop' | 'desktop' | 'destroy') => void
}): React.ReactElement {
  const [actionsOpen, setActionsOpen] = useState(false)
  return (
    <>
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={() => setActionsOpen(true)}
        style={[settingsStyles.row, { borderColor: theme.border }]}
      >
        <View
          style={[
            localStyles.statusDot,
            { backgroundColor: STATUS_COLORS[computer.status] ?? theme.textSecondary },
          ]}
        />
        <View style={settingsStyles.rowCopy}>
          <Text style={[settingsStyles.rowTitle, { color: theme.text }]} numberOfLines={1}>
            {computer.name ?? `${computer.ownerType} desktop`}
          </Text>
          <Text style={[settingsStyles.rowDetail, { color: theme.textSecondary }]} numberOfLines={1}>
            {computer.ownerType} · {computer.size} · {computer.status}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={theme.textSecondary} />
        ) : (
          <Feather name="chevron-right" size={16} color={theme.textSecondary} />
        )}
      </TouchableOpacity>

      <BottomSheet
        theme={theme}
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={computer.name ?? 'Computer'}
      >
        <View style={localStyles.actions}>
          {computer.status === 'ready' ? (
            <ActionButton theme={theme} icon="external-link" title="Open desktop" detail="Stream the desktop in the in-app browser." onPress={() => { setActionsOpen(false); onAction('desktop') }} />
          ) : null}
          {computer.status === 'stopped' || computer.status === 'error' ? (
            <ActionButton theme={theme} icon="play" title="Start" detail="Boot the machine." onPress={() => { setActionsOpen(false); onAction('start') }} />
          ) : null}
          {computer.status === 'ready' ? (
            <ActionButton theme={theme} icon="square" title="Stop" detail="Shut down; the machine and its disk persist." onPress={() => { setActionsOpen(false); onAction('stop') }} />
          ) : null}
          <ActionButton theme={theme} icon="trash-2" title="Destroy" detail="Delete the machine and its disk permanently." destructive onPress={() => { setActionsOpen(false); onAction('destroy') }} />
        </View>
      </BottomSheet>
    </>
  )
}

function ActionButton({
  theme,
  icon,
  title,
  detail,
  destructive,
  onPress,
}: {
  theme: Theme
  icon: keyof typeof Feather.glyphMap
  title: string
  detail: string
  destructive?: boolean
  onPress: () => void
}): React.ReactElement {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      style={[settingsStyles.row, { borderColor: theme.border }]}
    >
      <Feather name={icon} size={16} color={destructive ? '#EF4444' : theme.textSecondary} />
      <View style={settingsStyles.rowCopy}>
        <Text style={[settingsStyles.rowTitle, { color: destructive ? '#EF4444' : theme.text }]}>{title}</Text>
        <Text style={[settingsStyles.rowDetail, { color: theme.textSecondary }]}>{detail}</Text>
      </View>
    </TouchableOpacity>
  )
}

function ProvisionComputerSheet({
  theme,
  visible,
  workspaceId,
  userId,
  onClose,
  onCreated,
}: {
  theme: Theme
  visible: boolean
  workspaceId: string
  userId: string | null
  onClose: () => void
  onCreated: () => void
}): React.ReactElement {
  const [ownerType, setOwnerType] = useState<ComputerOwnerType>('user')
  const [agentId, setAgentId] = useState<string | null>(null)
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [size, setSize] = useState<ComputerSize>('default')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!visible) return
    setOwnerType('user')
    setAgentId(null)
    setSize('default')
    setName('')
    void listAgents(workspaceId)
      .then((response) =>
        setAgents(
          (response.agents ?? [])
            .filter((agent) => !agent.archivedAt)
            .map((agent) => ({ id: agent.id, name: agent.name })),
        ),
      )
      .catch(() => setAgents([]))
  }, [visible, workspaceId])

  const canProvision =
    !busy && (ownerType === 'user' ? !!userId : !!agentId)

  async function provision(): Promise<void> {
    const ownerId = ownerType === 'user' ? userId : agentId
    if (!ownerId) return
    setBusy(true)
    try {
      await provisionComputer(workspaceId, {
        ownerType,
        ownerId,
        size,
        ...(name.trim() ? { name: name.trim() } : {}),
      })
      onCreated()
    } catch (err) {
      Alert.alert('Could not provision', err instanceof Error ? err.message : 'Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet theme={theme} visible={visible} onClose={onClose} title="New computer">
      <View style={localStyles.sheetBody}>
        <Text style={[settingsStyles.fieldLabel, { color: theme.textSecondary }]}>Owner</Text>
        <View style={localStyles.chipRow}>
          {(['user', 'agent'] as const).map((option) => (
            <Chip
              key={option}
              theme={theme}
              label={option === 'user' ? 'Me' : 'Agent'}
              active={ownerType === option}
              onPress={() => setOwnerType(option)}
            />
          ))}
        </View>
        {ownerType === 'agent' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={localStyles.chipRow}>
            {agents.length === 0 ? (
              <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
                No agents in this workspace yet.
              </Text>
            ) : (
              agents.map((agent) => (
                <Chip
                  key={agent.id}
                  theme={theme}
                  label={agent.name}
                  active={agentId === agent.id}
                  onPress={() => setAgentId(agent.id)}
                />
              ))
            )}
          </ScrollView>
        ) : null}
        <Text style={[settingsStyles.fieldLabel, { color: theme.textSecondary }]}>Size</Text>
        <View style={localStyles.chipRow}>
          {COMPUTER_SIZES.map((option) => (
            <Chip
              key={option}
              theme={theme}
              label={option}
              active={size === option}
              onPress={() => setSize(option)}
            />
          ))}
        </View>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name (optional)"
          placeholderTextColor={theme.textSecondary}
          style={[localStyles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
        />
        <TouchableOpacity
          activeOpacity={0.82}
          onPress={() => void provision()}
          disabled={!canProvision}
          style={[localStyles.button, { backgroundColor: theme.foreground, opacity: canProvision ? 1 : 0.5 }]}
        >
          <Text style={[localStyles.buttonText, { color: theme.background }]}>
            {busy ? 'Provisioning…' : 'Provision computer'}
          </Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  )
}

function Chip({
  theme,
  label,
  active,
  onPress,
}: {
  theme: Theme
  label: string
  active: boolean
  onPress: () => void
}): React.ReactElement {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      style={[
        localStyles.chip,
        {
          borderColor: active ? theme.foreground : theme.border,
          backgroundColor: active ? theme.surfaceSubtle : theme.surfaceElevated,
        },
      ]}
    >
      <Text style={[localStyles.chipLabel, { color: active ? theme.text : theme.textSecondary }]}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

const localStyles = StyleSheet.create({
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: borderRadius.full,
  },
  actions: {
    gap: 0,
  },
  sheetBody: {
    gap: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
  },
  button: {
    minHeight: 42,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  buttonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
})
