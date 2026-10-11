'use client'

import { useEffect, useReducer, useRef } from 'react'
import { DIcon } from './demo-icons'
import { ChatPane } from './DemoChatPane'
import { ExtensionsPage, FilesPage, ModelMenu } from './DemoPages'
import { DemoList, DemoRail } from './DemoSidebars'
import { Creature } from '@/components/orb/Creature'
import { createInitialState, demoReducer, selectConversation, type DemoAction, type DemoState } from './demo-state'

/** The app is drawn on a fixed 1000-wide canvas and scaled to the frame. */
const CANVAS_W = 1000
const REPLY_DELAY_MS = 1200

const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function MainPane({ state, dispatch, onSend }: { state: DemoState; dispatch: (a: DemoAction) => void; onSend: (text: string) => void }) {
  const conv = selectConversation(state)
  if (state.view === 'files') return <FilesPage state={state} />
  if (state.view === 'extensions') return <ExtensionsPage state={state} dispatch={dispatch} />
  let head
  if (state.view === 'agents') {
    head = (
      <>
        <span className="who"><span className="cr"><Creature shape={conv.who.shape} color={conv.who.color} size={17} animated={false} /></span>{conv.who.name}</span>
        <span className="tools"><span><DIcon name="gear" /></span><span><DIcon name="share" />Share</span><span><DIcon name="users" />2</span></span>
      </>
    )
  } else {
    const title = state.view === 'chats' ? state.chats[state.chat].title : state.autos[state.auto].title
    head = (
      <>
        <span className="who">{state.view === 'chats' ? <DIcon name="chat" /> : null}{title}</span>
        <span className="tools"><ModelMenu state={state} dispatch={dispatch} /></span>
      </>
    )
  }
  return <ChatPane key={conv.key} conv={conv} typing={state.typing === conv.key} head={head} onSend={onSend} />
}

/** A miniature, working copy of the Overlay app. Nothing here talks to a server. */
export function HeroDemo() {
  const frameRef = useRef<HTMLDivElement>(null)
  const replyCount = useRef(0)
  const timers = useRef<number[]>([])
  const [state, dispatch] = useReducer(demoReducer, undefined, createInitialState)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const fit = () => frame.style.setProperty('--ds', String(frame.clientWidth / CANVAS_W))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(frame)
    const pending = timers.current
    return () => {
      ro.disconnect()
      pending.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  const onSend = (text: string) => {
    const conv = selectConversation(stateRef.current)
    dispatch({ type: 'send', key: conv.key, text, time: clock() })
    const t = window.setTimeout(() => {
      const reply = conv.replies[replyCount.current++ % conv.replies.length]
      dispatch({ type: 'reply', key: conv.key, text: reply, time: clock() })
    }, REPLY_DELAY_MS)
    timers.current.push(t)
  }

  return (
    <div className="demo" data-lp="demo" ref={frameRef}>
      <div className="app">
        <DemoRail state={state} dispatch={dispatch} />
        <DemoList state={state} dispatch={dispatch} />
        <div className="main"><MainPane state={state} dispatch={dispatch} onSend={onSend} /></div>
      </div>
    </div>
  )
}
