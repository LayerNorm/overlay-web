import { useEffect, useState } from 'react'
import type { FunctionArgs } from 'convex/server'
import { withUnreadActivity } from '../lib/sidebarChats'
import { agentsForCreatorScope } from '../../src/shared/agents/last-agent-by-workspace'
import { pinChiefs } from '../../src/shared/agents/chief-identity'
import type { SidebarAgent, SidebarChat } from '../components/shell/SidebarView'
import { api, subscribeConvex } from '../services/convexClient'
import { subscribeAllPages } from '../services/convexPagination'
import { subscribeAgents, subscribeAgentThreads, type ShellAgent } from '../services/shellService'

export function useShellAgents(workspaceId: string | null, scope: 'personal' | 'workspace') {
  const [agents, setAgents] = useState<Array<SidebarAgent & ShellAgent>>([])
  const [viewerPrincipalId, setViewerPrincipalId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset the previous workspace's subscription snapshot.
    setAgents([])
    setLoading(true)
    setError(null)
    if (!workspaceId) return
    let active = true
    const stops = new Map<string, () => void>()
    const fail = () => {
      if (active) {
        setError('Unable to load agents. Check your connection.')
        setLoading(false)
      }
    }
    const stopDirectory = subscribeAgents(
      workspaceId,
      (directory, principalId) => {
        if (!active) return
        setViewerPrincipalId(principalId)
        setLoading(false)
        setError(null)
        const ids = new Set(directory.map((agent) => agent.id))
        for (const [id, stop] of stops)
          if (!ids.has(id)) {
            stop()
            stops.delete(id)
          }
        setAgents((current) =>
          directory.map((agent) => ({
            ...agent,
            threads: current.find((item) => item.id === agent.id)?.threads ?? [],
            loading: current.find((item) => item.id === agent.id)?.loading ?? true,
          })),
        )
        for (const agent of directory) {
          if (stops.has(agent.id)) continue
          let threads: Parameters<Parameters<typeof subscribeAgentThreads>[2]>[0] = []
          let activity: Parameters<Parameters<typeof subscribeAgentThreads>[3]>[0] = []
          const emit = () => {
            if (active && ids.has(agent.id))
              setAgents((current) =>
                current.map((item) =>
                  item.id === agent.id
                    ? {
                        ...item,
                        loading: false,
                        threads: threads.map((thread) => ({
                          conversationId: thread.conversationId,
                          title: thread.title,
                          status:
                            activity.find(
                              (status) => status.conversationId === thread.conversationId,
                            )?.status ?? 'idle',
                        })),
                      }
                    : item,
                ),
              )
          }
          stops.set(
            agent.id,
            subscribeAgentThreads(
              workspaceId,
              agent.id,
              (value) => {
                threads = value
                emit()
              },
              (value) => {
                activity = value
                emit()
              },
              fail,
            ),
          )
        }
      },
      fail,
    )
    return () => {
      active = false
      stopDirectory()
      stops.forEach((stop) => stop())
    }
  }, [workspaceId])
  return {
    agents: pinChiefs(agentsForCreatorScope(agents, viewerPrincipalId, scope), viewerPrincipalId),
    loading,
    error,
  }
}

export function useShellChats(workspaceId: string | null, scope: 'personal' | 'workspace') {
  const [chats, setChats] = useState<SidebarChat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset the previous workspace's subscription snapshot.
    setChats([])
    setLoading(true)
    setError(null)
    if (!workspaceId) return
    let active = true
    let personal: SidebarChat[] = []
    let rooms: SidebarChat[] = []
    let notifications: Array<{ conversationId?: string; readAt?: number }> = []
    const emit = () => {
      if (active) {
        setChats(withUnreadActivity([...personal, ...rooms], notifications))
        setLoading(false)
        setError(null)
      }
    }
    const fail = () => {
      if (active) {
        setError('Unable to load conversations. Check your connection.')
        setLoading(false)
      }
    }
    const personalArgs: Omit<FunctionArgs<typeof api.chat.personal.list>, 'paginationOpts'> = {
      workspaceId,
      archived: false,
      scope,
    }
    const stopPersonal = subscribeAllPages(
      api.chat.personal.list,
      personalArgs,
      (rows) => {
        personal = rows.map((chat) => ({
          id: chat._id,
          title: chat.title,
          kind: 'personal',
          unread: chat.unread,
        }))
        emit()
      },
      fail,
    )
    const stopRooms =
      scope === 'workspace'
        ? subscribeConvex(
            api.collaboration.roomList.list,
            { workspaceId, kind: 'all', limit: 500 },
            (result) => {
              rooms = (result?.rooms ?? []).map((room) => ({
                id: room._id,
                title: room.title,
                kind: room.conversationType,
              }))
              emit()
            },
            fail,
          )
        : () => undefined
    const stopNotifications =
      scope === 'workspace'
        ? subscribeConvex(
            api.collaboration.activity.notifications,
            { workspaceId },
            (value) => {
              notifications = value ?? []
              emit()
            },
            fail,
          )
        : () => undefined
    return () => {
      active = false
      stopPersonal()
      stopRooms()
      stopNotifications()
    }
  }, [workspaceId, scope])
  return { chats, loading, error }
}
