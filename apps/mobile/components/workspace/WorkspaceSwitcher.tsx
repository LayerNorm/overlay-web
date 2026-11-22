import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import type { Theme } from '../../constants/theme'
import { fontSize, spacing } from '../../constants/theme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { isPersonalWorkspace } from '../../services/workspaceService'
import { AppIcon } from '../ui/AppIcon'
import { BottomSheet } from '../ui/AppChrome'
import { ListRow, Section } from '../ui/primitives'
import { CreateWorkspaceSheet } from './CreateWorkspaceSheet'

/**
 * Compact workspace switcher for the drawer header. Renders nothing when the
 * workspaces capability is off or the list hasn't loaded — single-tenant
 * installs see no chrome change.
 */
export function WorkspaceSwitcher({ theme }: { theme: Theme }): React.ReactElement | null {
  const { workspaces, activeWorkspace, activeWorkspaceId, workspacesEnabled, isSwitching, switchWorkspace } =
    useWorkspace()
  const router = useRouter()
  const [sheetVisible, setSheetVisible] = useState(false)
  const [createVisible, setCreateVisible] = useState(false)

  if (!workspacesEnabled || workspaces.length === 0) {
    return null
  }

  const label = activeWorkspace?.name ?? 'Personal'

  const handleSelect = async (workspaceId: string): Promise<void> => {
    try {
      await switchWorkspace(workspaceId)
    } catch {
      // WorkspaceContext already rolled the selection back; keep the sheet
      // open so the user sees the selection didn't change.
      return
    }
    setSheetVisible(false)
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.switcher, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
        activeOpacity={0.7}
        onPress={() => setSheetVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={`Workspace: ${label}`}
      >
        <AppIcon
          sfSymbol={activeWorkspace && !isPersonalWorkspace(activeWorkspace) ? 'building.2' : 'person'}
          featherIcon={activeWorkspace && !isPersonalWorkspace(activeWorkspace) ? 'briefcase' : 'user'}
          size={14}
          color={theme.textSecondary}
        />
        <Text style={[styles.switcherLabel, { color: theme.text }]} numberOfLines={1}>
          {label}
        </Text>
        <AppIcon
          sfSymbol="chevron.up.chevron.down"
          featherIcon="chevron-down"
          size={13}
          color={theme.textSecondary}
        />
      </TouchableOpacity>

      <BottomSheet
        theme={theme}
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        title="Workspaces"
      >
        <Section theme={theme}>
          {workspaces.map((workspace) => (
            <ListRow
              key={workspace.id}
              theme={theme}
              title={workspace.name}
              subtitle={
                isPersonalWorkspace(workspace)
                  ? 'Personal workspace'
                  : workspace.role
                    ? `${workspace.memberCount ?? 1} member${(workspace.memberCount ?? 1) === 1 ? '' : 's'} · ${workspace.role}`
                    : undefined
              }
              icon={isPersonalWorkspace(workspace) ? 'user' : 'briefcase'}
              iconSfSymbol={isPersonalWorkspace(workspace) ? 'person' : 'building.2'}
              selected={workspace.id === activeWorkspaceId}
              disabled={isSwitching}
              onPress={() => void handleSelect(workspace.id)}
            />
          ))}
        </Section>
        <Section theme={theme}>
          <ListRow
            theme={theme}
            icon="settings"
            iconSfSymbol="gear"
            title="Manage workspace"
            subtitle="People, teams, sharing, and billing"
            onPress={() => {
              setSheetVisible(false)
              router.push('/workspace')
            }}
          />
          <ListRow
            theme={theme}
            icon="plus"
            iconSfSymbol="plus"
            title="New workspace"
            onPress={() => {
              setSheetVisible(false)
              setCreateVisible(true)
            }}
          />
        </Section>
      </BottomSheet>

      <CreateWorkspaceSheet
        visible={createVisible}
        theme={theme}
        onClose={() => setCreateVisible(false)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  switcher: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  switcherLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    flexShrink: 1,
  },
})
