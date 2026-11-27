import React, { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import * as WebBrowser from 'expo-web-browser'
import { File as CacheFile, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useTheme } from '../../hooks/useTheme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useDrawer } from '../../contexts/DrawerContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useAuth } from '../../contexts/AuthContext'
import { useLiveResource } from '../../hooks/useLiveResource'
import { api, type Id } from '../../services/convexClient'
import {
  createKnowledgeFolder,
  createFileWithStorage,
  getKnowledgeFileContent,
  getUploadUrl,
  uploadToR2,
} from '../../services/knowledgeService'
import { createNote, saveNote } from '../../services/noteStorage'
import { moveFile } from '../../services/filesService'
import { AUTH_BASE_URL } from '../../services/appConfig'
import { appRequest, getRequestWorkspaceId } from '../../services/appApi'
import { normalizeHtmlForMobileMarkdown, toStoredHtml } from '../../services/noteContentFormat'
import { TabToolbar } from '../navigation/nativeHeader'
import { useMode } from '../../contexts/ModeContext'
import { FeatureGate } from '../ui/FeatureGate'
import {
  FilePaper,
  FilesBrowser,
  NoteDocument,
  ResourcePage,
  ResourceState,
} from './ResourceViews'
import { FileToolbarMenu, useFileActions } from './FileActions'

export function useResourceScope() {
  const { activeWorkspaceId } = useWorkspace()
  const ready = useNativeDataReady()
  const { theme, isDark } = useTheme()
  const { openDrawer } = useDrawer()
  const { top } = useSafeAreaInsets()
  const router = useRouter()
  return { workspaceId: ready ? activeWorkspaceId : null, theme, isDark, openDrawer, top, router }
}

export function FilesBrowserScreen({ initialParentId }: { initialParentId?: string } = {}) {
  const { workspaceId, theme, router } = useResourceScope()
  const { capabilities } = useAppSession()
  const [query, setQuery] = useState('')
  // Files follow the app's Workspace | Personal mode, as on the web.
  const { mode } = useMode()
  const files = useLiveResource(
    api.files.browse.list,
    workspaceId && capabilities.files ? { workspaceId, view: mode } : null,
  )
  const [folder] = useState<{ workspaceId: string; id: string | null } | null>(
    initialParentId && workspaceId ? { workspaceId, id: initialParentId } : null,
  )
  const [busy, setBusy] = useState(false)
  const actions = useFileActions()
  const parentId = folder?.workspaceId === workspaceId ? folder.id : null
  const children = useLiveResource(
    api.files.browse.children,
    workspaceId && parentId ? { workspaceId, parentId, view: mode } : null,
  )
  const childRows = children.data?.files ?? []
  const displayed =
    parentId && files.data
      ? [...files.data.filter((file) => file.parentId !== parentId), ...childRows]
      : files.data
  const newFolder = () =>
    Alert.prompt('New folder', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Create', onPress: (value?: string) => { if (value?.trim()) void add('folder', value.trim()) } },
    ], 'plain-text')
  async function add(kind: 'note' | 'folder' | 'upload', name = '') {
    if (!workspaceId || getRequestWorkspaceId() !== workspaceId || busy) return
    const scope = workspaceId
    setBusy(true)
    try {
      let id: string | undefined
      if (kind === 'folder') {
        id = (await createKnowledgeFolder({ name, parentId })).id
      } else if (kind === 'note') {
        id = (await createNote({ title: 'Untitled', content: '' })).id
        if (getRequestWorkspaceId() !== scope) return
        if (parentId) await moveFile(id, parentId)
      } else {
        const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
        if (picked.canceled || getRequestWorkspaceId() !== scope) return
        const file = picked.assets[0]
        const mimeType = file.mimeType || 'application/octet-stream'
        const bytes = await (await fetch(file.uri)).arrayBuffer()
        const upload = await getUploadUrl({
          name: file.name,
          mimeType,
          sizeBytes: bytes.byteLength,
        })
        if (getRequestWorkspaceId() !== scope) return
        await uploadToR2(upload.presignedUrl, bytes, mimeType)
        if (getRequestWorkspaceId() !== scope) return
        id = (
          await createFileWithStorage({
            name: file.name,
            r2Key: upload.r2Key,
            sizeBytes: bytes.byteLength,
            parentId,
          })
        ).id
      }
      if (getRequestWorkspaceId() !== scope) return
      if (kind === 'note' && id) router.push({ pathname: '/note/[id]', params: { id } })
    } catch (cause) {
      if (getRequestWorkspaceId() === scope)
        Alert.alert(kind === 'folder' ? 'Could not create the folder' : kind === 'note' ? 'Could not create the note' : 'Could not upload the file', cause instanceof Error ? cause.message : 'Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }
  if (!capabilities.files) return <FeatureGate title="Files are turned off" />
  return (
    <>
      <Stack.Screen
        options={{
          ...(parentId ? { title: files.data?.find((file) => file._id === parentId)?.name ?? 'Folder' } : {}),
          headerSearchBarOptions: {
            placeholder: 'Search files',
            hideWhenScrolling: true,
            onChangeText: (event) => setQuery(event.nativeEvent.text),
            onCancelButtonPress: () => setQuery(''),
          },
        }}
      />
      {(() => {
        const addMenu = (
          <Stack.Toolbar.Menu icon="plus" accessibilityLabel="Add">
            <Stack.Toolbar.MenuAction icon="doc.text" onPress={() => void add('note')}>
              New note
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="folder.badge.plus" onPress={newFolder}>
              New folder
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="square.and.arrow.up" onPress={() => void add('upload')}>
              Upload file
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        )
        return parentId ? (
          <Stack.Toolbar placement="right">{addMenu}</Stack.Toolbar>
        ) : (
          <TabToolbar>{addMenu}</TabToolbar>
        )
      })()}
      <ResourcePage theme={theme}>
        {displayed &&
        !(
          parentId &&
          (children.loading || children.error || children.data === null)
        ) ? (
          <>
            <FilesBrowser
              theme={theme}
              files={displayed}
              parentId={parentId}
              query={query}
              actions={actions}
              onFolder={(id) => {
                if (id) router.push({ pathname: '/(tabs)/files/file/[id]', params: { id } })
                else router.back()
              }}
              onOpen={(file) =>
                router.push(
                  file.kind === 'note'
                    ? { pathname: '/note/[id]', params: { id: file._id } }
                    : { pathname: '/(tabs)/files/file/[id]', params: { id: file._id } },
                )
              }
            />
            {children.data?.complete === false ? (
              <ResourceState
                theme={theme}
                empty="Some files are not shown. Open this folder on web to browse the full list."
              />
            ) : null}
          </>
        ) : (
          <ResourceState
            theme={theme}
            loading={
              files.loading ||
              !workspaceId ||
              Boolean(parentId && children.loading)
            }
            error={
              files.error ||
              children.error ||
              (parentId && children.data === null
                ? 'This folder is no longer available.'
                : undefined) ||
              (files.data === null ? 'Files are unavailable in this workspace.' : undefined)
            }
            onRetry={() => {
              files.retry()
              children.retry()
            }}
          />
        )}
      </ResourcePage>
      {actions.overlays}
    </>
  )
}

export function ResourceDocumentScreen({ id }: { id: string }) {
  const { activeWorkspaceId } = useWorkspace()
  return <ResourceDocumentBody key={`${activeWorkspaceId}:${id}`} id={id} />
}

function ResourceDocumentBody({ id }: { id: string }) {
  const { session } = useAuth()
  const { workspaceId, theme, router } = useResourceScope()
  const file = useLiveResource(
    api.files.browse.get,
    workspaceId && id ? { workspaceId, fileId: id as Id<'files'> } : null,
  )
  const [body, setBody] = useState<{ key: string; content?: string; error?: string }>({ key: '' })
  const [bodyAttempt, setBodyAttempt] = useState(0)
  const bodyKey = JSON.stringify([workspaceId, id, file.data?.updatedAt, bodyAttempt])
  const needsBody = Boolean(file.data?.textInObjectStore)
  useEffect(() => {
    if (!needsBody || !workspaceId) return
    let active = true
    void getKnowledgeFileContent(id)
      .then((content) => {
        if (active && getRequestWorkspaceId() === workspaceId) setBody({ key: bodyKey, content })
      })
      .catch((cause) => {
        if (active)
          setBody({
            key: bodyKey,
            error: cause instanceof Error ? cause.message : 'Could not load this file.',
          })
      })
    return () => {
      active = false
    }
  }, [needsBody, workspaceId, id, bodyKey])
  const tree = useLiveResource(api.files.browse.list, workspaceId ? { workspaceId } : null)
  const actions = useFileActions({ onDeleted: () => router.back() })
  const [error, setError] = useState<string | null>(null)
  const loadedBody = body.key === bodyKey ? body : undefined
  const doc =
    file.data && (!needsBody || loadedBody?.content !== undefined)
      ? { ...file.data, ...(needsBody ? { textContent: loadedBody?.content } : {}) }
      : file.data === null
        ? null
        : undefined
  let image: { uri: string; headers: Record<string, string> } | undefined
  if (
    doc?.downloadUrl &&
    session &&
    workspaceId &&
    (doc.mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|heic)$/i.test(doc.name))
  ) {
    const url = new URL(doc.downloadUrl, AUTH_BASE_URL)
    if (url.origin === new URL(AUTH_BASE_URL).origin && url.pathname.startsWith('/api/v1/files/'))
      image = {
        uri: url.href,
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'x-overlay-workspace-id': workspaceId,
        },
      }
  }
  async function download() {
    if (!doc || !workspaceId || getRequestWorkspaceId() !== workspaceId) return
    try {
      let bytes: string | Uint8Array = doc.textContent ?? doc.content ?? ''
      if (!doc.downloadUrl && !bytes) {
        await WebBrowser.openBrowserAsync(AUTH_BASE_URL + '/home')
        return
      }
      if (doc.downloadUrl) {
        const url = new URL(doc.downloadUrl, AUTH_BASE_URL)
        if (
          url.origin !== new URL(AUTH_BASE_URL).origin ||
          !url.pathname.startsWith('/api/v1/files/')
        )
          throw new Error('This file must be opened on web.')
        const response = await appRequest(url.pathname + url.search, { workspaceId })
        if (!response.ok) throw new Error('Could not download this file.')
        bytes = new Uint8Array(await response.arrayBuffer())
      }
      if (getRequestWorkspaceId() !== workspaceId) return
      const target = new CacheFile(
        Paths.cache,
        id + '-' + doc.name.replace(/[^a-zA-Z0-9._-]/g, '_'),
      )
      target.create({ overwrite: true })
      target.write(bytes)
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(target.uri)
      else throw new Error('File sharing is unavailable on this device.')
    } catch (cause) {
      if (getRequestWorkspaceId() === workspaceId)
        setError(cause instanceof Error ? cause.message : 'Could not download this file.')
    }
  }
  if (doc?.type === 'folder') return <FilesBrowserScreen initialParentId={id} />
  return (
    <ResourcePage theme={theme} title={doc?.name ?? ''}>
      {doc ? (
        doc.kind === 'note' ? (
          <NoteDocument
            key={`${workspaceId}:${id}`}
            theme={theme}
            file={doc}
            onSave={async (value) => {
              if (getRequestWorkspaceId() !== workspaceId)
                throw new Error('Workspace changed. Reopen this note.')
              const note = await saveNote({
                id,
                folderId: doc.parentId,
                title: value.title,
                content: toStoredHtml(value.content),
                updatedAt: value.expectedUpdatedAt,
                createdAt: doc.createdAt,
              })
              if (getRequestWorkspaceId() !== workspaceId)
                throw new Error('Workspace changed. Reopen this note.')
              return {
                title: note.title,
                content: normalizeHtmlForMobileMarkdown(note.content),
                updatedAt: note.updatedAt,
              }
            }}
          />
        ) : (
          <FilePaper theme={theme} file={doc} image={image} />
        )
      ) : (
        <ResourceState
          theme={theme}
          loading={!loadedBody?.error && (file.loading || !workspaceId || needsBody)}
          error={
            file.error ||
            loadedBody?.error ||
            (doc === null ? 'This file is no longer available.' : undefined)
          }
          onRetry={() => {
            file.retry()
            setBodyAttempt((value) => value + 1)
          }}
        />
      )}
      {error ? <ResourceState theme={theme} error={error} /> : null}
      {doc ? (
        <FileToolbarMenu
          file={doc}
          files={tree.data ?? []}
          actions={actions}
          onDownload={doc.kind === 'note' ? undefined : () => void download()}
        />
      ) : null}
      {actions.overlays}
    </ResourcePage>
  )
}
