import { Buffer } from 'node:buffer'

/** Budget the bounded complete request, including non-Latin text and framing. */
export function buildTitleRequest(text: string, instructions: string) {
  const prompt = `Generate a concise title for a conversation that starts with this message:\n\n${text.slice(0, 1200)}`
  const messages = [{ role: 'system', content: instructions }, { role: 'user', content: prompt }]
  return { prompt, estimatedInputTokens: Buffer.byteLength(JSON.stringify(messages), 'utf8') + 1024 }
}
