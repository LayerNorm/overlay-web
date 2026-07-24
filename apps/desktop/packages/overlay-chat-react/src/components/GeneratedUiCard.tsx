'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Mail,
  Maximize2,
  Plug,
  Save,
  X,
} from 'lucide-react'
import type {
  GeneratedConnectorData,
  GeneratedEmailDraftData,
  GeneratedTextDraftData,
  GeneratedUiData,
  GeneratedUiPart,
  GeneratedUiVariant,
} from '@overlay/chat-core/generated-ui'
import { generatedUiDataToPlainText } from '@overlay/chat-core/generated-ui'

export type GeneratedUiConnectorActions = {
  getLogoUrl?: (serviceName: string, slug?: string) => string | null
  isConnected?: (serviceName: string, slug?: string) => boolean
  connect?: (serviceName: string, slug?: string) => void | Promise<void>
  openExternalUrl?: (url: string) => void
  openEmailDraft?: (data: GeneratedEmailDraftData) => void
}

type GeneratedUiCardProps = {
  part: GeneratedUiPart
  readOnly?: boolean
  connectorActions?: GeneratedUiConnectorActions
  onDataChange?: (partId: string, data: GeneratedUiData) => void
}

function classNames(...items: Array<string | false | null | undefined>): string {
  return items.filter(Boolean).join(' ')
}

function arraysEqual(a?: string[], b?: string[]): boolean {
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return false
  for (let i = 0; i < (a?.length ?? 0); i++) {
    if (a![i] !== b![i]) return false
  }
  return true
}

function parseCsv(value: string): string[] | undefined {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length ? items : undefined
}

function formatCsv(value?: string[]): string {
  return value?.join(', ') ?? ''
}

function contentFilename(data: GeneratedUiData): string {
  if (data.kind === 'draft.email') return 'email-draft.txt'
  if (data.kind === 'connector.connect') return `${data.serviceName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'connector'}.txt`
  return `${(data.title || 'draft').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'draft'}.txt`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function ToolbarButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

function AutoTextarea({
  value,
  onChange,
  onBlur,
  minRows = 6,
  maxRows = 18,
}: {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  minRows?: number
  maxRows?: number
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const minHeight = minRows * 24
    const maxHeight = Math.max(minHeight, maxRows * 24)
    const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value, minRows, maxRows])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      rows={minRows}
      className="w-full resize-none overscroll-contain border-0 bg-transparent p-0 text-sm leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-light)]"
    />
  )
}

function ScrollableDraftBody({
  value,
  expanded,
  streaming,
  className,
}: {
  value: string
  expanded: boolean
  streaming: boolean
  className: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const followTailRef = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (!el || !streaming || !followTailRef.current) return
    el.scrollTop = el.scrollHeight
  }, [streaming, value])

  return (
    <div
      ref={ref}
      onScroll={() => {
        const el = ref.current
        if (!el) return
        followTailRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
      }}
      className={classNames(
        'overscroll-contain whitespace-pre-wrap text-sm leading-7 text-[var(--foreground)]',
        expanded ? 'max-h-[70vh] overflow-y-auto' : 'max-h-[28rem] overflow-y-auto',
        className,
      )}
    >
      {value}
    </div>
  )
}

function ConnectorLogo({
  serviceName,
  slug,
  logoUrl,
}: {
  serviceName: string
  slug?: string
  logoUrl?: string | null
}) {
  const [failed, setFailed] = useState(false)
  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={serviceName}
        width={24}
        height={24}
        className="h-6 w-6 object-contain"
        onError={() => setFailed(true)}
      />
    )
  }
  const letter = (serviceName || slug || 'C').trim().charAt(0).toUpperCase()
  return <span className="text-xs font-semibold text-[var(--foreground)]">{letter}</span>
}

function ActionButton({
  children,
  onClick,
  disabled,
  title,
  variant = 'secondary',
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  variant?: 'primary' | 'secondary'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={classNames(
        'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        variant === 'primary'
          ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)] hover:opacity-85'
          : 'border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)] hover:bg-[var(--border)]',
      )}
    >
      {children}
    </button>
  )
}

export function GeneratedUiCard({
  part,
  readOnly = false,
  connectorActions,
  onDataChange,
}: GeneratedUiCardProps) {
  const [data, setData] = useState<GeneratedUiData>(part.data)
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)
  const latestDataRef = useRef(data)
  const partIdRef = useRef(part.id)
  const incomingDataRef = useRef(part.data)
  const streaming = part.transient === true

  useEffect(() => {
    if (partIdRef.current !== part.id) {
      partIdRef.current = part.id
      incomingDataRef.current = part.data
      setData(part.data)
      latestDataRef.current = part.data
      setEditing(false)
      setExpanded(false)
      return
    }
    if (incomingDataRef.current === part.data) return
    incomingDataRef.current = part.data
    if (editing) return
    setData(part.data)
    latestDataRef.current = part.data
  }, [editing, part.id, part.data])

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
  }, [])

  function flush(nextData = latestDataRef.current) {
    if (readOnly || !onDataChange) return
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    onDataChange(part.id, nextData)
  }

  function update(nextData: GeneratedUiData, immediate = false) {
    latestDataRef.current = nextData
    setData(nextData)
    if (readOnly || !onDataChange) return
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    if (immediate) {
      onDataChange(part.id, nextData)
      return
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      onDataChange(part.id, latestDataRef.current)
    }, 700)
  }

  const plainText = useMemo(() => generatedUiDataToPlainText(data), [data])
  const canEdit = !readOnly && !streaming && (data.kind === 'draft.text' || data.kind === 'draft.email')

  async function handleCopy() {
    if (!plainText) return
    const ok = await copyText(plainText)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 900)
  }

  return (
    <div className="message-appear w-full max-w-[min(100%,46rem)] px-1 py-1" aria-busy={streaming}>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-sm">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
          <GeneratedUiHeader
            data={data}
            connectorActions={connectorActions}
            streaming={streaming}
          />
          <div className="flex shrink-0 items-center gap-1">
            {canEdit ? (
              <ToolbarButton
                label={editing ? 'Save edits' : 'Edit'}
                onClick={() => {
                  if (editing) flush()
                  setEditing((value) => !value)
                }}
              >
                {editing ? <Save size={15} strokeWidth={1.75} /> : <Edit3 size={15} strokeWidth={1.75} />}
              </ToolbarButton>
            ) : null}
            <ToolbarButton label="Copy" onClick={() => void handleCopy()}>
              {copied ? <Check size={15} strokeWidth={1.75} /> : <Copy size={15} strokeWidth={1.75} />}
            </ToolbarButton>
            {data.kind !== 'connector.connect' ? (
              <ToolbarButton label="Download" onClick={() => downloadText(contentFilename(data), plainText)}>
                <Download size={15} strokeWidth={1.75} />
              </ToolbarButton>
            ) : null}
            <ToolbarButton label={expanded ? 'Collapse' : 'Expand'} onClick={() => setExpanded((value) => !value)}>
              {expanded ? <ChevronDown size={15} strokeWidth={1.75} /> : <Maximize2 size={15} strokeWidth={1.75} />}
            </ToolbarButton>
          </div>
        </div>
        <div className="bg-[var(--surface-elevated)]">
          {data.kind === 'draft.text' ? (
            <TextDraftCardBody
              data={data}
              editing={editing}
              expanded={expanded}
              streaming={streaming}
              onBlur={() => flush()}
              onChange={update}
            />
          ) : data.kind === 'draft.email' ? (
            <EmailDraftCardBody
              data={data}
              editing={editing}
              expanded={expanded}
              connectorActions={connectorActions}
              readOnly={readOnly}
              streaming={streaming}
              onBlur={() => flush()}
              onChange={update}
            />
          ) : (
            <ConnectorCardBody
              data={data}
              connectorActions={connectorActions}
              readOnly={readOnly}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function GeneratedUiHeader({
  data,
  connectorActions,
  streaming,
}: {
  data: GeneratedUiData
  connectorActions?: GeneratedUiConnectorActions
  streaming: boolean
}) {
  if (data.kind === 'connector.connect') {
    const logoUrl = connectorActions?.getLogoUrl?.(data.serviceName, data.slug)
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]">
          <ConnectorLogo serviceName={data.serviceName} slug={data.slug} logoUrl={logoUrl} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--foreground)]">{data.serviceName}</p>
          <p className="truncate text-xs text-[var(--muted)]">Connector</p>
        </div>
      </div>
    )
  }
  if (data.kind === 'draft.email') {
    const logoUrl = data.provider === 'gmail' ? connectorActions?.getLogoUrl?.('Gmail', 'gmail') : null
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]">
          {logoUrl ? <ConnectorLogo serviceName="Gmail" slug="gmail" logoUrl={logoUrl} /> : <Mail size={16} strokeWidth={1.75} />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--foreground)]">{data.subject || 'Email draft'}</p>
          <p className="truncate text-xs text-[var(--muted)]">{streaming ? 'Drafting...' : 'Email draft'}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-[var(--foreground)]">{data.title || 'Text draft'}</p>
      <p className="truncate text-xs text-[var(--muted)]">{streaming ? 'Drafting...' : 'Editable draft'}</p>
    </div>
  )
}

function TextDraftCardBody({
  data,
  editing,
  expanded,
  streaming,
  onChange,
  onBlur,
}: {
  data: GeneratedTextDraftData
  editing: boolean
  expanded: boolean
  streaming: boolean
  onChange: (data: GeneratedUiData) => void
  onBlur: () => void
}) {
  if (editing) {
    return (
      <div className="space-y-3 px-5 py-5">
        <input
          value={data.title ?? ''}
          onChange={(event) => onChange({ ...data, title: event.target.value || undefined })}
          onBlur={onBlur}
          placeholder="Title"
          className="w-full border-0 bg-transparent text-sm font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted-light)]"
        />
        <AutoTextarea
          value={data.body}
          onChange={(body) => onChange({ ...data, body })}
          onBlur={onBlur}
          minRows={10}
          maxRows={expanded ? 28 : 18}
        />
      </div>
    )
  }
  return (
    <ScrollableDraftBody
      value={data.body}
      expanded={expanded}
      streaming={streaming}
      className="px-5 py-5"
    />
  )
}

function EmailField({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
}) {
  return (
    <label className="grid grid-cols-[4rem_1fr] items-center border-b border-[var(--border)] px-4 py-2 text-sm">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="min-w-0 border-0 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-light)]"
      />
    </label>
  )
}

function EmailDraftCardBody({
  data,
  editing,
  expanded,
  connectorActions,
  readOnly,
  streaming,
  onChange,
  onBlur,
}: {
  data: GeneratedEmailDraftData
  editing: boolean
  expanded: boolean
  connectorActions?: GeneratedUiConnectorActions
  readOnly: boolean
  streaming: boolean
  onChange: (data: GeneratedUiData, immediate?: boolean) => void
  onBlur: () => void
}) {
  const gmailConnected = connectorActions?.isConnected?.('Gmail', 'gmail') ?? false
  const gmailLogo = connectorActions?.getLogoUrl?.('Gmail', 'gmail')
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)

  function applyVariant(variant: GeneratedUiVariant) {
    setActiveVariantId(variant.id)
    onChange({
      ...data,
      subject: variant.subject ?? data.subject,
      body: variant.body,
    }, true)
  }

  return (
    <div>
      {data.variants?.length ? (
        <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-3 py-2">
          {data.variants.map((variant) => (
            <button
              key={variant.id}
              type="button"
              onClick={readOnly ? undefined : () => applyVariant(variant)}
              disabled={readOnly}
              className={classNames(
                'inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors disabled:cursor-default',
                activeVariantId === variant.id
                  ? 'bg-[var(--foreground)] text-[var(--background)]'
                  : readOnly
                    ? 'bg-[var(--surface-subtle)] text-[var(--muted)]'
                    : 'bg-[var(--surface-subtle)] text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--foreground)]',
              )}
            >
              {variant.label}
            </button>
          ))}
        </div>
      ) : null}
      {editing ? (
        <div>
          <EmailField
            label="To"
            value={formatCsv(data.to)}
            onChange={(value) => {
              const next = parseCsv(value)
              if (!arraysEqual(next, data.to)) onChange({ ...data, to: next })
            }}
            onBlur={onBlur}
          />
          <EmailField
            label="Cc"
            value={formatCsv(data.cc)}
            onChange={(value) => {
              const next = parseCsv(value)
              if (!arraysEqual(next, data.cc)) onChange({ ...data, cc: next })
            }}
            onBlur={onBlur}
          />
          <EmailField
            label="Subject"
            value={data.subject}
            onChange={(subject) => onChange({ ...data, subject })}
            onBlur={onBlur}
          />
          <div className="px-4 py-4">
            <AutoTextarea
              value={data.body}
              onChange={(body) => onChange({ ...data, body })}
              onBlur={onBlur}
              minRows={10}
              maxRows={expanded ? 28 : 18}
            />
          </div>
        </div>
      ) : (
        <div>
          <div className="space-y-1 border-b border-[var(--border)] px-4 py-3 text-sm">
            {data.to?.length ? <p><span className="text-[var(--muted)]">To:</span> {data.to.join(', ')}</p> : null}
            {data.cc?.length ? <p><span className="text-[var(--muted)]">Cc:</span> {data.cc.join(', ')}</p> : null}
            <p><span className="text-[var(--muted)]">Subject:</span> {data.subject}</p>
          </div>
          <ScrollableDraftBody
            value={data.body}
            expanded={expanded}
            streaming={streaming}
            className="px-4 py-4"
          />
        </div>
      )}
      {!readOnly && data.provider === 'gmail' ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-3 py-3">
          {gmailConnected && connectorActions?.openEmailDraft ? (
            <ActionButton
              onClick={() => connectorActions.openEmailDraft?.(data)}
              variant="primary"
            >
              {gmailLogo ? <ConnectorLogo serviceName="Gmail" slug="gmail" logoUrl={gmailLogo} /> : <Mail size={14} strokeWidth={1.75} />}
              Open in Gmail
            </ActionButton>
          ) : connectorActions?.connect ? (
            <ActionButton onClick={() => void connectorActions.connect?.('Gmail', 'gmail')} variant="primary">
              {gmailLogo ? <ConnectorLogo serviceName="Gmail" slug="gmail" logoUrl={gmailLogo} /> : <Mail size={14} strokeWidth={1.75} />}
              Connect Gmail
            </ActionButton>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ConnectorCardBody({
  data,
  connectorActions,
  readOnly,
}: {
  data: GeneratedConnectorData
  connectorActions?: GeneratedUiConnectorActions
  readOnly: boolean
}) {
  const slug = data.slug || data.serviceName.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const isConnected = data.connected || connectorActions?.isConnected?.(data.serviceName, slug) || false
  const logoUrl = connectorActions?.getLogoUrl?.(data.serviceName, data.slug)

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]">
          <ConnectorLogo serviceName={data.serviceName} slug={data.slug} logoUrl={logoUrl} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--foreground)]">{data.serviceName}</p>
          <p className="mt-1 max-w-xl text-sm leading-5 text-[var(--muted)]">
            {data.description || 'Connect this integration to use it in Overlay.'}
          </p>
        </div>
      </div>
      {readOnly ? null : isConnected ? (
        <span className="inline-flex h-9 w-fit shrink-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-xs font-medium text-[var(--muted)]">
          <Check size={14} strokeWidth={1.75} />
          Connected
        </span>
      ) : data.connectUrl ? (
        <ActionButton onClick={() => connectorActions?.openExternalUrl?.(data.connectUrl!)} disabled={!connectorActions?.openExternalUrl} variant="primary">
          <ExternalLink size={14} strokeWidth={1.75} />
          Connect
        </ActionButton>
      ) : slug && connectorActions?.connect ? (
        <ActionButton onClick={() => void connectorActions.connect?.(data.serviceName, slug)} variant="primary">
          <Plug size={14} strokeWidth={1.75} />
          Connect
        </ActionButton>
      ) : (
        <ActionButton onClick={() => void copyText(data.serviceName)} disabled>
          <X size={14} strokeWidth={1.75} />
          Unavailable
        </ActionButton>
      )}
    </div>
  )
}
