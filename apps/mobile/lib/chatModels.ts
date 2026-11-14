import type { ChatModel } from '@overlay/app-core'
import { CHAT_MODEL_QUALITY_PRIORITY } from '../../packages/overlay-llm-gateway/src/model-sorting'

export type ModelItem = Pick<ChatModel, 'id' | 'name' | 'provider'> & Partial<ChatModel>

export function sortChatModels<T extends ModelItem>(models: readonly T[]): T[] {
  const priority = new Map(CHAT_MODEL_QUALITY_PRIORITY.map((id, index) => [id, index]))
  return [...models].sort((a, b) => (priority.get(a.id) ?? Infinity) - (priority.get(b.id) ?? Infinity) || (b.intelligence ?? 0) - (a.intelligence ?? 0))
}

export function modelSections<T extends ModelItem>(models: readonly T[], favorites: readonly string[], query = '') {
  const needle = query.trim().toLowerCase()
  const ordered = sortChatModels(models).filter(model => [model.name, model.provider, model.id].some(value => value?.toLowerCase().includes(needle)))
  const sections: Array<{ id: string; label: string; provider?: string; models: T[] }> = []
  const favoriteModels = ordered.filter(model => favorites.includes(model.id))
  if (favoriteModels.length) sections.push({ id: 'favorites', label: 'Favorites', models: favoriteModels })
  for (const model of ordered) {
    const id = `provider:${model.provider}`
    const existing = sections.find(section => section.id === id)
    if (existing) existing.models.push(model)
    else sections.push({ id, label: providerLabel(model.provider), provider: model.provider, models: [model] })
  }
  return sections
}

export function providerLabel(provider: string) {
  return ({ openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', xai: 'xAI', spacexai: 'xAI', moonshotai: 'Moonshot', 'z-ai': 'Z.ai', zai: 'Z.ai', alibaba: 'Alibaba', deepseek: 'DeepSeek', minimax: 'MiniMax' } as Record<string, string>)[provider] ?? provider
}

export function resolveAutoModel(models: readonly ChatModel[], preferred?: string) {
  return models.find(model => model.id === preferred) ?? sortChatModels(models)[0]
}
