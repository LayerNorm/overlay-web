'use client'
import { unstyledButton, unstyledTextarea } from '@overlay/ui/control-reset'
import { Button, Textarea } from '@overlay/ui/primitives'

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
import { Dialog, DialogContent } from '@overlay/ui'
import { INTEGRATIONS_BC_CHANNEL, notifyIntegrationsChanged } from '@/shared/integrations/integrations-events'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { safeHttpUrl } from '@/shared/security/safe-url'

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
  'rounded-lg border border-(--border) bg-transparent px-3 py-1.5 text-sm font-medium text-(--foreground) transition-colors hover:bg-(--surface-subtle)'
const DIALOG_PRIMARY_CLASS =
  'rounded-lg bg-(--foreground) px-4 py-1.5 text-sm font-medium text-(--background) transition-opacity hover:opacity-90 disabled:opacity-40'

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
    <span className="mb-2 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-(--border) bg-(--surface-elevated)">
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
  memoryEnabled?: boolean
  integrationsEnabled?: boolean
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

function usePostTourPhase({
  currentStep,
  stepsLength,
  onNext,
  onSkip,
  onDone,
  memoryEnabled,
  integrationsEnabled,
}: {
  currentStep: number
  stepsLength: number
  onNext: () => void
  onSkip: () => void
  onDone: () => void
  memoryEnabled: boolean
  integrationsEnabled: boolean
}) {
  const [postTourPhase, setPostTourPhase] = useState<PostTourPhase>(null)

  const finishPostTour = useCallback(() => {
    setPostTourPhase(null)
    onDone()
  }, [onDone])

  const goToConnectorsStep = useCallback(() => {
    setPostTourPhase('connectors')
  }, [])

  const finishImportStep = useCallback(() => {
    if (integrationsEnabled) goToConnectorsStep()
    else finishPostTour()
  }, [finishPostTour, goToConnectorsStep, integrationsEnabled])

  const beginPostTour = useCallback(() => {
    if (memoryEnabled) setPostTourPhase('import-memories')
    else if (integrationsEnabled) setPostTourPhase('connectors')
    else finishPostTour()
  }, [finishPostTour, integrationsEnabled, memoryEnabled])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (postTourPhase) return
      if (e.key === 'Escape') onSkip()
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (currentStep < stepsLength - 1) onNext()
        else {
          beginPostTour()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    currentStep,
    stepsLength,
    onNext,
    onSkip,
    postTourPhase,
    finishImportStep,
    finishPostTour,
    beginPostTour,
  ])

  return { postTourPhase, beginPostTour, finishImportStep, finishPostTour }
}

function ImportMemoriesStep({ onFinish }: { onFinish: () => void }) {
  const [importPaste, setImportPaste] = useState('')
  const [memoryPromptCopied, setMemoryPromptCopied] = useState(false)
  const [isImportSaving, setIsImportSaving] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

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
      onFinish()
    } finally {
      setIsImportSaving(false)
    }
  }, [importPaste, isImportSaving, onFinish])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onFinish() }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-10050 bg-black/60 p-4"
        aria-labelledby="onboarding-import-title"
        className="block w-[min(540px,92vw)] max-h-[min(90vh,720px)] gap-0 overflow-y-auto p-6"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 id="onboarding-import-title" className="text-base font-semibold text-(--foreground)">
            Import memories from other assistants
          </h2>
          <Button variant="ghost"
            type="button"
            onClick={onFinish}
            className={unstyledButton(`rounded-sm p-0.5 text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
            aria-label="Skip import"
          >
            <X size={16} />
          </Button>
        </div>
        <p className="mb-6 text-xs text-(--muted)">
          Optional — bring over context from ChatGPT, Claude, or other tools. Copy the prompt, paste it there, then paste the reply below. We&apos;ll save it into your Overlay memories.
        </p>

        <div className="relative mb-6 flex gap-3">
          <div className="flex flex-col items-center">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--foreground) text-[11px] font-semibold text-(--background)">
              1
            </span>
            <div className="mt-1 w-px flex-1 min-h-[24px] bg-(--border)" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="mb-2 text-xs font-medium text-(--foreground)">
              Copy this prompt into a chat with your other AI provider
            </p>
            <div className="relative rounded-lg border border-(--border) bg-(--surface-muted) px-3 pb-10 pt-3">
              <p className="text-xs leading-relaxed text-(--foreground)">{ONBOARDING_IMPORT_MEMORY_PROMPT}</p>
              <Button variant="ghost"
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(ONBOARDING_IMPORT_MEMORY_PROMPT)
                  setMemoryPromptCopied(true)
                  window.setTimeout(() => setMemoryPromptCopied(false), 2000)
                }}
                className={unstyledButton(`absolute bottom-2 right-2 flex items-center gap-1.5 rounded-md border border-(--border) bg-(--surface-elevated) px-2 py-1 text-[11px] text-(--foreground) transition-colors hover:bg-(--surface-subtle)`)}
              >
                {memoryPromptCopied ? <Check size={11} /> : <Copy size={11} />}
                {memoryPromptCopied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--foreground) text-[11px] font-semibold text-(--background)">
            2
          </span>
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs font-medium text-(--foreground)">
              Paste results below to add to Overlay memories
            </p>
            <Textarea
              aria-label="Memory import results"
              value={importPaste}
              onChange={(e) => setImportPaste(e.target.value)}
              placeholder="Paste your memory details here"
              rows={6}
              className={unstyledTextarea(`w-full resize-none rounded-lg border border-(--border) bg-(--surface-muted) px-3 py-2.5 text-xs text-(--foreground) outline-hidden transition-colors placeholder:text-(--muted) focus:border-(--muted)`)}
            />
            {importError ? (
              <p className="mt-2 text-xs text-red-500">{importError}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onFinish} className={unstyledButton(DIALOG_SECONDARY_CLASS)}>
            Skip
          </Button>
          <Button variant="ghost"
            type="button"
            onClick={() => void saveImportedMemories()}
            disabled={!importPaste.trim() || isImportSaving}
            className={unstyledButton(DIALOG_PRIMARY_CLASS)}
          >
            {isImportSaving ? 'Saving…' : 'Add to memory'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ConnectToolsStep({ onFinish }: { onFinish: () => void }) {
  const router = useRouter()
  const [connectorConnectingSlug, setConnectorConnectingSlug] = useState<string | null>(null)
  const [connectorLogos, setConnectorLogos] = useState<Record<string, string | null>>({})
  const [connectedSlugs, setConnectedSlugs] = useState<Set<string>>(new Set())
  const [integrationsPickerOpen, setIntegrationsPickerOpen] = useState(false)

  // Same provider-neutral catalog fetch as Extensions → loadCatalog.
  useEffect(() => {
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
  }, [])

  // Track connected toolkits so cards reflect connections in real time after the
  // Provider setup completes in another tab and signals via focus/event refresh.
  useEffect(() => {
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
  }, [])

  const dialogConnect = useCallback(async (slug: string) => {
    const oauthTab = window.open('about:blank', '_blank')
    try {
      const res = await overlayAppClient.integrations.connectResponse({ action: 'connect', providerKey: slug })
      const data = (await res.json().catch(() => ({}))) as { redirectUrl?: string; connectionId?: string; error?: string }
      if (!res.ok) {
        oauthTab?.close()
        throw new Error(data.error || 'Failed to initiate connection')
      }
      const redirectUrl = safeHttpUrl(data.redirectUrl)
      if (redirectUrl) {
        if (oauthTab) oauthTab.location.href = redirectUrl
        else window.open(redirectUrl, '_blank', 'noopener,noreferrer')
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

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onFinish() }}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="z-10050 bg-black/60 p-4"
          aria-labelledby="onboarding-connectors-title"
          className="block w-[min(520px,94vw)] max-h-[min(90vh,840px)] gap-0 overflow-y-auto p-6"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 id="onboarding-connectors-title" className="text-base font-semibold text-(--foreground)">
              Connect your tools
            </h2>
            <Button variant="ghost"
              type="button"
              onClick={onFinish}
              className={unstyledButton(`rounded-sm p-0.5 text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
              aria-label="Close"
            >
              <X size={16} />
            </Button>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-(--muted)">
            Optional — connect apps you use with Overlay. Use Connect on a card below (same OAuth flow as Extensions), or{' '}
            <span className="text-(--foreground)">Add</span> to search the full integration catalog.
          </p>

          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            {ONBOARDING_CONNECTOR_CARDS.map((c) => {
              const busy = connectorConnectingSlug === c.slug
              const anyBusy = connectorConnectingSlug !== null
              const isConnected = connectedSlugs.has(c.slug)
              return (
                <div
                  key={c.slug}
                  className="flex flex-col rounded-xl border border-(--border) bg-(--surface-muted) p-3 shadow-xs"
                >
                  <OnboardingConnectorCardLogo
                    name={c.name}
                    fallbackEmoji={c.icon}
                    logoUrl={connectorLogos[c.slug]}
                  />
                  <p className="text-xs font-semibold text-(--foreground)">{c.name}</p>
                  <p className="mb-2.5 mt-0.5 line-clamp-3 flex-1 text-[10px] leading-snug text-(--muted)">
                    {c.description}
                  </p>
                  <Button variant="ghost"
                    type="button"
                    onClick={() => { if (!isConnected) void connectPopularConnector(c.slug) }}
                    disabled={anyBusy || isConnected}
                    className={unstyledButton(`mt-auto inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-(--border) bg-(--surface-elevated) text-[11px] font-medium text-(--foreground) transition-colors hover:bg-(--surface-subtle) disabled:opacity-100 disabled:hover:bg-(--surface-elevated)`)}
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
                  </Button>
                </div>
              )
            })}
          </div>

          <Button variant="ghost"
            type="button"
            onClick={() => setIntegrationsPickerOpen(true)}
            className={unstyledButton(`mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-(--border) bg-(--surface-muted)/60 py-3 text-xs font-medium text-(--foreground) transition-colors hover:bg-(--surface-muted)`)}
          >
            <Plus size={16} strokeWidth={2} className="text-(--muted)" aria-hidden />
            Add integration
          </Button>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onFinish} className={unstyledButton(DIALOG_SECONDARY_CLASS)}>
              Skip
            </Button>
            <Button variant="ghost"
              type="button"
              onClick={() => {
                router.push('/app/tools')
                onFinish()
              }}
              className={unstyledButton(`${DIALOG_PRIMARY_CLASS} flex items-center gap-1.5`)}
            >
              Open Extensions
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <IntegrationsDialog
        connectedSlugs={connectedSlugs}
        isOpen={integrationsPickerOpen}
        onClose={() => setIntegrationsPickerOpen(false)}
        onConnect={dialogConnect}
        onDisconnect={dialogDisconnect}
        overlayClassName="fixed inset-0 z-10060 flex items-center justify-center bg-(--overlay-scrim) p-5"
      />
    </>
  )
}

function TourBackdrop({
  opacity,
  spotlightRect,
}: {
  opacity: number
  spotlightRect: Frame['spotlightRect']
}) {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        pointerEvents: 'none',
        transition: 'opacity 400ms ease',
        opacity,
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
      {/* When the target is missing, do not swallow clicks for the whole app —
          that blocked invitation accept and other non-chat routes. */}
      {!spotlightRect && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      )}
    </div>
  )
}

function TourOverlay({
  step,
  currentStep,
  stepsCount,
  isClosing,
  frame,
  backdropReady,
  onSkip,
  onBack,
  onNext,
  onComplete,
}: {
  step: TourStep
  currentStep: number
  stepsCount: number
  isClosing: boolean
  frame: Frame
  backdropReady: boolean
  onSkip: () => void
  onBack: () => void
  onNext: () => void
  onComplete: () => void
}) {
  const rect = frame.stepIndex === currentStep ? frame.rect : null
  const spotlightRect = frame.spotlightRect

  const visible = frame.stepIndex === currentStep && frame.rect !== null && !isClosing
  const backdropOpacity = backdropReady && !isClosing ? 1 : 0

  const tooltipInfo = rect
    ? computeTooltipStyle(rect, step.placement ?? 'right')
    : null

  const isLast = currentStep === stepsCount - 1

  return (
    <>
      {/* Backdrop with box-shadow cutout */}
      <TourBackdrop opacity={backdropOpacity} spotlightRect={spotlightRect} />

      {/* Tooltip card */}
      {tooltipInfo && (
        // Anchored spotlight tooltip — a native <dialog> cannot position against the target element.
        // react-doctor-disable-next-line react-doctor/prefer-html-dialog
        <div
          role="dialog"
          aria-label={`Onboarding step ${currentStep + 1} of ${stepsCount}`}
          style={{
            ...tooltipInfo.style,
            opacity: visible ? 1 : 0,
            transform: visible ? 'scale(1)' : 'scale(0.95)',
            transition: 'opacity 400ms ease, transform 400ms ease',
          }}
          className="rounded-xl border border-(--border) bg-(--surface-elevated) p-5 shadow-2xl"
        >
          <div style={tooltipInfo.arrowStyle} aria-hidden />

          <div className="mb-3 flex items-start justify-between gap-3">
            <span className="text-[11px] font-medium tabular-nums text-(--muted)">
              {currentStep + 1} / {stepsCount}
            </span>
            <Button variant="ghost"
              type="button"
              onClick={onSkip}
              className={unstyledButton(`rounded-sm p-0.5 text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
              aria-label="Close tour"
            >
              <X size={14} />
            </Button>
          </div>

          <h3 className="mb-1.5 text-base font-semibold text-(--foreground)">{step.title}</h3>
          <p className="mb-5 text-sm leading-relaxed text-(--muted)">{step.description}</p>

          <div className="flex items-center justify-between">
            <Button variant="ghost"
              type="button"
              onClick={onSkip}
              className={unstyledButton(`text-sm text-(--muted) hover:text-(--foreground)`)}
            >
              Skip tour
            </Button>
            <div className="flex gap-2">
              {currentStep > 0 && (
                <Button variant="ghost"
                  type="button"
                  onClick={onBack}
                  className={unstyledButton(`rounded-lg border border-(--border) bg-(--surface-subtle) px-3 py-1.5 text-sm font-medium text-(--foreground) hover:bg-(--surface-elevated)`)}
                >
                  Back
                </Button>
              )}
              <Button variant="ghost"
                type="button"
                onClick={isLast ? onComplete : onNext}
                className={unstyledButton(`flex items-center gap-1.5 rounded-lg bg-(--foreground) px-4 py-1.5 text-sm font-medium text-(--background)`)}
              >
                {isLast ? (
                  <>Get started</>
                ) : (
                  <>Next <ArrowRight size={13} /></>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function OnboardingTour({
  steps,
  currentStep,
  onNext,
  onBack,
  onSkip,
  onDone,
  isClosing = false,
  memoryEnabled = true,
  integrationsEnabled = true,
}: Props) {
  const step = steps[currentStep]
  const { postTourPhase, beginPostTour, finishImportStep, finishPostTour } = usePostTourPhase({
    currentStep,
    stepsLength: steps.length,
    onNext,
    onSkip,
    onDone,
    memoryEnabled,
    integrationsEnabled,
  })
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

  if (!step) return null

  if (postTourPhase === 'import-memories') {
    return <ImportMemoriesStep onFinish={finishImportStep} />
  }

  if (postTourPhase === 'connectors') {
    return <ConnectToolsStep onFinish={finishPostTour} />
  }

  return (
    <TourOverlay
      step={step}
      currentStep={currentStep}
      stepsCount={steps.length}
      isClosing={isClosing}
      frame={frame}
      backdropReady={backdropReady}
      onSkip={onSkip}
      onBack={onBack}
      onNext={onNext}
      onComplete={beginPostTour}
    />
  )
}
