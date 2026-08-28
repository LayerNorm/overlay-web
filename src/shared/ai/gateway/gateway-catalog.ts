import type { ChatModel, ImageModel, VideoModel, VideoSubMode } from '@/shared/ai/gateway/model-types'

export interface GatewayCatalogModel {
  id: string
  gatewayId: string
  name: string
  type: 'language' | 'image' | 'video' | 'embedding' | 'reranking'
  provider: string
  description?: string
  contextWindow?: number
  maxTokens?: number
  tags: string[]
  pricing: Record<string, unknown>
  inputPricePerMillion?: number
  outputPricePerMillion?: number
}

export function gatewayCatalogModelToChatModel(model: GatewayCatalogModel): ChatModel {
  const blendedPrice = ((model.inputPricePerMillion ?? 0) + (model.outputPricePerMillion ?? 0)) / 2
  const cost: ChatModel['cost'] =
    blendedPrice === 0 ? 0 : blendedPrice < 1 ? 1 : blendedPrice < 5 ? 2 : 3
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    description: model.description,
    intelligence: 0,
    cost,
    speedTier: 2,
    supportsVision: model.tags.includes('vision'),
    supportsReasoning: model.tags.includes('reasoning'),
    supportsSearch: model.tags.includes('web-search'),
    supportsZeroDataRetention: false,
    pricePer1mTokens: blendedPrice,
  }
}

function positivePrice(value: unknown): boolean {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0
}

export function gatewayCatalogModelHasSupportedPricing(model: GatewayCatalogModel): boolean {
  if (model.type === 'language') {
    return model.inputPricePerMillion !== undefined && model.outputPricePerMillion !== undefined
  }
  if (model.type === 'image') {
    return positivePrice(model.pricing.image) || (
      model.inputPricePerMillion !== undefined && model.outputPricePerMillion !== undefined
    )
  }
  if (model.type === 'video') {
    return Array.isArray(model.pricing.video_duration_pricing)
      && model.pricing.video_duration_pricing.some((row) => (
        !!row && typeof row === 'object' && positivePrice((row as Record<string, unknown>).cost_per_second)
      ))
  }
  return false
}

export function gatewayCatalogModelToImageModel(model: GatewayCatalogModel): ImageModel {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    description: model.description,
    defaultAspectRatio: '1:1',
  }
}

function inferVideoSubModes(model: GatewayCatalogModel): VideoSubMode[] {
  const haystack = `${model.id} ${model.name}`.toLowerCase()
  if (haystack.includes('motion-control')) return ['motion-control']
  if (haystack.includes('r2v') || haystack.includes('reference-to-video')) return ['reference-to-video']
  if (haystack.includes('i2v') || haystack.includes('image-to-video')) return ['image-to-video']
  if (haystack.includes('t2v') || haystack.includes('text-to-video')) return ['text-to-video']
  if (haystack.includes('grok-imagine-video')) return ['text-to-video', 'image-to-video', 'video-editing']
  if (haystack.includes('veo')) return ['text-to-video', 'image-to-video']
  return model.tags.includes('video-input')
    ? ['text-to-video', 'image-to-video', 'video-editing']
    : ['text-to-video']
}

export function gatewayCatalogModelToVideoModel(model: GatewayCatalogModel): VideoModel {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    description: model.description,
    billingUnit: Array.isArray(model.pricing.video_duration_pricing) ? 'per_second' : 'per_video',
    defaultDuration: 8,
    defaultAspectRatio: '16:9',
    subModes: inferVideoSubModes(model),
  }
}
