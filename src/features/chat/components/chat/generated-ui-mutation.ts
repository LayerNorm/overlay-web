import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { ConversationRuntime } from '../chat-interface/types'

type Update = {
  conversationId: string | null
  persist: (args: { conversationId: string; messageId: string; partId: string; data: GeneratedUiData }) => Promise<void>
  runtime: ConversationRuntime
  messageId: string
  partId: string
  data: GeneratedUiData
  isCurrent: () => boolean
}

const pending = new WeakMap<ConversationRuntime, Promise<boolean>>()

function patchMessages(messages: UIMessage[], update: Update): UIMessage[] {
  let changed = false
  const next = messages.map((message) => {
    if (message.id !== update.messageId) return message
    let partsChanged = false
    const parts = (message.parts as Array<Record<string, unknown>>).map((part) => {
      if (part.type !== 'data' || part.id !== update.partId || part.dataType !== 'overlay.generated_ui') return part
      changed = partsChanged = true
      return { ...part, data: update.data }
    })
    return partsChanged ? { ...message, parts } as UIMessage : message
  })
  return changed ? next : messages
}

async function persistAndPatch(update: Update): Promise<boolean> {
  if (!update.isCurrent()) return false
  if (update.conversationId) {
    try {
      await update.persist({
        conversationId: update.conversationId,
        messageId: update.messageId,
        partId: update.partId,
        data: update.data,
      })
    } catch {
      throw new Error('Could not save draft edits.')
    }
  }
  if (!update.isCurrent()) return false
  const act = update.runtime.actChat.messages as UIMessage[]
  const ask = update.runtime.askChats[0].messages as UIMessage[]
  const nextAct = patchMessages(act, update)
  const nextAsk = patchMessages(ask, update)
  if (nextAct !== act) update.runtime.actChat.messages = nextAct as never
  if (nextAsk !== ask) update.runtime.askChats[0].messages = nextAsk as never
  return nextAct !== act || nextAsk !== ask
}

export function saveGeneratedUiChange(update: Update): Promise<boolean> {
  // Preserve user edit order on the server, not just the last local response.
  const next = (pending.get(update.runtime) ?? Promise.resolve(false))
    .catch(() => false)
    .then(() => persistAndPatch(update))
  pending.set(update.runtime, next)
  const cleanup = () => {
    if (pending.get(update.runtime) === next) pending.delete(update.runtime)
  }
  void next.then(cleanup, cleanup)
  return next
}
