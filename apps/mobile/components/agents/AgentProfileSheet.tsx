import React, { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useTheme } from '../../hooks/useTheme'
import { useAppSession } from '../../contexts/AppSessionContext'
import { AgentAvatar } from '../shell/AgentAvatar'
import type { AgentComputer, AgentFiles, AgentRecord } from '../../services/agentThreadService'

type Row = {
  key: string
  symbol: string
  label: string
  value?: string
  destructive?: boolean
  onPress?: () => void
}

/**
 * Agent profile, presented as a native page sheet from the conversation
 * header: large creature, name, Edit, then grouped rows for the agent's
 * library, computer and the current thread.
 */
export function AgentProfileSheet({
  visible,
  agent,
  computer,
  computerError,
  files,
  archived,
  onFile,
  onEdit,
  onWeb,
  onNewThread,
  onArchive,
  onClose,
}: {
  visible: boolean
  agent: AgentRecord
  computer: AgentComputer | null | undefined
  computerError?: boolean
  files?: AgentFiles
  archived: boolean
  onFile: (file: NonNullable<AgentFiles>[number]) => void
  onEdit: () => void
  onWeb: () => void
  onNewThread: () => void
  onArchive: () => void
  onClose: () => void
}) {
  const { theme, isDark } = useTheme()
  const { chatModels } = useAppSession()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const modelName = chatModels.find((model) => model.id === agent.modelId)?.name ?? (agent.modelId || 'Auto')
  const computerValue = computerError
    ? 'Unavailable'
    : computer === undefined
      ? '…'
      : computer
        ? capitalize(computer.status)
        : 'None'
  const fileCount = files ? `${files.length}` : files === null ? '—' : '…'
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16 }}>
          <CircleButton symbol="xmark" label="Close" onPress={onClose} />
          <CircleButton symbol="safari" label="Open on web" onPress={onWeb} />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 26 }}>
          <View style={{ alignItems: 'center', gap: 12 }}>
            <AgentAvatar agent={agent} dark={isDark} foreground={theme.foreground} size={112} working />
            <Text selectable style={{ fontFamily: 'GeistSemibold', fontSize: 26, letterSpacing: -0.6, color: theme.foreground, textAlign: 'center' }}>
              {agent.name}
            </Text>
            <Text style={{ fontFamily: 'Geist', fontSize: 15, lineHeight: 21, color: theme.muted, textAlign: 'center', maxWidth: 320 }}>
              {agent.isDefault ? 'Your AI Chief of Staff.' : agent.description || 'Ready when you are.'}
            </Text>
            {agent.canEdit ? (
              <Pressable
                accessibilityRole="button"
                onPress={onEdit}
                style={({ pressed }) => ({
                  paddingHorizontal: 22,
                  height: 38,
                  borderRadius: 19,
                  justifyContent: 'center',
                  backgroundColor: pressed ? theme.surfaceMuted : theme.surfaceSubtle,
                })}
              >
                <Text style={{ fontFamily: 'GeistMedium', fontSize: 15, color: theme.foreground }}>Edit</Text>
              </Pressable>
            ) : null}
          </View>

          <Group
            rows={[
              { key: 'library', symbol: 'folder', label: 'Library', value: fileCount, onPress: () => setLibraryOpen((open) => !open) },
              { key: 'computer', symbol: 'desktopcomputer', label: 'Computer', value: computerValue, onPress: onWeb },
            ]}
          />
          {libraryOpen ? (
            <Group
              rows={
                files?.length
                  ? files.map((file) => ({ key: file._id, symbol: 'doc', label: file.name, onPress: () => onFile(file) }))
                  : [{ key: 'empty', symbol: 'tray', label: files === null ? 'Could not load files' : 'No files yet' }]
              }
            />
          ) : null}

          <Group
            title="Details"
            rows={[
              { key: 'model', symbol: 'cpu', label: 'Model', value: modelName },
              { key: 'access', symbol: 'person.2', label: 'Access', value: agent.visibility === 'creator' ? 'Only me' : 'Workspace' },
              { key: 'tools', symbol: 'wrench.and.screwdriver', label: 'Tools', value: `${agent.allowedToolIds.length} on` },
            ]}
          />

          <Group
            title="This thread"
            rows={[
              { key: 'new', symbol: 'square.and.pencil', label: 'New thread', onPress: onNewThread },
              { key: 'archive', symbol: archived ? 'tray.and.arrow.up' : 'archivebox', label: archived ? 'Unarchive thread' : 'Archive thread', onPress: onArchive },
            ]}
          />
        </ScrollView>
      </View>
    </Modal>
  )
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

function CircleButton({ symbol, label, onPress }: { symbol: string; label: string; onPress: () => void }) {
  const { theme } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.surfaceMuted : theme.surfaceSubtle,
      })}
    >
      <Image source={`sf:${symbol}`} style={{ width: 16, height: 16 }} tintColor={theme.foreground as string} />
    </Pressable>
  )
}

/** iOS inset-grouped list section. */
function Group({ title, rows }: { title?: string; rows: Row[] }) {
  const { theme } = useTheme()
  return (
    <View style={{ gap: 8 }}>
      {title ? (
        <Text style={{ fontFamily: 'GeistMedium', fontSize: 13, color: theme.muted, paddingHorizontal: 16 }}>{title}</Text>
      ) : null}
      <View style={{ borderRadius: 18, borderCurve: 'continuous', backgroundColor: theme.surfaceSubtle, overflow: 'hidden' }}>
        {rows.map((row, index) => (
          <View key={row.key}>
            {index ? <View style={{ height: 0.5, marginLeft: 52, backgroundColor: theme.border }} /> : null}
            <Pressable
              accessibilityRole={row.onPress ? 'button' : 'text'}
              disabled={!row.onPress}
              onPress={row.onPress}
              style={({ pressed }) => ({
                minHeight: 52,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingHorizontal: 16,
                backgroundColor: pressed ? theme.surfaceMuted : 'transparent',
              })}
            >
              <Image source={`sf:${row.symbol}`} style={{ width: 20, height: 20 }} contentFit="contain" tintColor={theme.foreground as string} />
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'Geist', fontSize: 16, color: row.destructive ? '#dc2626' : theme.foreground }}>
                {row.label}
              </Text>
              {row.value ? (
                <Text numberOfLines={1} style={{ fontFamily: 'Geist', fontSize: 15, color: theme.muted, maxWidth: 150 }}>{row.value}</Text>
              ) : null}
              {row.onPress ? (
                <Image source="sf:chevron.right" style={{ width: 8, height: 13 }} tintColor={theme.mutedLight as string} />
              ) : null}
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  )
}
