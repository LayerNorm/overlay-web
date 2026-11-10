'use client'

import { Component, memo, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { ActionProvider, Renderer, StateProvider, VisibilityProvider, useStateStore } from '@json-render/react'
import type { GeneratedJsonRenderData } from '@overlay/chat-core/generated-ui'
import { GENERATIVE_UI_CATALOG_VERSION, validateJsonRenderSpec } from '@overlay/chat-core/generative-ui'
import { JsonRenderFailure, JsonRenderReadOnly, jsonRenderRegistry } from './json-render-registry'
import '../styles/json-render.css'

export type JsonRenderStateChange = { path: string; value: unknown }
export type JsonRenderActions = {
  onSendMessage?: (text: string, partId: string) => void | Promise<void>
  onSubmit?: (state: Record<string, unknown>, label: string | undefined, partId: string) => void | Promise<void>
  onStateChange?: (changes: JsonRenderStateChange[], partId: string) => void
}
export type JsonRenderCardProps = {
  partId: string
  data: GeneratedJsonRenderData
  readOnly?: boolean
  actions?: JsonRenderActions
}

function Fallback({ summary }: { summary: string }) {
  return <div className="json-render-part"><p>{summary}</p><p className="gen-fallback">Could not display this view</p></div>
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
      if (typeof params.text === 'string') await navigator.clipboard?.writeText(params.text)
    },
    open_link: (params: Record<string, unknown>) => {
      if (typeof params.url !== 'string' || !params.url.startsWith('https://')) return
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

function JsonRenderCardView({ partId, data, readOnly = false, actions }: JsonRenderCardProps) {
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
  const locked = readOnly || data.submittedAt !== undefined
  return <JsonRenderBoundary key={`${partId}:${data.specJson}`} summary={data.summary}>
    <div className="json-render-part">
      <JsonRenderReadOnly.Provider value={locked}>
        <StateProvider key={`${partId}:${data.specJson}`} initialState={state ?? parsed.spec.state ?? {}} onStateChange={(changes) => actions?.onStateChange?.(changes, partId)}>
          <VisibilityProvider><CardActions partId={partId} actions={actions} readOnly={locked}><Renderer spec={parsed.spec} registry={jsonRenderRegistry} /></CardActions></VisibilityProvider>
        </StateProvider>
      </JsonRenderReadOnly.Provider>
    </div>
  </JsonRenderBoundary>
}

export const JsonRenderCard = memo(JsonRenderCardView, (previous, next) =>
  previous.partId === next.partId && previous.readOnly === next.readOnly && previous.actions === next.actions
  && previous.data.catalogVersion === next.data.catalogVersion && previous.data.specJson === next.data.specJson
  && previous.data.stateJson === next.data.stateJson && previous.data.submittedAt === next.data.submittedAt
  && previous.data.summary === next.data.summary && previous.data.title === next.data.title)

export default JsonRenderCard
