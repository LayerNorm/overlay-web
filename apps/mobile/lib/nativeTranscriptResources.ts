import type { ChatTranscriptView } from '@overlay/chat-core'
import type { NativeTranscriptAsset } from './nativeChatTranscriptActions'
import { getNativeTranscriptCitationEntries, isNativeTranscriptResourceId } from './nativeTranscriptCitations'

export interface NativeTranscriptResource extends NativeTranscriptAsset {
  label: string
}

interface ResourceCandidate {
  exchangeId: string
  resourceId: string
  resourceKind: 'file' | 'output'
  previewable: boolean
  label: string
}

function isDisplayId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
}

function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const label = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160)
  return label || fallback
}

function candidateKey(candidate: Pick<ResourceCandidate, 'exchangeId' | 'resourceKind' | 'resourceId'>): string {
  return JSON.stringify([candidate.exchangeId, candidate.resourceKind, candidate.resourceId])
}

function collectCandidates(view: ChatTranscriptView): ResourceCandidate[] {
  const candidates = new Map<string, ResourceCandidate>()
  const add = (exchangeId: unknown, resourceId: unknown, resourceKind: ResourceCandidate['resourceKind'], label: unknown, previewable = true) => {
    if (!isDisplayId(exchangeId) || !isNativeTranscriptResourceId(resourceId)) return
    const candidate = { exchangeId, resourceId, resourceKind, previewable, label: safeLabel(label, resourceKind === 'output' ? 'Generated media' : 'Attached file') }
    candidates.set(candidateKey(candidate), candidate)
  }

  for (const exchange of view.exchanges) {
    for (const attachment of exchange.user.indexedAttachments) {
      for (const fileId of attachment.fileIds) add(exchange.id, fileId, 'file', attachment.name)
    }
    for (const mention of exchange.user.mentions) {
      for (const fileId of mention.fileIds ?? []) add(exchange.id, fileId, 'file', mention.name)
    }
    for (const response of exchange.responses) {
      for (const block of response.blocks) {
        if (block.kind === 'source' && block.sourceKind === 'document') {
          add(exchange.id, block.sourceId, 'file', block.filename ?? block.title)
        }
      }
      for (const source of response.sources) {
        if (source.sourceKind === 'document') add(exchange.id, source.sourceId, 'file', source.filename ?? source.title)
      }
      for (const { citation } of getNativeTranscriptCitationEntries(response.sourceCitations)) {
        if (citation?.kind === 'file') add(exchange.id, citation.sourceId, 'file', citation.title ?? 'Cited file')
      }
    }
    if (exchange.media) {
      for (const result of exchange.media.results) {
        const record = result as unknown as Record<string, unknown>
        if ((record.type === 'image' || record.type === 'video') && record.status === 'completed') {
          add(exchange.id, record.outputId, 'output', record.type === 'video' ? 'Generated video' : 'Generated image', record.type === 'image')
        }
      }
    }
  }
  return [...candidates.values()]
}

export class NativeTranscriptResourceRegistry {
  private readonly resourceByHandle = new Map<string, ResourceCandidate>()
  private currentHandlesByResource = new Map<string, string>()

  constructor(private readonly createOpaqueHandle: () => string) {}

  commitView(view: ChatTranscriptView): boolean {
    const previousAssets = this.currentAssets()
    const candidates = collectCandidates(view)
    const nextHandles = new Map<string, string>()
    for (const candidate of candidates) {
      const key = candidateKey(candidate)
      const activeHandle = this.currentHandlesByResource.get(key)
      if (activeHandle) {
        nextHandles.set(key, activeHandle)
        this.resourceByHandle.set(activeHandle, candidate)
        continue
      }
      let handle = ''
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const proposed = this.createOpaqueHandle()
        if (/^[A-Za-z0-9_-]{16,200}$/.test(proposed) && !this.resourceByHandle.has(proposed)) {
          handle = proposed
          break
        }
      }
      if (!handle) throw new Error('Unable to create a unique transcript resource handle')
      nextHandles.set(key, handle)
      this.resourceByHandle.set(handle, candidate)
    }
    this.currentHandlesByResource = nextHandles
    const nextAssets = this.currentAssets()
    return previousAssets.length !== nextAssets.length || previousAssets.some((asset, index) => {
      const next = nextAssets[index]
      return !next || asset.handle !== next.handle || asset.exchangeId !== next.exchangeId ||
        asset.resourceId !== next.resourceId || asset.resourceKind !== next.resourceKind ||
        asset.previewable !== next.previewable || asset.label !== next.label
    })
  }

  currentAssets(): readonly NativeTranscriptResource[] {
    const assets: NativeTranscriptResource[] = []
    for (const [key, handle] of this.currentHandlesByResource) {
      const candidate = handle ? this.resourceByHandle.get(handle) : undefined
      if (handle && candidate) assets.push({ ...candidate, handle })
    }
    return assets
  }

  resolveCurrent(handle: string, exchangeId?: string): NativeTranscriptResource | null {
    const candidate = this.resourceByHandle.get(handle)
    if (!candidate || this.currentHandlesByResource.get(candidateKey(candidate)) !== handle ||
      (exchangeId !== undefined && candidate.exchangeId !== exchangeId)) return null
    return { ...candidate, handle }
  }

  hasCurrent(resourceKind: ResourceCandidate['resourceKind'], resourceId: string, exchangeId?: string): boolean {
    return this.currentAssets().some((asset) => asset.resourceKind === resourceKind && asset.resourceId === resourceId &&
      (exchangeId === undefined || asset.exchangeId === exchangeId))
  }
}
