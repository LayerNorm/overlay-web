'use client'

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
} from 'react'
import Image from 'next/image'
import { X, ArrowRight, Copy, Check, Plus, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { IntegrationsDialog } from '@/features/integrations/components/IntegrationsDialog'
import { INTEGRATIONS_BC_CHANNEL, notifyIntegrationsChanged } from '@/shared/integrations/integrations-events'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

/** Paste in ChatGPT, Claude, etc., then paste the reply into Overlay to save as memories. */
export const ONBOARDING_IMPORT_MEMORY_PROMPT =
  'Tell me everything you know about me, list every memory you have.'

/** Popular connector keys shown as cards on the post-tour “Connect your tools” step. */
const ONBOARDING_CONNECTOR_CARDS: ReadonlyArray<{
  slug: string
  name: string
  description: string
  icon: string
}> = [
  {
    slug: 'googledrive',
    name: 'Google Drive',
    description: 'Search and manage Drive files',
    icon: '📁',
  },
  {
    slug: 'notion',
    name: 'Notion',
    description: 'Create pages and manage workspace',
    icon: '📝',
  },
  {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Compose, send, and search emails',
    icon: '📧',
  },
  {
    slug: 'googlecalendar',
    name: 'Google Calendar',
    description: 'Read and create calendar events',
    icon: '📅',
  },
  {
    slug: 'outlook',
    name: 'Outlook',
    description: 'Send emails and manage calendar',
    icon: '📨',
  },
  {
    slug: 'googlesheets',
    name: 'Google Sheets',
    description: 'Read, update, and create spreadsheets',
    icon: '📊',
  },
]

const DIALOG_SECONDARY_CLASS =
  'rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]'
const DIALOG_PRIMARY_CLASS =
  'rounded-lg bg-[var(--foreground)] px-4 py-1.5 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-40'

/** Logos from the configured integration provider catalog, with emoji fallback. */
function OnboardingConnectorCardLogo({
  name,
  fallbackEmoji,
  logoUrl,
}: {
  name: string
  fallbackEmoji: string
  logoUrl: string | null | undefined
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const showImage = Boolean(logoUrl) && !imgFailed

  return (
    <span className="mb-2 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]">
      {showImage ? (
        <Image
          src={logoUrl!}
          alt={name}
          width={28}
          height={28}
          unoptimized
          className="h-7 w-7 object-contain"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="text-lg leading-none" aria-hidden>{fallbackEmoji}</span>
      )}
    </span>
  )
}

export interface TourStep {
  /** data-tour attribute value of the target element */
  target: string
  title: string
  description: string
  /** Preferred tooltip placement relative to target */
  placement?: 'right' | 'left' | 'top' | 'bottom'
}

interface Props {
  steps: TourStep[]
  currentStep: number
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  onDone: () => void
  isClosing?: boolean
}

const PADDING = 10
const TOOLTIP_WIDTH = 300
const ARROW_SIZE = 8

interface Rect { top: number; left: number; width: number; height: number }

function getTargetRect(target: string): Rect | null {
  const els = document.querySelectorAll(`[data-tour="${target}"]`)
  if (els.length === 0) return null
  let minTop = Infinity, minLeft = Infinity, maxBottom = -Infinity, maxRight = -Infinity
  let hasVisible = false
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    hasVisible = true
    if (r.top < minTop) minTop = r.top
    if (r.left < minLeft) minLeft = r.left
    if (r.bottom > maxBottom) maxBottom = r.bottom
    if (r.right > maxRight) maxRight = r.right
  }
  if (!hasVisible) return null
  return {
    top: minTop - PADDING,
    left: minLeft - PADDING,
    width: (maxRight - minLeft) + PADDING * 2,
    height: (maxBottom - minTop) + PADDING * 2,
  }
}

function computeTooltipStyle(
  rect: Rect,
  placement: TourStep['placement'] = 'right',
): { style: CSSProperties; arrowStyle: CSSProperties; arrow: 'left' | 'right' | 'top' | 'bottom' } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const tw = TOOLTIP_WIDTH
  const th = 200

  let top = 0
  let left = 0
  let arrow: 'left' | 'right' | 'top' | 'bottom' = 'left'

  if (placement === 'right') {
    const candidate = rect.left + rect.width + 16
    if (candidate + tw < vw - 8) {
      left = candidate
      top = rect.top + rect.height / 2 - th / 2
      arrow = 'left'
    } else {
      left = rect.left - tw - 16
      top = rect.top + rect.height / 2 - th / 2
      arrow = 'right'
    }
  } else if (placement === 'left') {
    left = rect.left - tw - 16
    top = rect.top + rect.height / 2 - th / 2
    arrow = 'right'
    if (left < 8) {
      left = rect.left + rect.width + 16
      arrow = 'left'
    }
  } else if (placement === 'bottom') {
    top = rect.top + rect.height + 16
    left = rect.left + rect.width / 2 - tw / 2
    arrow = 'top'
    if (top + th > vh - 8) {
      top = rect.top - th - 16
      arrow = 'bottom'
    }
  } else {
    top = rect.top - th - 16
    left = rect.left + rect.width / 2 - tw / 2
    arrow = 'bottom'
    if (top < 8) {
      top = rect.top + rect.height + 16
      arrow = 'top'
    }
  }

  top = Math.max(8, Math.min(top, vh - th - 8))
  left = Math.max(8, Math.min(left, vw - tw - 8))

  const style: CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    top,
    left,
    width: tw,
  }

  const rectCenter = rect.left + rect.width / 2
  const clampedArrowOffset = Math.max(
    ARROW_SIZE * 2,
    Math.min(tw - ARROW_SIZE * 2, rectCenter - left),
  )

  const arrowStyle: CSSProperties = (() => {
    if (arrow === 'left') return {
      position: 'absolute',
      top: '50%',
      left: -ARROW_SIZE * 2,
      transform: 'translateY(-50%)',
      borderRight: `${ARROW_SIZE}px solid var(--surface-elevated)`,
      borderTop: `${ARROW_SIZE}px solid transparent`,
      borderBottom: `${ARROW_SIZE}px solid transparent`,
      borderLeft: 'none',
    }
    if (arrow === 'right') return {
      position: 'absolute',
      top: '50%',
      right: -ARROW_SIZE * 2,
      transform: 'translateY(-50%)',
      borderLeft: `${ARROW_SIZE}px solid var(--surface-elevated)`,
      borderTop: `${ARROW_SIZE}px solid transparent`,
      borderBottom: `${ARROW_SIZE}px solid transparent`,
      borderRight: 'none',
    }
    if (arrow === 'top') return {
      position: 'absolute',
      top: -ARROW_SIZE * 2,
      left: clampedArrowOffset - ARROW_SIZE,
      borderBottom: `${ARROW_SIZE}px solid var(--surface-elevated)`,
      borderTop: 'none',
      borderLeft: `${ARROW_SIZE}px solid transparent`,
      borderRight: `${ARROW_SIZE}px solid transparent`,
    }
    return {
      position: 'absolute',
      bottom: -ARROW_SIZE * 2,
      left: clampedArrowOffset - ARROW_SIZE,
      borderTop: `${ARROW_SIZE}px solid var(--surface-elevated)`,
      borderBottom: 'none',
      borderLeft: `${ARROW_SIZE}px solid transparent`,
      borderRight: `${ARROW_SIZE}px solid transparent`,
    }
  })()

  return { style, arrowStyle, arrow }
}

interface Frame { rect: Rect | null; stepIndex: number; spotlightRect: Rect | null }

type PostTourPhase = null | 'import-memories' | 'connectors'

export function OnboardingTour({
  steps,
  currentStep,
  onNext,
  onBack,
  onSkip,
  onDone,
  isClosing = false,
}: Props) {
  const router = useRouter()
  const step = steps[currentStep]
  const [postTourPhase, setPostTourPhase] = useState<PostTourPhase>(null)
  const [importPaste, setImportPaste] = useState('')
  const [memoryPromptCopied, setMemoryPromptCopied] = useState(false)
  const [connectorConnectingSlug, setConnectorConnectingSlug] = useState<string | null>(null)
  const [connectorLogos, setConnectorLogos] = useState<Record<string, string | null>>({})
  const [connectedSlugs, setConnectedSlugs] = useState<Set<string>>(new Set())
  const [integrationsPickerOpen, setIntegrationsPickerOpen] = useState(false)
  const [isImportSaving, setIsImportSaving] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [frame, setFrame] = useState<Frame>({ rect: null, stepIndex: -1, spotlightRect: null })
  const [backdropReady, setBackdropReady] = useState(false)
  const rafRef = useRef<number | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  const measure = useCallback((idx: number, target: string) => {
    const r = getTargetRect(target)
    setFrame(prev => ({ rect: r, stepIndex: idx, spotlightRect: r ?? prev.spotlightRect }))
  }, [])

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setBackdropReady(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useLayoutEffect(() => {
    if (!step || postTourPhase) return

    const idx = currentStep
    const target = step.target

    const doMeasure = () => {
      rafRef.current = null
      measure(idx, target)
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(doMeasure)
    })

    observerRef.current = new ResizeObserver(() => measure(idx, target))
    document.querySelectorAll(`[data-tour="${target}"]`).forEach(el => observerRef.current!.observe(el))
    observerRef.current.observe(document.body)

    const onResize = () => measure(idx, target)
    window.addEventListener('resize', onResize)
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      observerRef.current?.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [currentStep, step, measure, postTourPhase])

  // Open/close the model picker when step 0 is active
  useEffect(() => {
    if (currentStep !== 0 || isClosing) return
    const target = steps[currentStep]?.target ?? 'model-picker'
    // 1. Open the dropdown
    const t1 = window.setTimeout(() => {
      window.dispatchEvent(new Event('overlay:tour:open-model-picker'))
    }, 150)
    // 2. Re-measure after dropdown renders so querySelectorAll unions button + open dropdown
    const t2 = window.setTimeout(() => measure(currentStep, target), 300)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.dispatchEvent(new Event('overlay:tour:close-model-picker'))
    }
  }, [currentStep, isClosing, measure, steps])

  // Same provider-neutral catalog fetch as Extensions → loadCatalog.
  useEffect(() => {
    if (postTourPhase !== 'connectors') return
    let cancelled = false
    void (async () => {
      try {
        const res = await overlayAppClient.integrations.getResponse({ action: 'search', limit: 100 })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { items?: Array<{ slug: string; logoUrl?: string | null }> }
        const items = Array.isArray(data.items) ? data.items : []
        const next: Record<string, string | null> = {}
        for (const item of items) {
          next[item.slug] = item.logoUrl ?? null
        }
        if (!cancelled) setConnectorLogos(next)
      } catch {
        // keep emoji fallbacks
      }
    })()
    return () => {
      cancelled = true
    }
  }, [postTourPhase])

  // Track connected toolkits so cards reflect connections in real time after the
  // Provider setup completes in another tab and signals via focus/event refresh.
  useEffect(() => {
    if (postTourPhase !== 'connectors') return

    let cancelled = false
    async function loadConnected() {
      try {
        const res = await overlayAppClient.integrations.getResponse()
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { connected?: string[] }
        if (cancelled) return
        setConnectedSlugs(new Set(data.connected ?? []))
      } catch {
        // ignore
      }
    }

    void loadConnected()

    const onChanged = () => { void loadConnected() }
    window.addEventListener('overlay:integrations-changed', onChanged)
    window.addEventListener('focus', onChanged)
    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(INTEGRATIONS_BC_CHANNEL)
      bc.onmessage = onChanged
    } catch {
      // BroadcastChannel unsupported
    }

    return () => {
      cancelled = true
      window.removeEventListener('overlay:integrations-changed', onChanged)
      window.removeEventListener('focus', onChanged)
      bc?.close()
    }
  }, [postTourPhase])

  const finishPostTour = useCallback(() => {
    setPostTourPhase(null)
    setImportPaste('')
    setImportError(null)
    setIntegrationsPickerOpen(false)
    setConnectorLogos({})
    onDone()
  }, [onDone])

  const dialogConnect = useCallback(async (slug: string) => {
    const oauthTab = window.open('about:blank', '_blank')
    try {
      const res = await overlayAppClient.integrations.connectResponse({ action: 'connect', providerKey: slug })
      const data = (await res.json().catch(() => ({}))) as { redirectUrl?: string; connectionId?: string; error?: string }
      if (!res.ok) {
        oauthTab?.close()
        throw new Error(data.error || 'Failed to initiate connection')
      }
      if (data.redirectUrl) {
        if (oauthTab) oauthTab.location.href = data.redirectUrl
        else window.open(data.redirectUrl, '_blank')
        notifyIntegrationsChanged()
      } else if (data.connectionId) {
        oauthTab?.close()
        notifyIntegrationsChanged()
      } else {
        oauthTab?.close()
        throw new Error('No connection setup URL returned')
      }
    } catch (err) {
      oauthTab?.close()
      throw err
    }
  }, [])

  const dialogDisconnect = useCallback(async (slug: string) => {
    const res = await overlayAppClient.integrations.disconnectResponse(slug)
    if (!res.ok) throw new Error('Failed to disconnect')
    notifyIntegrationsChanged()
  }, [])

  const connectPopularConnector = useCallback(
    async (slug: string) => {
      if (connectorConnectingSlug) return
      setConnectorConnectingSlug(slug)
      try {
        await dialogConnect(slug)
      } catch {
        // Shows in OAuth / popup flow; user can retry or use Add to search
      } finally {
        setConnectorConnectingSlug(null)
      }
    },
    [connectorConnectingSlug, dialogConnect],
  )

  const goToConnectorsStep = useCallback(() => {
    setImportPaste('')
    setImportError(null)
    setPostTourPhase('connectors')
  }, [])

  const saveImportedMemories = useCallback(async () => {
    const text = importPaste.trim()
    if (!text || isImportSaving) return
    setIsImportSaving(true)
    setImportError(null)
    try {
      const res = await overlayAppClient.memory.createResponse({
        content: text,
        source: 'manual',
        actor: 'user',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to save' }))
        setImportError((err as { error?: string }).error ?? 'Failed to save memories')
        return
      }
      goToConnectorsStep()
    } finally {
      setIsImportSaving(false)
    }
  }, [importPaste, isImportSaving, goToConnectorsStep])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (postTourPhase === 'import-memories') {
        if (e.key === 'Escape') goToConnectorsStep()
        return
      }
      if (postTourPhase === 'connectors') {
        if (e.key === 'Escape') finishPostTour()
        return
      }
      if (e.key === 'Escape') onSkip()
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (currentStep < steps.length - 1) onNext()
        else {
          setPostTourPhase('import-memories')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    currentStep,
    steps.length,
    onNext,
    onSkip,
    postTourPhase,
    goToConnectorsStep,
    finishPostTour,
  ])

  if (!step) return null

  if (postTourPhase === 'import-memories') {
    return (
      <div
        className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/60 p-4"
        onClick={(e) => { if (e.target === e.currentTarget) goToConnectorsStep() }}
      >
        <div
          role="dialog"
          aria-labelledby="onboarding-import-title"
          className="w-[min(540px,92vw)] max-h-[min(90vh,720px)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-5 flex items-start justify-between gap-3">
            <h2 id="onboarding-import-title" className="text-base font-semibold text-[var(--foreground)]">
              Import memories from other assistants
            </h2>
            <button
              type="button"
              onClick={goToConnectorsStep}
              className="rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              aria-label="Skip import"
            >
              <X size={16} />
            </button>
          </div>
          <p className="mb-6 text-xs text-[var(--muted)]">
            Optional — bring over context from ChatGPT, Claude, or other tools. Copy the prompt, paste it there, then paste the reply below. We&apos;ll save it into your Overlay memories.
          </p>

          <div className="relative mb-6 flex gap-3">
            <div className="flex flex-col items-center">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--foreground)] text-[11px] font-semibold text-[var(--background)]">
                1
              </span>
              <div className="mt-1 w-px flex-1 min-h-[24px] bg-[var(--border)]" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="mb-2 text-xs font-medium text-[var(--foreground)]">
                Copy this prompt into a chat with your other AI provider
              </p>
              <div className="relative rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 pb-10 pt-3">
                <p className="text-xs leading-relaxed text-[var(--foreground)]">{ONBOARDING_IMPORT_MEMORY_PROMPT}</p>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(ONBOARDING_IMPORT_MEMORY_PROMPT)
                    setMemoryPromptCopied(true)
                    window.setTimeout(() => setMemoryPromptCopied(false), 2000)
                  }}
                  className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-[11px] text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
                >
                  {memoryPromptCopied ? <Check size={11} /> : <Copy size={11} />}
                  {memoryPromptCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--foreground)] text-[11px] font-semibold text-[var(--background)]">
              2
            </span>
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-xs font-medium text-[var(--foreground)]">
                Paste results below to add to Overlay memories
              </p>
              <textarea
                value={importPaste}
                onChange={(e) => setImportPaste(e.target.value)}
                placeholder="Paste your memory details here"
                rows={6}
                className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-xs text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--muted)]"
              />
              {importError ? (
                <p className="mt-2 text-xs text-red-500">{importError}</p>
              ) : null}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={goToConnectorsStep} className={DIALOG_SECONDARY_CLASS}>
              Skip
            </button>
            <button
              type="button"
              onClick={() => void saveImportedMemories()}
              disabled={!importPaste.trim() || isImportSaving}
              className={DIALOG_PRIMARY_CLASS}
            >
              {isImportSaving ? 'Saving…' : 'Add to memory'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (postTourPhase === 'connectors') {
    return (
      <>
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) finishPostTour() }}
        >
          <div
            role="dialog"
            aria-labelledby="onboarding-connectors-title"
            className="w-[min(520px,94vw)] max-h-[min(90vh,840px)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 id="onboarding-connectors-title" className="text-base font-semibold text-[var(--foreground)]">
                Connect your tools
              </h2>
              <button
                type="button"
                onClick={finishPostTour}
                className="rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-[var(--muted)]">
              Optional — connect apps you use with Overlay. Use Connect on a card below (same OAuth flow as Extensions), or{' '}
              <span className="text-[var(--foreground)]">Add</span> to search the full integration catalog.
            </p>

            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              {ONBOARDING_CONNECTOR_CARDS.map((c) => {
                const busy = connectorConnectingSlug === c.slug
                const anyBusy = connectorConnectingSlug !== null
                const isConnected = connectedSlugs.has(c.slug)
                return (
                  <div
                    key={c.slug}
                    className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 shadow-sm"
                  >
                    <OnboardingConnectorCardLogo
                      name={c.name}
                      fallbackEmoji={c.icon}
                      logoUrl={connectorLogos[c.slug]}
                    />
                    <p className="text-xs font-semibold text-[var(--foreground)]">{c.name}</p>
                    <p className="mb-2.5 mt-0.5 line-clamp-3 flex-1 text-[10px] leading-snug text-[var(--muted)]">
                      {c.description}
                    </p>
                    <button
                      type="button"
                      onClick={() => { if (!isConnected) void connectPopularConnector(c.slug) }}
                      disabled={anyBusy || isConnected}
                      className="mt-auto inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] text-[11px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)] disabled:opacity-100 disabled:hover:bg-[var(--surface-elevated)]"
                    >
                      {isConnected ? (
                        <>
                          <Check size={12} aria-hidden />
                          Connected
                        </>
                      ) : (
                        <>
                          {busy ? (
                            <Loader2 size={12} className="animate-spin" aria-hidden />
                          ) : null}
                          Connect
                        </>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>

            <button
              type="button"
              onClick={() => setIntegrationsPickerOpen(true)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)]/60 py-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              <Plus size={16} strokeWidth={2} className="text-[var(--muted)]" aria-hidden />
              Add integration
            </button>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={finishPostTour} className={DIALOG_SECONDARY_CLASS}>
                Skip
              </button>
              <button
                type="button"
                onClick={() => {
                  router.push('/app/tools')
                  finishPostTour()
                }}
                className={`${DIALOG_PRIMARY_CLASS} flex items-center gap-1.5`}
              >
                Open Extensions
              </button>
            </div>
          </div>
        </div>
        <IntegrationsDialog
          connectedSlugs={connectedSlugs}
          isOpen={integrationsPickerOpen}
          onClose={() => setIntegrationsPickerOpen(false)}
          onConnect={dialogConnect}
          onDisconnect={dialogDisconnect}
          overlayClassName="fixed inset-0 z-[10060] flex items-center justify-center bg-[var(--overlay-scrim)] p-5"
        />
      </>
    )
  }

  const rect = frame.stepIndex === currentStep ? frame.rect : null
  const spotlightRect = frame.spotlightRect

  const visible = frame.stepIndex === currentStep && frame.rect !== null && !isClosing
  const backdropOpacity = backdropReady && !isClosing ? 1 : 0

  const tooltipInfo = rect
    ? computeTooltipStyle(rect, step.placement ?? 'right')
    : null

  const isLast = currentStep === steps.length - 1

  return (
    <>
      {/* Backdrop with box-shadow cutout */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9998,
          pointerEvents: 'none',
          transition: 'opacity 400ms ease',
          opacity: backdropOpacity,
        }}
      >
        {spotlightRect && (
          <div
            style={{
              position: 'absolute',
              top: spotlightRect.top,
              left: spotlightRect.left,
              width: spotlightRect.width,
              height: spotlightRect.height,
              borderRadius: 8,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
              transition: 'top 400ms ease, left 400ms ease, width 400ms ease, height 400ms ease',
            }}
          />
        )}
        {spotlightRect && (
          <>
            {/* Block clicks to the app behind the tour; do not dismiss on backdrop (Skip / X only). */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: spotlightRect.top, pointerEvents: 'auto' }} />
            <div style={{ position: 'absolute', top: spotlightRect.top + spotlightRect.height, left: 0, right: 0, bottom: 0, pointerEvents: 'auto' }} />
            <div style={{ position: 'absolute', top: spotlightRect.top, left: 0, width: spotlightRect.left, height: spotlightRect.height, pointerEvents: 'auto' }} />
            <div style={{ position: 'absolute', top: spotlightRect.top, left: spotlightRect.left + spotlightRect.width, right: 0, height: spotlightRect.height, pointerEvents: 'auto' }} />
          </>
        )}
        {!spotlightRect && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }} />
        )}
      </div>

      {/* Tooltip card */}
      {tooltipInfo && (
        <div
          role="dialog"
          aria-label={`Onboarding step ${currentStep + 1} of ${steps.length}`}
          style={{
            ...tooltipInfo.style,
            opacity: visible ? 1 : 0,
            transform: visible ? 'scale(1)' : 'scale(0.95)',
            transition: 'opacity 400ms ease, transform 400ms ease',
          }}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5 shadow-2xl"
        >
          <div style={tooltipInfo.arrowStyle} aria-hidden />

          <div className="mb-3 flex items-start justify-between gap-3">
            <span className="text-[11px] font-medium tabular-nums text-[var(--muted)]">
              {currentStep + 1} / {steps.length}
            </span>
            <button
              type="button"
              onClick={onSkip}
              className="rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              aria-label="Close tour"
            >
              <X size={14} />
            </button>
          </div>

          <h3 className="mb-1.5 text-base font-semibold text-[var(--foreground)]">{step.title}</h3>
          <p className="mb-5 text-sm leading-relaxed text-[var(--muted)]">{step.description}</p>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onSkip}
              className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Skip tour
            </button>
            <div className="flex gap-2">
              {currentStep > 0 && (
                <button
                  type="button"
                  onClick={onBack}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-elevated)]"
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={isLast ? () => setPostTourPhase('import-memories') : onNext}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--foreground)] px-4 py-1.5 text-sm font-medium text-[var(--background)]"
              >
                {isLast ? (
                  <>Get started</>
                ) : (
                  <>Next <ArrowRight size={13} /></>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
