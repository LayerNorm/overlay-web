import { desktopAppJson } from './app-api-client'

/**
 * Collaboration activity (mentions, replies, invitations) for the chats
 * Activity subview. Backed by the workspace-scoped notifications endpoint;
 * fetched on demand only — never polled — so it stays out of the shared
 * rate-limit bucket's steady-state traffic.
 */
export interface DesktopNotification {
  id: string
  type: string
  title: string
  body?: string
  conversationId?: string
  createdAt: number
  readAt?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeNotification(value: unknown): DesktopNotification | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id : null
  const title = typeof value.title === 'string' ? value.title : null
  if (!id || !title) return null
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : 0
  return {
    id,
    type: typeof value.type === 'string' ? value.type : 'message',
    title,
    body: typeof value.body === 'string' ? value.body : undefined,
    conversationId:
      typeof value.conversationId === 'string' ? value.conversationId : undefined,
    createdAt,
    readAt: typeof value.readAt === 'number' ? value.readAt : undefined
  }
}

export async function fetchNotifications(): Promise<DesktopNotification[]> {
  const raw = await desktopAppJson<unknown>('/api/v1/conversations/notifications?limit=50')
  const list = isRecord(raw) && Array.isArray(raw.notifications) ? raw.notifications : []
  return list
    .map(normalizeNotification)
    .filter((item): item is DesktopNotification => item !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function markNotificationsRead(notificationIds?: string[]): Promise<void> {
  await desktopAppJson<unknown>('/api/v1/conversations/notifications', {
    method: 'PATCH',
    body: JSON.stringify(notificationIds?.length ? { notificationIds } : {})
  })
}
