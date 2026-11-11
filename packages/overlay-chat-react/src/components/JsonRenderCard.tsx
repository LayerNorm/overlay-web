'use client'

import { Component, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActionProvider, Renderer, StateProvider, VisibilityProvider, useStateStore } from '@json-render/react'
import type { GeneratedJsonRenderData } from '@overlay/chat-core/generated-ui'
import { GENERATIVE_UI_CATALOG_VERSION, validateJsonRenderSpec } from '@overlay/chat-core/generative-ui'
import { JsonRenderFailure, JsonRenderReadOnly, jsonRenderRegistry } from './json-render-registry'
import '../styles/json-render.css'
import { useGeneratedUiSendMessage } from './Questionnaire'

export type JsonRenderStateChange = { path: string; value: unknown }
export type JsonRenderActions = {
  onDataChange?: (partId: string, data: GeneratedJsonRenderData) => void | Promise<void>
  onSendMessage?: (text: string, partId: string) => void | Promise<void>
  onSubmit?: (state: Record<string, unknown>, label: string | undefined, partId: string) => void | Promise<void>
  onStateChange?: (changes: JsonRenderStateChange[], partId: string) => void
}
export type JsonRenderCardProps = {
  partId: string
  data: GeneratedJsonRenderData
  readOnly?: boolean
  actions?: JsonRenderActions
  onDataChange?: (partId: string, data: GeneratedJsonRenderData) => void | Promise<void>
}

export function formatJsonRenderSubmission(state: Record<string, unknown>, label?: string): string {
  const lines: string[] = []
  function visit(value: unknown, path: string) {
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')
        const name = words.charAt(0).toUpperCase() + words.slice(1)
        visit(item, path ? `${path} / ${name}` : name)
      }
    } else lines.push(`${path}: ${typeof value === 'boolean' ? value ? 'Yes' : 'No' : value == null ? '(empty)' : String(value)}`)
  }
  visit(state, '')
  return [label?.trim() || 'Form submitted', ...lines].join('\n')
}

export function seedMissingGeneratedUiState(
  seed: Record<string, unknown>,
  get: (path: string) => unknown,
  set: (path: string, value: unknown) => void,
): void {
  const visit = (value: unknown, path: string) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
      for (const [key, child] of Object.entries(value)) visit(child, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`)
    } else if (get(path) === undefined) set(path, value)
  }
  for (const [key, value] of Object.entries(seed)) visit(value, `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`)
}

function Fallback({ summary }: { summary: string }) {
  return <div className="json-render-part"><p>{summary}</p><p className="gen-fallback">Could not display this view</p></div>
}

function FinalStateSeed({ seed, streaming }: { seed?: Record<string, unknown>; streaming: boolean }) {
  const { get, set } = useStateStore()
  const seeded = useRef(false)
  useEffect(() => {
    if (streaming || seeded.current || !seed) return
    seeded.current = true
    seedMissingGeneratedUiState(seed, get, set)
  }, [get, seed, set, streaming])
  return null
}

export class JsonRenderBoundary extends Component<{ summary: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  reportFailure = () => { this.setState({ failed: true }) }
  render() { return this.state.failed ? <Fallback summary={this.props.summary} /> : <JsonRenderFailure.Provider value={this.reportFailure}>{this.props.children}</JsonRenderFailure.Provider> }
}

function CardActions({ partId, actions, readOnly, children }: { partId: string; actions?: JsonRenderActions; readOnly: boolean; children: ReactNode }) {
  const { getSnapshot } = useStateStore()
  const latest = useRef({ partId, actions, readOnly })
  useLayoutEffect(() => { latest.current = { partId, actions, readOnly } }, [partId, actions, readOnly])
  const handlers = useMemo(() => ({
    copy_text: async (params: Record<string, unknown>) => {
      if (!latest.current.readOnly && typeof params.text === 'string') await navigator.clipboard?.writeText(params.text)
    },
    open_link: (params: Record<string, unknown>) => {
      if (latest.current.readOnly || typeof params.url !== 'string' || !params.url.startsWith('https://')) return
      const url = new URL(params.url)
      if (url.protocol === 'https:' && !url.username && !url.password) window.open(url.href, '_blank', 'noopener,noreferrer')
    },
    send_message: async (params: Record<string, unknown>) => {
      if (!latest.current.readOnly && typeof params.text === 'string') await latest.current.actions?.onSendMessage?.(params.text, latest.current.partId)
    },
    submit: async (params: Record<string, unknown>) => {
      if (!latest.current.readOnly) await latest.current.actions?.onSubmit?.(getSnapshot(), typeof params.label === 'string' ? params.label : undefined, latest.current.partId)
    },
  }), [getSnapshot])
  return <ActionProvider handlers={handlers}>{children}</ActionProvider>
}

function JsonRenderCardView({ partId, data, readOnly = false, actions, onDataChange = actions?.onDataChange }: JsonRenderCardProps) {
  const composerSend = useGeneratedUiSendMessage()
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string>()
  const pending = useRef<GeneratedJsonRenderData | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busy = useRef(false)
  const writeTail = useRef(Promise.resolve())
  const latest = useRef({ data, readOnly, onDataChange, actions, composerSend })
  useLayoutEffect(() => { latest.current = { data, readOnly, onDataChange, actions, composerSend } })
  const persist = useMemo(() => (next: GeneratedJsonRenderData) => {
    const save = latest.current.onDataChange
    writeTail.current = writeTail.current.catch(() => {}).then(async () => { await save?.(partId, next) })
    return writeTail.current
  }, [partId])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (pending.current && !latest.current.readOnly) void persist(pending.current).catch(() => {})
  }, [persist])
  const boundActions = useMemo<JsonRenderActions>(() => ({
    onSendMessage: async (text, id) => {
      const current = latest.current
      if (current.readOnly || current.data.submittedAt !== undefined || busy.current) return
      const send = current.actions?.onSendMessage ?? current.composerSend
      if (!send) return
      busy.current = true
      try { await send(text, id); setError(undefined) } catch { setError('Could not send this message. Try sending it from the composer.') } finally { busy.current = false }
    },
    onStateChange: (changes, id) => latest.current.actions?.onStateChange?.(changes, id),
    onSubmit: async (state, label, id) => {
      const current = latest.current
      if (current.readOnly || current.data.submittedAt !== undefined || busy.current) return
      const send = current.actions?.onSendMessage ?? current.composerSend
      if (!current.onDataChange || (!send && !current.actions?.onSubmit)) return
      busy.current = true
      setSubmitted(true)
      if (timer.current) clearTimeout(timer.current)
      pending.current = null
      let saved = false
      try {
        await persist({ ...current.data, stateJson: JSON.stringify(state), submittedAt: Date.now() })
        saved = true
        if (current.actions?.onSubmit) await current.actions.onSubmit(state, label, id)
        else await send!(formatJsonRenderSubmission(state, label), id)
        setError(undefined)
      } catch { setError(saved ? 'Your values were saved, but the message could not be sent. Send your response from the composer.' : 'Could not save this response. Please try again.') }
      finally { if (!saved) { busy.current = false; setSubmitted(false) } }
    },
  }), [persist])
  const parsed = useMemo(() => {
    try { return validateJsonRenderSpec(JSON.parse(data.specJson)) } catch { return null }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Different transcript parts need independent parse caches.
  }, [partId, data.specJson])
  const state = useMemo(() => {
    if (!data.stateJson) return undefined
    try {
      const value: unknown = JSON.parse(data.stateJson)
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    } catch { return null }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Different transcript parts need independent state seeds.
  }, [partId, data.stateJson])
  if (data.catalogVersion !== GENERATIVE_UI_CATALOG_VERSION || !parsed?.ok || state === null) return <Fallback summary={data.summary} />
  const locked = readOnly || data.streaming === true || submitted || data.submittedAt !== undefined
  return <JsonRenderBoundary key={partId} summary={data.summary}>
    <div className="json-render-part">
      <JsonRenderReadOnly.Provider value={locked}>
        {data.streaming ? <p className="gen-building-view" role="status">Building view</p> : null}
        <StateProvider key={partId} initialState={state ?? parsed.spec.state ?? {}} onStateChange={(changes) => boundActions.onStateChange?.(changes, partId)}>
          <FinalStateSeed seed={!data.stateJson ? parsed.spec.state : undefined} streaming={data.streaming === true} />
          <StatePersistence onChange={(snapshot) => {
            if (locked || !onDataChange) return
            pending.current = { ...data, stateJson: JSON.stringify(snapshot) }
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
              const next = pending.current
              pending.current = null
              if (next && !latest.current.readOnly) void persist(next).then(() => setError(undefined)).catch(() => setError('Could not save this view.'))
            }, 700)
          }} />
          <VisibilityProvider><CardActions partId={partId} actions={onDataChange ? boundActions : actions} readOnly={locked}><Renderer spec={parsed.spec} registry={jsonRenderRegistry} /></CardActions></VisibilityProvider>
        </StateProvider>
        {error ? <p role="alert" className="text-sm text-muted-foreground">{error}</p> : null}
      </JsonRenderReadOnly.Provider>
    </div>
  </JsonRenderBoundary>
}

export const JsonRenderCard = memo(JsonRenderCardView, (previous, next) =>
  previous.partId === next.partId && previous.readOnly === next.readOnly && previous.actions === next.actions && previous.onDataChange === next.onDataChange
  && previous.data.catalogVersion === next.data.catalogVersion && previous.data.specJson === next.data.specJson
  && previous.data.stateJson === next.data.stateJson && previous.data.submittedAt === next.data.submittedAt
  && previous.data.summary === next.data.summary && previous.data.title === next.data.title
  && previous.data.streaming === next.data.streaming)

export default JsonRenderCard

function StatePersistence({ onChange }: { onChange: (state: Record<string, unknown>) => void }) {
  const { state, getSnapshot } = useStateStore()
  const callback = useRef(onChange)
  const previous = useRef(state)
  useLayoutEffect(() => { callback.current = onChange })
  useLayoutEffect(() => {
    if (previous.current === state) return
    previous.current = state
    callback.current(getSnapshot())
  }, [state, getSnapshot])
  return null
}
