import React, { useEffect, useState } from 'react'
import { Alert, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
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
  deleteKnowledgeFile,
  getKnowledgeFileContent,
  getUploadUrl,
  uploadToR2,
  shareKnowledgeFile,
} from '../../services/knowledgeService'
import { createNote, saveNote } from '../../services/noteStorage'
import { moveFile, renameFile } from '../../services/filesService'
import { AUTH_BASE_URL } from '../../services/appConfig'
import { appRequest, getRequestWorkspaceId } from '../../services/appApi'
import { normalizeHtmlForMobileMarkdown, toStoredHtml } from '../../services/noteContentFormat'
import { Button, T } from '../shell/primitives'
import { FeatureGate } from '../ui/FeatureGate'
import { ShareSheet } from '../workspace/ShareSheet'
import {
  FilePaper,
  FilesBrowser,
  NoteDocument,
  ResourcePage,
  ResourceRow,
  ResourceSheet,
  ResourceState,
} from './ResourceViews'

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
  const { workspaceId, theme, openDrawer, top, router } = useResourceScope()
  const { capabilities } = useAppSession()
  const files = useLiveResource(
    api.files.browse.list,
    workspaceId && capabilities.files ? { workspaceId } : null,
  )
  const [folder, setFolder] = useState<{ workspaceId: string; id: string | null } | null>(
    initialParentId && workspaceId ? { workspaceId, id: initialParentId } : null,
  )
  const [addScope, setAddScope] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const parentId = folder?.workspaceId === workspaceId ? folder.id : null
  const personal = useLiveResource(
    api.files.browse.children,
    workspaceId && parentId ? { workspaceId, parentId, view: 'personal' } : null,
  )
  const shared = useLiveResource(
    api.files.browse.children,
    workspaceId && parentId ? { workspaceId, parentId, view: 'workspace' } : null,
  )
  const childRows = [
    ...new Map(
      [...(personal.data?.files ?? []), ...(shared.data?.files ?? [])].map((file) => [
        file._id,
        file,
      ]),
    ).values(),
  ]
  const displayed =
    parentId && files.data
      ? [...files.data.filter((file) => file.parentId !== parentId), ...childRows]
      : files.data
  async function add(kind: 'note' | 'folder' | 'upload') {
    if (!workspaceId || getRequestWorkspaceId() !== workspaceId || busy) return
    const scope = workspaceId
    setBusy(true)
    setError(null)
    try {
      let id: string | undefined
      if (kind === 'folder') {
        if (!name.trim()) throw new Error('Enter a folder name.')
        id = (await createKnowledgeFolder({ name: name.trim(), parentId })).id
      } else if (kind === 'note') {
        id = (await createNote({ title: name.trim() || 'Untitled', content: '' })).id
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
      setAddScope(null)
      setName('')
      if (kind === 'note' && id) router.push({ pathname: '/note/[id]', params: { id } })
    } catch (cause) {
      if (getRequestWorkspaceId() === scope)
        setError(cause instanceof Error ? cause.message : 'Could not add this file.')
    } finally {
      setBusy(false)
    }
  }
  if (!capabilities.files) return <FeatureGate title="Files are turned off" />
  return (
    <>
      <ResourcePage
        theme={theme}
        section="Files"
        topInset={top}
        onDrawer={openDrawer}
        onSearch={() => router.push('/search')}
      >
        {displayed &&
        !(
          parentId &&
          (personal.loading ||
            shared.loading ||
            personal.error ||
            shared.error ||
            (personal.data === null && shared.data === null))
        ) ? (
          <>
            <FilesBrowser
              theme={theme}
              files={displayed}
              parentId={parentId}
              onFolder={(id) => workspaceId && setFolder({ workspaceId, id })}
              onAdd={() => {
                setAddScope(workspaceId)
                setError(null)
              }}
              onOpen={(file) =>
                router.push(
                  file.kind === 'note'
                    ? { pathname: '/note/[id]', params: { id: file._id } }
                    : { pathname: '/(tabs)/files/file/[id]', params: { id: file._id } },
                )
              }
            />
            {personal.data?.complete === false || shared.data?.complete === false ? (
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
              Boolean(parentId && (personal.loading || shared.loading))
            }
            error={
              files.error ||
              personal.error ||
              shared.error ||
              (parentId && personal.data === null && shared.data === null
                ? 'This folder is no longer available.'
                : undefined) ||
              (files.data === null ? 'Files are unavailable in this workspace.' : undefined)
            }
            onRetry={() => {
              files.retry()
              personal.retry()
              shared.retry()
            }}
          />
        )}
      </ResourcePage>
      <ResourceSheet
        theme={theme}
        title="Add file"
        visible={Boolean(workspaceId && addScope === workspaceId)}
        onClose={() => {
          if (!busy) setAddScope(null)
        }}
      >
        <TextInput
          accessibilityLabel="File or folder name"
          placeholder="Name"
          placeholderTextColor={theme.muted}
          value={name}
          onChangeText={setName}
          style={{ color: theme.foreground, fontFamily: 'Geist', fontSize: 14, padding: 12 }}
        />
        {busy ? (
          <ResourceState theme={theme} loading />
        ) : (
          <>
            <ResourceRow
              theme={theme}
              title="New note"
              onPress={() => {
                void add('note')
              }}
            />
            <ResourceRow
              theme={theme}
              title="New folder"
              onPress={() => {
                void add('folder')
              }}
            />
            <ResourceRow
              theme={theme}
              title="Upload file"
              onPress={() => {
                void add('upload')
              }}
            />
          </>
        )}
        {error ? <ResourceState theme={theme} error={error} /> : null}
      </ResourceSheet>
    </>
  )
}

export function ResourceDocumentScreen({ id }: { id: string }) {
  const { activeWorkspaceId } = useWorkspace()
  return <ResourceDocumentBody key={`${activeWorkspaceId}:${id}`} id={id} />
}

function ResourceDocumentBody({ id }: { id: string }) {
  const { session } = useAuth()
  const { workspacesEnabled } = useWorkspace()
  const { isFeatureEnabled } = useAppSession()
  const { workspaceId, theme, openDrawer, top, router } = useResourceScope()
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
  const [menu, setMenu] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [rename, setRename] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function act(operation: () => Promise<unknown>, after?: () => void) {
    if (busy || !workspaceId || getRequestWorkspaceId() !== workspaceId) return
    const scope = workspaceId
    setBusy(true)
    setError(null)
    try {
      await operation()
      if (getRequestWorkspaceId() === scope) {
        setMenu(false)
        setRename(null)
        setMoving(false)
        after?.()
      }
    } catch (cause) {
      if (getRequestWorkspaceId() === scope)
        setError(cause instanceof Error ? cause.message : 'Could not update this file.')
    } finally {
      setBusy(false)
    }
  }
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
    <ResourcePage
      theme={theme}
      section="Files"
      topInset={top}
      onDrawer={openDrawer}
      onBack={() => router.back()}
      onSearch={() => router.push('/search')}
    >
      {doc ? (
        doc.kind === 'note' ? (
          <NoteDocument
            key={`${workspaceId}:${id}`}
            theme={theme}
            file={doc}
            onOptions={() => {
              setMenu(true)
              setError(null)
            }}
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
          <>
            <FilePaper
              theme={theme}
              file={doc}
              image={image}
              onDownload={() => {
                void download()
              }}
            />
            <Button
              theme={theme}
              onPress={() => {
                setMenu(true)
                setError(null)
              }}
            >
              File options
            </Button>
          </>
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
      <ResourceSheet
        theme={theme}
        title="File options"
        visible={menu && Boolean(doc)}
        onClose={() => {
          if (!busy) {
            setMenu(false)
            setRename(null)
            setMoving(false)
          }
        }}
      >
        {busy ? (
          <ResourceState theme={theme} loading />
        ) : rename !== null ? (
          <View style={{ gap: 14 }}>
            <TextInput
              accessibilityLabel="File name"
              value={rename}
              onChangeText={setRename}
              style={{ color: theme.foreground, fontFamily: 'Geist', padding: 12 }}
            />
            <Button
              theme={theme}
              secondary
              onPress={() => {
                void act(() => renameFile(id, rename))
              }}
            >
              Rename
            </Button>
          </View>
        ) : moving ? (
          <>
            <ResourceRow
              theme={theme}
              title="Move to root"
              onPress={() => {
                void act(() => moveFile(id, null))
              }}
            />
            {tree.data
              ?.filter((folder) => folder.type === 'folder' && folder._id !== id)
              .map((folder) => (
                <ResourceRow
                  key={folder._id}
                  theme={theme}
                  title={folder.name}
                  onPress={() => {
                    void act(() => moveFile(id, folder._id))
                  }}
                />
              ))}
          </>
        ) : (
          <>
            <ResourceRow theme={theme} title="Rename" onPress={() => setRename(doc?.name || '')} />
            <ResourceRow theme={theme} title="Move" onPress={() => setMoving(true)} />
            {workspacesEnabled && isFeatureEnabled('resourceSharing') ? (
              <ResourceRow
                theme={theme}
                title="Share"
                onPress={() => {
                  setMenu(false)
                  setSharing(true)
                }}
              />
            ) : null}
            <ResourceRow
              theme={theme}
              title="Delete file"
              onPress={() =>
                Alert.alert('Delete file?', 'This removes the file from your workspace.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                      void act(
                        () => deleteKnowledgeFile(id),
                        () => router.back(),
                      )
                    },
                  },
                ])
              }
            />
          </>
        )}
        {error ? (
          <T accessibilityRole="alert" style={{ color: theme.danger }}>
            {error}
          </T>
        ) : null}
      </ResourceSheet>
      <ShareSheet
        visible={sharing && Boolean(doc)}
        theme={theme}
        resource={workspaceId && doc ? { workspaceId, resourceType: 'file', resourceId: id } : null}
        resourceTitle={doc?.name ?? 'File'}
        onSetPublicVisibility={async (visibility) => (await shareKnowledgeFile(id, visibility)).url}
        onClose={() => setSharing(false)}
      />
    </ResourcePage>
  )
}
