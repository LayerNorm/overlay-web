import React, { useState } from 'react'
import { Alert, View } from 'react-native'
import { Stack } from 'expo-router'
import { Button, ContextMenu, Divider, Host, Menu, RNHostView } from '@expo/ui/swift-ui'
import { useTheme } from '../../hooks/useTheme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import type { KnowledgeFile } from '@overlay/app-core'
import { deleteKnowledgeFile, shareKnowledgeFile } from '../../services/knowledgeService'
import { moveFile, renameFile } from '../../services/filesService'
import { getRequestWorkspaceId } from '../../services/appApi'
import { ShareSheet } from '../workspace/ShareSheet'
import { RoomConfirmDialog, type RoomConfirmation } from '../chat/RoomSheets'

const isFolder = (file: KnowledgeFile) => file.type === 'folder' || file.kind === 'folder'

/** Folders a file can move into: not itself, not anything inside it, not where it already is. */
export function moveTargets(file: KnowledgeFile, files: readonly KnowledgeFile[]) {
  const byId = new Map(files.map((item) => [item._id, item]))
  const inside = (folderId: string) => {
    for (let id: string | null | undefined = folderId; id; id = byId.get(id)?.parentId)
      if (id === file._id) return true
    return false
  }
  return files
    .filter((item) => isFolder(item) && item._id !== file.parentId && !inside(item._id))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Rename, move, share and delete for files and folders, each with native UI:
 * an iOS prompt for the name, a confirmation dialog for delete. Render
 * `overlays` once on the screen.
 */
export function useFileActions({ onDeleted }: { onDeleted?: (file: KnowledgeFile) => void } = {}) {
  const { activeWorkspaceId, workspacesEnabled } = useWorkspace()
  const { isFeatureEnabled } = useAppSession()
  const { theme } = useTheme()
  const [confirmation, setConfirmation] = useState<RoomConfirmation | null>(null)
  const [sharing, setSharing] = useState<KnowledgeFile | null>(null)
  const canShare = workspacesEnabled && isFeatureEnabled('resourceSharing')

  const run = (title: string, operation: () => Promise<unknown>, after?: () => void) => {
    const scope = activeWorkspaceId
    if (!scope || getRequestWorkspaceId() !== scope) return
    void operation()
      .then(() => { if (getRequestWorkspaceId() === scope) after?.() })
      .catch((cause) => {
        if (getRequestWorkspaceId() === scope)
          Alert.alert(title, cause instanceof Error ? cause.message : 'Try again in a moment.')
      })
  }
  const rename = (file: KnowledgeFile) =>
    Alert.prompt(
      isFolder(file) ? 'Rename folder' : 'Rename file',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (value?: string) => {
            const name = value?.trim()
            if (name && name !== file.name) run('Could not rename', () => renameFile(file._id, name))
          },
        },
      ],
      'plain-text',
      file.name,
    )
  const move = (file: KnowledgeFile, parentId: string | null) =>
    run('Could not move', () => moveFile(file._id, parentId))
  const remove = (file: KnowledgeFile) =>
    setConfirmation({
      title: `Delete “${file.name}”?`,
      message: isFolder(file) ? 'The folder and everything in it will be removed from your workspace.' : 'It will be removed from your workspace.',
      label: isFolder(file) ? 'Delete folder' : 'Delete file',
      destructive: true,
      run: () => run('Could not delete', () => deleteKnowledgeFile(file._id), () => onDeleted?.(file)),
    })

  const overlays = (
    <>
      <RoomConfirmDialog request={confirmation} onClose={() => setConfirmation(null)} />
      <ShareSheet
        visible={Boolean(sharing)}
        theme={theme}
        resource={activeWorkspaceId && sharing ? { workspaceId: activeWorkspaceId, resourceType: 'file', resourceId: sharing._id } : null}
        resourceTitle={sharing?.name ?? 'File'}
        onSetPublicVisibility={async (visibility) => (await shareKnowledgeFile(sharing!._id, visibility)).url}
        onClose={() => setSharing(null)}
      />
    </>
  )
  return { rename, move, remove, share: canShare ? (file: KnowledgeFile) => setSharing(file) : null, overlays }
}

export type FileActions = ReturnType<typeof useFileActions>

/** The actions as SwiftUI menu items (context menus). */
function MenuItems({ file, files, actions, onOpen }: { file: KnowledgeFile; files: readonly KnowledgeFile[]; actions: FileActions; onOpen?: () => void }) {
  const targets = moveTargets(file, files)
  return (
    <>
      {onOpen ? <Button label="Open" systemImage={isFolder(file) ? 'folder' : 'doc'} onPress={onOpen} /> : null}
      <Button label="Rename" systemImage="pencil" onPress={() => actions.rename(file)} />
      <Menu label="Move to" systemImage="folder">
        {file.parentId ? <Button label="Files" systemImage="tray.full" onPress={() => actions.move(file, null)} /> : null}
        {targets.map((folder) => (
          <Button key={folder._id} label={folder.name} systemImage="folder" onPress={() => actions.move(file, folder._id)} />
        ))}
      </Menu>
      {actions.share ? <Button label="Share" systemImage="square.and.arrow.up" onPress={() => actions.share!(file)} /> : null}
      <Divider />
      <Button label="Delete" systemImage="trash" role="destructive" onPress={() => actions.remove(file)} />
    </>
  )
}

/** Touch and hold a file row or folder card for its actions. */
export function FileContextMenu({
  file,
  files,
  actions,
  width,
  onOpen,
  children,
}: {
  file: KnowledgeFile
  files: readonly KnowledgeFile[]
  actions: FileActions
  width: number
  onOpen: () => void
  children: React.ReactNode
}) {
  const { theme, isDark } = useTheme()
  return (
    <Host matchContents={{ vertical: true }} style={{ width }} colorScheme={isDark ? 'dark' : 'light'}>
      <ContextMenu>
        <ContextMenu.Items>
          <MenuItems file={file} files={files} actions={actions} onOpen={onOpen} />
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <RNHostView matchContents>
            <View style={{ width, backgroundColor: theme.background }}>{children}</View>
          </RNHostView>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  )
}

/** "…" navigation-bar menu for an open file or note. */
export function FileToolbarMenu({
  file,
  files,
  actions,
  onDownload,
}: {
  file: KnowledgeFile
  files: readonly KnowledgeFile[]
  actions: FileActions
  onDownload?: () => void
}) {
  const targets = moveTargets(file, files)
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="File options">
        {[
          onDownload ? (
            <Stack.Toolbar.MenuAction key="download" icon="square.and.arrow.down" onPress={onDownload}>
              Save or send a copy
            </Stack.Toolbar.MenuAction>
          ) : null,
          <Stack.Toolbar.MenuAction key="rename" icon="pencil" onPress={() => actions.rename(file)}>
            Rename
          </Stack.Toolbar.MenuAction>,
          <Stack.Toolbar.Menu key="move" icon="folder" title="Move to">
            {[
              file.parentId ? (
                <Stack.Toolbar.MenuAction key="root" icon="tray.full" onPress={() => actions.move(file, null)}>
                  Files
                </Stack.Toolbar.MenuAction>
              ) : null,
              ...targets.map((folder) => (
                <Stack.Toolbar.MenuAction key={folder._id} icon="folder" onPress={() => actions.move(file, folder._id)}>
                  {folder.name}
                </Stack.Toolbar.MenuAction>
              )),
            ]}
          </Stack.Toolbar.Menu>,
          actions.share ? (
            <Stack.Toolbar.MenuAction key="share" icon="person.crop.circle.badge.plus" onPress={() => actions.share!(file)}>
              Share
            </Stack.Toolbar.MenuAction>
          ) : null,
          <Stack.Toolbar.Menu key="danger" inline title="">
            <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => actions.remove(file)}>
              Delete
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>,
        ]}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  )
}
