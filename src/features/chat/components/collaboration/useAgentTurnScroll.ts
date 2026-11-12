'use client'

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { roomMessageDomId, type RoomMessageRecord } from './room-message-view'

/** Reserve only the space needed to start a new exchange at the viewport top. */
export function agentTurnSpacerHeight(viewportHeight: number, turnHeight: number) {
  return Math.max(0, viewportHeight - turnHeight)
}

export function useAgentTurnScroll({ enabled, conversationId, messages, listRef }: {
  enabled: boolean
  conversationId: string
  messages: RoomMessageRecord[]
  listRef: RefObject<HTMLDivElement | null>
}) {
  const spacerRef = useRef<HTMLDivElement>(null)
  const anchored = useRef(false)
  const turnRef = useRef<string | null>(null)
  const seenNonce = useRef<string | null>(null)
  const release = useCallback(() => {
    anchored.current = false
    turnRef.current = null
    if (spacerRef.current) spacerRef.current.style.height = '0px'
  }, [])

  useLayoutEffect(() => {
    release()
    seenNonce.current = null
  }, [conversationId, enabled, release])

  useLayoutEffect(() => {
    if (!enabled) return
    const pending = messages.findLast(message => message.authorKind === 'human'
      && !message.threadRootMessageId && message.delivery === 'sending' && message.clientNonce)
    const isNewTurn = Boolean(pending && pending.clientNonce !== seenNonce.current)
    if (isNewTurn && pending) {
      seenNonce.current = pending.clientNonce ?? null
      turnRef.current = pending.turnId
      anchored.current = true
    }
    const message = messages.find(row => row.turnId === turnRef.current)
    const node = listRef.current
    const spacer = spacerRef.current
    const target = message && document.getElementById(roomMessageDomId(message.id))
    if (!anchored.current || !node || !spacer || !target) {
      if (anchored.current && !message) release()
      return
    }
    const resize = () => {
      const padding = Number.parseFloat(getComputedStyle(node).paddingTop) || 0
      const top = target.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop - padding
      const turnHeight = node.scrollHeight - top - spacer.offsetHeight
      spacer.style.height = `${agentTurnSpacerHeight(node.clientHeight, turnHeight)}px`
      return top
    }
    const top = resize()
    if (isNewTurn) node.scrollTop = top
    const observer = new ResizeObserver(resize)
    observer.observe(node)
    if (spacer.parentElement) observer.observe(spacer.parentElement)
    return () => observer.disconnect()
  }, [enabled, listRef, messages, release])

  return { anchored, spacerRef, release }
}
