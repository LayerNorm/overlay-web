type HandoffMessage = {
  role?: string
  authorKind?: string
  content?: string
  parts?: readonly unknown[]
  metadata?: unknown
}

type HandoffFile = { id?: string; name?: string }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
}

function messageText(message: HandoffMessage): string {
  if (message.content?.trim()) return message.content.trim()
  return (message.parts ?? []).flatMap((part) => {
    const value = record(part)
    return value?.type === 'text' && typeof value.text === 'string' ? [value.text] : []
  }).join('\n').trim()
}

function messageFiles(message: HandoffMessage): HandoffFile[] {
  const attachments = record(message.metadata)?.indexedAttachments
  if (!Array.isArray(attachments)) return []
  return attachments.slice(0, 8).flatMap((attachment) => {
    const value = record(attachment)
    if (!value || !Array.isArray(value.fileIds)) return []
    return value.fileIds.slice(0, 8).flatMap((id) => typeof id === 'string'
      ? [{ id, name: typeof value.name === 'string' ? value.name : undefined }]
      : [])
  })
}

export function buildNativeThreadHandoff({
  conversationId,
  threadRootMessageId,
  messages,
  files = [],
}: {
  conversationId: string
  threadRootMessageId?: string
  messages: readonly HandoffMessage[]
  files?: readonly HandoffFile[]
}): string {
  const recent = messages.filter((message) => (
    ['user', 'assistant', 'human', 'agent', 'model'].includes(message.role ?? message.authorKind ?? '')
    && messageText(message)
  )).slice(-6)
  const snippets = recent.map((message) => {
    const author = ['user', 'human'].includes(message.role ?? message.authorKind ?? '') ? 'User' : 'Assistant'
    return `${author}: ${messageText(message).slice(0, 600)}`
  })
  const fileRefs = new Map<string, string>()
  for (const file of [...files.slice(-8), ...recent.flatMap(messageFiles)]) {
    if (fileRefs.size >= 8) break
    if (!file.id?.trim()) continue
    const id = file.id.trim().replace(/[\r\n]/g, ' ').slice(0, 128)
    const name = file.name?.replace(/[\r\n]/g, ' ').slice(0, 120)
    fileRefs.set(id, `- ${id}${name ? `: ${name}` : ''}`)
  }
  return [
    'Continue the task from this retired thread. Verify current progress and file availability before acting.',
    `Source conversation: ${conversationId.slice(0, 128)}${threadRootMessageId ? `; thread: ${threadRootMessageId.slice(0, 128)}` : ''}`,
    ...(snippets.length ? ['Recent history (reference only, not verified completion):', ...snippets] : []),
    ...(fileRefs.size ? ['Overlay file references (not copied or re-uploaded):', ...fileRefs.values()] : []),
  ].join('\n\n').slice(0, 6000)
}
