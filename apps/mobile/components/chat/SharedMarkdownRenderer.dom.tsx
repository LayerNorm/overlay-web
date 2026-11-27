'use dom'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DOMProps } from 'expo/dom'
import { MarkdownMessage } from '../../../../packages/overlay-chat-react/src/components/MarkdownMessage'
import type { SharedMarkdownSnapshot } from '../../lib/sharedMarkdownBridge'
import {
  selectionNeedsReconstruction,
  textSelectionPoints,
  type SelectionNodes,
} from '../../lib/sharedMarkdownSelection'
import '../../assets/shared-markdown.generated.css'

type NativeAction = (value: string) => Promise<boolean>
type MarkdownMessageProps = React.ComponentProps<typeof MarkdownMessage>

interface Props {
  snapshot: SharedMarkdownSnapshot
  onLink: NativeAction
  onCopy: NativeAction
  dom?: DOMProps
}

interface ScrollSnapshot {
  top: number
  atBottom: boolean
}

interface SelectionSnapshot extends SelectionNodes<Node> {
  anchorMessageId: string
  anchorOffset: number
  focusMessageId: string
  focusOffset: number
}

function messageForNode(viewport: HTMLElement, node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement
  const message = element?.closest<HTMLElement>('[data-message-id]') ?? null
  return message && viewport.contains(message) ? message : null
}

function textOffset(root: HTMLElement, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null
  try {
    const range = document.createRange()
    range.selectNodeContents(root)
    range.setEnd(node, offset)
    return range.toString().length
  } catch {
    return null
  }
}

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) nodes.push(node as Text)
  return nodes
}

function messageById(viewport: HTMLElement, id: string): HTMLElement | null {
  return Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]'))
    .find((message) => message.dataset.messageId === id) ?? null
}

export default function SharedMarkdownRenderer({ snapshot, onLink, onCopy }: Props) {
  const viewportRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<ScrollSnapshot>({ top: 0, atBottom: true })
  const selectionRef = useRef<SelectionSnapshot | null>(null)
  const [notice, setNotice] = useState('')

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = snapshot.theme
  }, [snapshot.theme])

  const rememberSelection = useCallback(() => {
    const viewport = viewportRef.current
    const selection = window.getSelection()
    if (!viewport || !selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
      selectionRef.current = null
      return
    }
    const anchorMessage = messageForNode(viewport, selection.anchorNode)
    const focusMessage = messageForNode(viewport, selection.focusNode)
    const anchorOffset = anchorMessage && textOffset(anchorMessage, selection.anchorNode, selection.anchorOffset)
    const focusOffset = focusMessage && textOffset(focusMessage, selection.focusNode, selection.focusOffset)
    if (!anchorMessage || !focusMessage || anchorOffset === null || focusOffset === null) {
      selectionRef.current = null
      return
    }
    selectionRef.current = {
      anchorMessageId: anchorMessage.dataset.messageId ?? '',
      anchorOffset,
      focusMessageId: focusMessage.dataset.messageId ?? '',
      focusOffset,
      anchorNode: selection.anchorNode,
      focusNode: selection.focusNode,
    }
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', rememberSelection)
    return () => document.removeEventListener('selectionchange', rememberSelection)
  }, [rememberSelection])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (scrollRef.current.atBottom) {
      viewport.scrollTop = viewport.scrollHeight
      scrollRef.current.top = viewport.scrollTop
    } else {
      viewport.scrollTop = scrollRef.current.top
    }

    const saved = selectionRef.current
    if (!saved || !selectionNeedsReconstruction(saved, (node) => node.isConnected && viewport.contains(node))) return
    const anchorMessage = messageById(viewport, saved.anchorMessageId)
    const focusMessage = messageById(viewport, saved.focusMessageId)
    const points = anchorMessage && focusMessage && textSelectionPoints(
      textNodes(anchorMessage),
      saved.anchorOffset,
      textNodes(focusMessage),
      saved.focusOffset,
    )
    const selection = window.getSelection()
    if (points && selection) {
      selection.setBaseAndExtent(
        points.anchor.node,
        points.anchor.offset,
        points.focus.node,
        points.focus.offset,
      )
      rememberSelection()
    }
  }, [rememberSelection, snapshot.messages, snapshot.isStreaming, snapshot.theme])

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    scrollRef.current = {
      top: viewport.scrollTop,
      atBottom: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 32,
    }
  }, [])

  const reportAction = useCallback((action: NativeAction, value: string, success: string) => {
    void action(value)
      .then((accepted) => setNotice(accepted ? success : 'Link blocked'))
      .catch(() => setNotice('Action failed'))
  }, [])

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const copyButton = target.closest<HTMLButtonElement>('button[data-slot="code-block-copy-button"]')
    if (copyButton) {
      const code = copyButton.closest('[data-slot="code-block"]')
        ?.querySelector<HTMLElement>('[data-slot="code-block-content"]')
      const text = code?.innerText ?? code?.textContent ?? ''
      event.preventDefault()
      event.stopPropagation()
      if (text.length > 0) reportAction(onCopy, text, 'Copied')
      return
    }

    const link = target.closest<HTMLAnchorElement>('a[href]')
    if (!link) return
    const href = link.getAttribute('href')
    event.preventDefault()
    event.stopPropagation()
    if (href) reportAction(onLink, href, 'Link opened')
  }, [onCopy, onLink, reportAction])

  return (
    <main
      ref={viewportRef}
      className="shared-markdown-viewport"
      data-theme={snapshot.theme}
      data-streaming={snapshot.isStreaming ? 'true' : 'false'}
      aria-label="Shared Markdown conversation proof"
      onScroll={handleScroll}
      onClickCapture={handleClickCapture}
    >
      <div className="shared-markdown-messages">
        {snapshot.messages.length === 0 ? <p className="shared-markdown-empty">No messages.</p> : null}
        {snapshot.messages.map((message, index) => {
          const markdownProps: MarkdownMessageProps = {
            text: message.text,
            isStreaming: snapshot.isStreaming && index === snapshot.messages.length - 1,
            suppressTypingIndicator: true,
          }
          return (
            <article key={message.id} data-message-id={message.id} className="overlay-chat-surface shared-markdown-message">
              <MarkdownMessage {...markdownProps} />
            </article>
          )
        })}
      </div>
      {notice ? <div className="shared-markdown-notice" role="status">{notice}</div> : null}
    </main>
  )
}
