import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Linking, ScrollView, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAuth } from '../../contexts/AuthContext'
import { AUTH_BASE_URL } from '../../services/appConfig'
import { getRequestWorkspaceId } from '../../services/appApi'
import { api, subscribeConvex } from '../../services/convexClient'
import { openAgentThread } from '../../services/shellService'
import {
  archiveAgentThread,
  removeAgentThread,
  watchAgent,
  watchAgentComputers,
  watchAgentFiles,
  watchAgentMessages,
  watchAgentThreads,
  watchThreadCompatibility,
  answerAgentQuestion,
  decideAgentApproval,
  sendAgentMessage,
  stopAgentReply,
  resolveAgentRemoteRequest,
  type AgentRecord,
  type AgentComputer,
  type AgentFiles,
  type ThreadBundle,
  type ThreadCompatibility,
} from '../../services/agentThreadService'
import {
  compareRoomMessageRecords,
  type RoomMessageRecord,
} from '../../lib/roomMessages'
import { AgentThreadView, type AgentActions } from './AgentThreadViews'
import { AgentDirectoryView } from './AgentDirectory'
import { RoomScreen } from '../chat/RoomScreen'
import { T, Button } from '../shell/primitives'
import { ConversationHeader, TabToolbar } from '../navigation/nativeHeader'
import { AgentAvatar } from '../shell/AgentAvatar'
import { AgentProfileSheet } from './AgentProfileSheet'
import { CreatureEmpty } from '../creatures/CreatureEmpty'

/**
 * While a conversation loads, show nothing for a beat (most open instantly),
 * then a small spinner, never a line of status text.
 */
function AgentLoading() {
  const { theme } = useTheme()
  const [show, setShow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 450)
    return () => clearTimeout(timer)
  }, [])
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
      {show ? <ActivityIndicator color={theme.muted as string} /> : null}
    </View>
  )
}

/** A conversation or agent that can't be opened: say why and offer the way back. */
function AgentGone({ title, detail }: { title: string; detail: string }) {
  const { theme } = useTheme()
  const router = useRouter()
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.background }} contentContainerStyle={{ flexGrow: 1 }}>
      <CreatureEmpty
        title={title}
        detail={detail}
        shape="cloud"
        color="#94a3b8"
        action="Back to Agents"
        onAction={() => router.dismissTo('/(tabs)/agents')}
      />
    </ScrollView>
  )
}

function AgentState({ text, retry }: { text: string; retry?: () => void }) {
  const { theme } = useTheme()
  return (
    <View
      style={{
        flex: 1,
        padding: 28,
        justifyContent: 'center',
        gap: 14,
        backgroundColor: theme.surface,
      }}
    >
      <T accessibilityRole="alert" style={{ color: theme.muted }}>
        {text}
      </T>
      {retry ? (
        <Button theme={theme} secondary onPress={retry}>
          Retry
        </Button>
      ) : null}
    </View>
  )
}

export function AgentDirectMessageRoute({
  conversationId,
}: {
  conversationId: string
}) {
  const { activeWorkspaceId } = useWorkspace()
  return (
    <ResolveAgentRoute
      key={`${activeWorkspaceId}:${conversationId}`}
      workspaceId={activeWorkspaceId}
      conversationId={conversationId}
    />
  )
}

function ResolveAgentRoute({
  workspaceId,
  conversationId,
}: {
  workspaceId: string | null
  conversationId: string
}) {
  const [compatibility, set] = useState<ThreadCompatibility | undefined>()
  const [error, setError] = useState('')
  const [attempt, retry] = useState(0)
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    try {
      const stop = watchThreadCompatibility(
        workspaceId,
        conversationId,
        (value) => {
          if (active) set(value)
        },
        (reason) => {
          if (active)
            setError(
              reason instanceof Error
                ? reason.message
                : 'Unable to open conversation.',
            )
        },
      )
      return () => {
        active = false
        stop()
      }
    } catch (reason) {
      void Promise.resolve().then(() => {
        if (active) setError(String(reason))
      })
    }
    return () => {
      active = false
    }
  }, [workspaceId, conversationId, attempt])
  if (error)
    return (
      <AgentState
        text={error}
        retry={() => {
          setError('')
          retry((value) => value + 1)
        }}
      />
    )
  if (!workspaceId || compatibility === undefined)
    return <AgentLoading />
  if (!compatibility)
    return (
      <AgentGone
        title="Conversation unavailable"
        detail="It may have been deleted, or you no longer have access in this workspace."
      />
    )
  return compatibility.agentId ? (
    <ConnectedAgentThread
      key={`${workspaceId}:${conversationId}:${attempt}`}
      workspaceId={workspaceId}
      agentId={compatibility.agentId}
      conversationId={conversationId}
    />
  ) : (
    <RoomScreen conversationId={conversationId} conversationType="dm" />
  )
}

function ConnectedAgentThread({
  workspaceId,
  agentId,
  conversationId,
}: {
  workspaceId: string
  agentId: string
  conversationId: string
}) {
  const { theme, isDark } = useTheme()
  const { user } = useAuth()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [attempt, retry] = useState(0)
  const [agent, setAgent] = useState<AgentRecord | null>()
  const [bundle, setBundle] = useState<ThreadBundle | undefined>()
  const [compatibility, setCompatibility] = useState<
    ThreadCompatibility | undefined
  >()
  const [pages, setPages] = useState<Array<string | null>>([null])
  const [messages, setMessages] = useState<Record<string, RoomMessageRecord[]>>(
    {},
  )
  const [next, setNext] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [details, setDetails] = useState(false)
  const [computers, setComputers] = useState<AgentComputer[] | null>()
  const [files, setFiles] = useState<AgentFiles>()
  const [busy, setBusy] = useState(false)
  const allowed = Boolean(
    bundle?.threads.some((thread) => thread.conversationId === conversationId),
  )
  useEffect(() => {
    let active = true
    const write =
      <T,>(setter: (value: T) => void) =>
      (value: T) => {
        if (active) setter(value)
      }
    const fail = (reason: unknown) => {
      if (active)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to open agent thread.',
        )
    }
    const stops: Array<() => void> = []
    try {
      stops.push(watchAgent(workspaceId, agentId, write(setAgent), fail))
      stops.push(
        watchAgentThreads(
          workspaceId,
          agentId,
          write(setBundle),
          () => {},
          fail,
        ),
      )
      stops.push(
        watchThreadCompatibility(
          workspaceId,
          conversationId,
          write(setCompatibility),
          fail,
        ),
      )
    } catch (reason) {
      fail(reason)
    }
    return () => {
      active = false
      stops.forEach((stop) => stop())
    }
  }, [workspaceId, agentId, conversationId, attempt])
  useEffect(() => {
    if (!allowed) return
    let active = true
    const stops: Array<() => void> = []
    try {
      pages.forEach((cursor) =>
        stops.push(
          watchAgentMessages(
            workspaceId,
            conversationId,
            cursor,
            (rows, following) => {
              if (!active) return
              setMessages((old) => ({ ...old, [cursor ?? 'first']: rows }))
              if (cursor === pages[pages.length - 1]) setNext(following)
            },
            (reason) => {
              if (active)
                setError(
                  reason instanceof Error
                    ? reason.message
                    : 'Unable to load messages.',
                )
            },
          ),
        ),
      )
    } catch (reason) {
      setError(String(reason))
    }
    return () => {
      active = false
      stops.forEach((stop) => stop())
    }
  }, [workspaceId, conversationId, allowed, pages, attempt])
  useEffect(() => {
    if (!details) return
    let active = true
    const stops: Array<() => void> = []
    try {
      stops.push(
        watchAgentComputers(
          workspaceId,
          (value) => {
            if (active) setComputers(value)
          },
          () => {
            if (active) setComputers(null)
          },
        ),
      )
      stops.push(
        watchAgentFiles(
          workspaceId,
          conversationId,
          (value) => {
            if (active) setFiles(value)
          },
          () => {
            if (active) setFiles(null)
          },
        ),
      )
    } catch {
      void Promise.resolve().then(() => {
        if (active) {
          setComputers(null)
          setFiles(null)
        }
      })
    }
    return () => {
      active = false
      stops.forEach((stop) => stop())
    }
  }, [details, workspaceId, conversationId])
  const actions = useMemo<AgentActions>(
    () => ({
      approval: (request, approved) =>
        decideAgentApproval(
          workspaceId,
          conversationId,
          user?.id ?? '',
          request,
          approved,
        ),
      answer: (request, text) =>
        answerAgentQuestion(
          workspaceId,
          conversationId,
          user?.id ?? '',
          request,
          text,
        ),
      remote: (request, decision, response) =>
        resolveAgentRemoteRequest(
          workspaceId,
          conversationId,
          String(request.runId),
          String(request.requestKey),
          decision,
          response,
        ),
    }),
    [workspaceId, conversationId, user?.id],
  )
  const rows = [
    ...new Map(
      Object.values(messages)
        .flat()
        .map((message) => [message.id, message]),
    ).values(),
  ].sort(compareRoomMessageRecords)
  const opening =
    agent === undefined ||
    bundle === undefined ||
    compatibility === undefined ||
    (allowed && !('first' in messages))
  if (!user) return <AgentState text="Sign in to continue." />
  if (error && (!agent || opening))
    return (
      <AgentState
        text={error}
        retry={() => {
          setError('')
          retry((value) => value + 1)
        }}
      />
    )
  if (opening) return <AgentLoading />
  // The directory hides archived and private agents, so a missing agent most
  // often means it was archived from its editor or profile.
  if (!agent)
    return (
      <AgentGone
        title="This agent isn't available"
        detail="It was archived, made private, or removed from this workspace. Restore archived agents from Settings › Archived on the web."
      />
    )
  if (!allowed || !compatibility)
    return (
      <AgentGone
        title="Thread unavailable"
        detail="This thread was deleted or isn't shared with you."
      />
    )
  const thread = bundle?.threads.find(
    (item) => item.conversationId === conversationId,
  )
  const canSend = !compatibility.compatibility.readOnly && !thread?.archivedAt
  async function command(run: () => Promise<unknown>, leave = false) {
    if (busy) return
    setBusy(true)
    try {
      await run()
      if (leave && getRequestWorkspaceId() === workspaceId)
        router.replace('/(tabs)/agents')
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to update thread.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingBottom: insets.bottom }}>
      <ConversationHeader
        title={agent.name}
        subtitle={thread?.title && thread.title !== agent.name ? thread.title : undefined}
        avatar={<AgentAvatar agent={agent} dark={isDark} foreground={theme.foreground} size={26} />}
        onPressTitle={() => setDetails(true)}
      >
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Thread options">
          <Stack.Toolbar.MenuAction
            icon="square.and.pencil"
            disabled={busy}
            onPress={() =>
              void command(async () => {
                const result = await openAgentThread(workspaceId, agentId, true)
                if (result && getRequestWorkspaceId() === workspaceId)
                  router.replace(`/dm/${result.conversationId}` as never)
              })
            }
          >
            New thread
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="info.circle" onPress={() => setDetails(true)}>
            Agent details
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon={thread?.archivedAt ? 'tray.and.arrow.up' : 'archivebox'}
            disabled={busy}
            onPress={() =>
              void command(
                () => archiveAgentThread(workspaceId, agentId, conversationId, !thread?.archivedAt),
                !thread?.archivedAt,
              )
            }
          >
            {thread?.archivedAt ? 'Unarchive thread' : 'Archive thread'}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon="trash"
            destructive
            disabled={busy}
            onPress={() =>
              Alert.alert('Delete thread?', 'This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () =>
                    void command(() => removeAgentThread(workspaceId, agentId, conversationId), true),
                },
              ])
            }
          >
            Delete thread
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </ConversationHeader>
      <AgentThreadView
        agent={agent}
        messages={rows}
        theme={theme}
        dark={isDark}
        userId={user.id}
        actions={actions}
        canSend={canSend}
        error={
          error ||
          (compatibility.compatibility.readOnly
            ? compatibility.compatibility.message
            : undefined)
        }
        onSend={(text, nonce) =>
          sendAgentMessage(workspaceId, conversationId, text, nonce)
        }
        onStop={(id) => stopAgentReply(workspaceId, conversationId, id)}
        onOlder={
          next
            ? () =>
                setPages((old) => (old.includes(next) ? old : [...old, next]))
            : undefined
        }
      />
      <AgentProfileSheet
        visible={details}
        agent={agent}
        computerError={computers === null}
        computer={
          computers?.find(
            (computer) => computer.ownerType === 'agent' && computer.ownerId === agent.id,
          ) ?? (computers === undefined ? undefined : null)
        }
        files={files}
        archived={Boolean(thread?.archivedAt)}
        onClose={() => setDetails(false)}
        onFile={(file) => {
          setDetails(false)
          router.push(
            (file.kind === 'note'
              ? `/note/${file._id}`
              : file.kind === 'output'
                ? `/(tabs)/files/output/${file._id}`
                : `/(tabs)/files/file/${file._id}`) as never,
          )
        }}
        onEdit={() => {
          setDetails(false)
          router.push(`/agent/${agentId}` as never)
        }}
        onWeb={() => {
          void Linking.openURL(
            `${AUTH_BASE_URL}/app/agents?agent=${encodeURIComponent(agentId)}&id=${encodeURIComponent(conversationId)}`,
          ).catch(() => setError('Unable to open web.'))
        }}
        onNewThread={() => {
          setDetails(false)
          void command(async () => {
            const result = await openAgentThread(workspaceId, agentId, true)
            if (result && getRequestWorkspaceId() === workspaceId)
              router.replace(`/dm/${result.conversationId}` as never)
          })
        }}
        onArchive={() => {
          setDetails(false)
          void command(
            () => archiveAgentThread(workspaceId, agentId, conversationId, !thread?.archivedAt),
            !thread?.archivedAt,
          )
        }}
      />
    </View>
  )
}

export function AgentDirectoryScreen() {
  const { activeWorkspaceId } = useWorkspace()
  return (
    <ConnectedAgentDirectory
      key={activeWorkspaceId}
      workspaceId={activeWorkspaceId}
    />
  )
}

function ConnectedAgentDirectory({
  workspaceId,
}: {
  workspaceId: string | null
}) {
  const { theme, isDark } = useTheme()
  const router = useRouter()
  const [directory, set] = useState<NonNullable<
    Parameters<typeof AgentDirectoryView>[0]['agents']
  > | null>()
  const [canCreate, setCanCreate] = useState(false)
  const [error, setError] = useState('')
  const [attempt, retry] = useState(0)
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    try {
      const stop = subscribeConvex(
        api.agents.directory.list,
        { workspaceId },
        (value) => {
          if (active) {
            set(value?.agents ?? null)
            setCanCreate(value?.canCreate ?? false)
          }
        },
        (reason) => {
          if (active) setError(String(reason))
        },
      )
      return () => {
        active = false
        stop()
      }
    } catch (reason) {
      void Promise.resolve().then(() => {
        if (active) setError(String(reason))
      })
    }
    return () => {
      active = false
    }
  }, [workspaceId, attempt])
  if (error)
    return (
      <AgentState
        text={error}
        retry={() => {
          setError('')
          retry((value) => value + 1)
        }}
      />
    )
  if (directory === undefined) return <AgentLoading />
  if (!directory)
    return <AgentState text="Agents are unavailable in this workspace." />
  return (
    <>
      <TabToolbar>
        {canCreate ? (
          <Stack.Toolbar.Button icon="plus" accessibilityLabel="New agent" onPress={() => router.push('/agent-create')} />
        ) : null}
      </TabToolbar>
      <AgentDirectoryView
        agents={directory}
        workspaceId={workspaceId}
        theme={theme}
        dark={isDark}
        onCreate={canCreate ? () => router.push('/agent-create') : undefined}
        onOpen={(agent) => {
          if (workspaceId)
            void openAgentThread(workspaceId, agent.id)
              .then((result) => {
                if (result && getRequestWorkspaceId() === workspaceId)
                  router.push(`/dm/${result.conversationId}` as never)
              })
              .catch((reason) => setError(String(reason)))
        }}
      />
    </>
  )
}
