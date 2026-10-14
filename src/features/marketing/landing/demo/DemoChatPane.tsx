'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DIcon } from './demo-icons'
import { Message, TypingRow } from './DemoMessages'
import type { Conversation } from './demo-state'

/**
 * The chat half of the demo: header, message history (opens on the latest
 * message) and a working composer. Sending is delegated to the parent so it can
 * script the reply.
 */
export function ChatPane({
  conv,
  typing,
  head,
  onSend,
}: {
  conv: Conversation
  typing: boolean
  head: ReactNode
  onSend: (text: string) => void
}) {
  const [draft, setDraft] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const toBottom = () => {
      box.scrollTop = box.scrollHeight
    }
    toBottom()
    void document.fonts?.ready.then(toBottom)
  }, [conv.key, conv.msgs.length, typing])

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    onSend(text)
  }

  return (
    <>
      <div className="head">{head}</div>
      <div className="chat">
        <div className="msgs" ref={boxRef}>
          <div className="col">
            <div className="daydiv">TODAY</div>
            {conv.msgs.map((m, i) => <Message key={i} m={m} who={conv.who} plain={conv.plain} />)}
            {typing ? <TypingRow who={conv.who} plain={conv.plain} /> : null}
          </div>
        </div>
        <div className="cwrap">
          <div className="composer" onClick={() => inputRef.current?.focus({ preventScroll: true })}>
            <input
              ref={inputRef}
              type="text"
              value={draft}
              placeholder={conv.placeholder}
              autoComplete="off"
              spellCheck={false}
              aria-label={conv.placeholder}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            <div className="bar">
              <DIcon name="plus" />
              <DIcon name="at" />
              <button type="button" className="send" aria-label="Send message" onClick={submit}><DIcon name="send" /></button>
            </div>
          </div>
          <div className="note">Overlay can make mistakes. Check important info.</div>
        </div>
      </div>
    </>
  )
}
