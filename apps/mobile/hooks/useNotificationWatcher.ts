import { useEffect, useRef } from 'react'
import { appJson } from '../services/appApi'
import {
  fetchNotificationPreferences,
  fetchNotifications,
} from '../services/collaborationService'
import { loadMobilePreferences } from '../services/mobilePreferencesService'
import { presentLocalBanner } from '../services/notificationsService'
import type {
  WorkspaceNotification,
  WorkspaceNotificationPreferences,
} from '@overlay/workspace-contracts'

/**
 * Foreground unread-notification watcher.
 *
 * Until server push exists (§9.3), this polls the unread notification feed and
 * fires local banners for newly arrived items. The server's per-category
 * 'banner' preference mode decides which notifications deserve a banner —
 * 'activity'-mode items land silently in the feed, matching web semantics.
 * 'invitation'/'participant' notifications have no pref key and always banner.
 */

const POLL_INTERVAL_MS = 30_000
const PREF_REFRESH_MS = 5 * 60_000
const MAX_BANNERS_PER_CYCLE = 3

type ConversationType = 'personal' | 'dm' | 'channel'

export function useNotificationWatcher(enabled: boolean): void {
  const seenIdsRef = useRef<Set<string> | null>(null)
  const prefsRef = useRef<{ value: WorkspaceNotificationPreferences; fetchedAt: number } | null>(null)
  const conversationTypeCacheRef = useRef<Map<string, ConversationType>>(new Map())

  useEffect(() => {
    if (!enabled) {
      seenIdsRef.current = null
      prefsRef.current = null
      conversationTypeCacheRef.current.clear()
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const getConversationType = async (conversationId: string): Promise<ConversationType> => {
      const cached = conversationTypeCacheRef.current.get(conversationId)
      if (cached) return cached
      try {
        const summary = await appJson<{ conversationType?: ConversationType }>(
          '/api/v1/conversations',
          { query: { conversationId } },
        )
        const type = summary.conversationType ?? 'personal'
        conversationTypeCacheRef.current.set(conversationId, type)
        return type
      } catch {
        return 'dm'
      }
    }

    const modeFor = async (
      notification: WorkspaceNotification,
    ): Promise<'activity' | 'banner' | 'off'> => {
      if (notification.type === 'invitation' || notification.type === 'participant') return 'banner'
      const prefs = prefsRef.current
      if (!prefs || Date.now() - prefs.fetchedAt > PREF_REFRESH_MS) {
        try {
          prefsRef.current = { value: await fetchNotificationPreferences(), fetchedAt: Date.now() }
        } catch {
          // Keep whatever we had; fall through to the last-known or default.
        }
      }
      const value = prefsRef.current?.value
      switch (notification.type) {
        case 'mention':
          return value?.mentions ?? 'activity'
        case 'thread':
          return value?.threadReplies ?? 'activity'
        case 'reaction':
          return value?.reactions ?? 'activity'
        case 'message': {
          if (!notification.conversationId) return 'activity'
          const type = await getConversationType(notification.conversationId)
          return type === 'dm' ? value?.dmMessages ?? 'activity' : value?.channelMessages ?? 'activity'
        }
        default:
          return 'activity'
      }
    }

    const poll = async (): Promise<void> => {
      const { notificationBannersEnabled } = await loadMobilePreferences()
      const unread = await fetchNotifications('unread', { unreadOnly: true, limit: 25 })
      if (cancelled) return
      const seen = seenIdsRef.current
      if (seen === null) {
        // First successful poll seeds the set — no banner storm on sign-in.
        seenIdsRef.current = new Set(unread.map((n) => n.id))
        return
      }
      const fresh = unread.filter((n) => !seen.has(n.id))
      fresh.forEach((n) => seen.add(n.id))
      if (!notificationBannersEnabled || fresh.length === 0) return
      // Newest first, capped so a burst doesn't stack a wall of banners.
      for (const notification of fresh.slice(0, MAX_BANNERS_PER_CYCLE)) {
        const mode = await modeFor(notification)
        if (cancelled || mode !== 'banner') continue
        await presentLocalBanner({
          title: notification.title,
          body: notification.body,
          data: {
            kind: 'workspace-notification',
            notificationId: notification.id,
            conversationId: notification.conversationId,
            threadRootMessageId: notification.threadRootMessageId,
          },
        })
      }
    }

    const schedule = () => {
      timer = setTimeout(() => {
        void poll()
          .catch(() => undefined)
          .finally(() => {
            if (!cancelled) schedule()
          })
      }, POLL_INTERVAL_MS)
    }

    void poll().catch(() => undefined).finally(schedule)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [enabled])
}
