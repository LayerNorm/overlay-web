import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type Message = Doc<'conversationMessages'>
type Parts = NonNullable<Message['parts']>
type Chunk = Doc<'remoteMessageTextChunks'>
const CHUNK_CHARS = 32 * 1024
const PREVIEW_CHARS = 2048
const REF_TYPE = 'data-remote-text'

function boundary(text: string, end: number): number {
  const before = text.charCodeAt(end - 1)
  const after = text.charCodeAt(end)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff ? end - 1 : end
}

function splitText(text: string): string[] {
  const chunks: string[] = []
  for (let start = 0; start < text.length;) {
    const end = boundary(text, Math.min(text.length, start + CHUNK_CHARS))
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}

async function readChunks(ctx: Pick<QueryCtx, 'db'>, message: Message): Promise<Chunk[]> {
  if (!message.remoteTextStored) return []
  const chunks = await ctx.db.query('remoteMessageTextChunks')
    .withIndex('by_messageId_partIndex_chunkIndex', q => q.eq('messageId', message._id))
    .take(message.remoteTextStored.chunks + 1)
  if (chunks.length !== message.remoteTextStored.chunks) throw new Error('REMOTE_TEXT_CHUNKS_INCOMPLETE')
  return chunks
}

function segment(chunks: Chunk[], partIndex: number): string {
  const selected = chunks.filter(chunk => chunk.partIndex === partIndex)
  if (selected.some((chunk, index) => chunk.chunkIndex !== index)) throw new Error('REMOTE_TEXT_CHUNKS_INCOMPLETE')
  return selected.map(chunk => chunk.text).join('')
}

/** Call only after the parent conversation/message access check. No public chunk-reading endpoint. */
export async function hydrateRemoteMessage(ctx: Pick<QueryCtx, 'db'>, message: Message): Promise<Message> {
  if (!message.remoteTextStored) return message
  const chunks = await readChunks(ctx, message)
  const parts = (message.parts ?? []).map(part => {
    if (part.type !== REF_TYPE || !('artifactId' in part) || typeof part.artifactId !== 'string') return part
    const partIndex = Number(part.artifactId)
    if (!Number.isInteger(partIndex) || partIndex < 0) throw new Error('REMOTE_TEXT_REFERENCE_INVALID')
    return { type: 'text', text: segment(chunks, partIndex) }
  })
  const content = message.remoteTextStored.contentSource === 'separate' ? segment(chunks, -1)
    : parts.map(part => 'text' in part && typeof part.text === 'string' ? part.text : '').join('')
  return { ...message, content, parts }
}

/** Persist only changed chunks; refs and the preview remain stable while an existing text part grows. */
export async function prepareRemoteMessageText(ctx: Pick<MutationCtx, 'db'>, stored: Message, next: { content: string; parts: Parts }) {
  const old = await readChunks(ctx, stored)
  const wanted: Array<{ partIndex: number; chunkIndex: number; text: string }> = []
  let partIndex = 0
  let textContent = ''
  const parts: Parts = next.parts.map(part => {
    if ((part.type !== 'text' && part.type !== 'output-text') || !('text' in part) || typeof part.text !== 'string') return part
    const index = partIndex++
    textContent += part.text
    splitText(part.text).forEach((text, chunkIndex) => wanted.push({ partIndex: index, chunkIndex, text }))
    return { type: REF_TYPE, artifactId: String(index) }
  })
  const contentSource = textContent === next.content ? 'parts' : 'separate'
  if (contentSource === 'separate') splitText(next.content).forEach((text, chunkIndex) => wanted.push({ partIndex: -1, chunkIndex, text }))
  const previous = new Map(old.map(chunk => [`${chunk.partIndex}:${chunk.chunkIndex}`, chunk]))
  let textChanged = false
  for (const chunk of wanted) {
    const key = `${chunk.partIndex}:${chunk.chunkIndex}`
    const existing = previous.get(key)
    previous.delete(key)
    if (existing?.text === chunk.text) continue
    textChanged = true
    if (existing) await ctx.db.patch(existing._id, { text: chunk.text })
    else await ctx.db.insert('remoteMessageTextChunks', { messageId: stored._id, ...chunk })
  }
  for (const chunk of previous.values()) { textChanged = true; await ctx.db.delete(chunk._id) }
  return {
    content: next.content.slice(0, boundary(next.content, Math.min(next.content.length, PREVIEW_CHARS))),
    parts,
    remoteTextStored: { contentSource, chunks: wanted.length } satisfies NonNullable<Message['remoteTextStored']>,
    textChanged,
  }
}

export async function deleteRemoteMessageText(ctx: Pick<MutationCtx, 'db'>, message: Message) {
  for (const chunk of await readChunks(ctx, message)) await ctx.db.delete(chunk._id)
}

export async function hydrateRemoteMessages(ctx: Pick<QueryCtx, 'db'>, messages: Message[]): Promise<Message[]> {
  return Promise.all(messages.map(message => hydrateRemoteMessage(ctx, message)))
}
