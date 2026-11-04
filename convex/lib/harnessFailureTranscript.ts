type TranscriptPart = { type: string; [key: string]: unknown }

function textPartText(part: TranscriptPart): string {
  return part.type === 'text' && typeof part.text === 'string' ? part.text : ''
}

function toolCallId(part: TranscriptPart): string | undefined {
  if (part.type !== 'tool-invocation' || !part.toolInvocation || typeof part.toolInvocation !== 'object') return
  const id = (part.toolInvocation as Record<string, unknown>).toolCallId
  return typeof id === 'string' && id ? id : undefined
}

function mergeText(settled: string, live: string): string {
  const left = settled.trim()
  const right = live.trim()
  if (!left) return right
  if (!right || left.includes(right)) return left
  if (right.startsWith(left)) return right
  const settledLines = left.split(/\n+/).map(line => line.trim()).filter(Boolean)
  const liveLines = right.split(/\n+/).map(line => line.trim()).filter(Boolean)
  if (liveLines.length) {
    let position = -1
    const allSettled = liveLines.every(line => {
      position = left.indexOf(line, position + 1)
      return position >= 0
    })
    if (allSettled) return left
    const unmatchedLines = liveLines.filter(line => !settledLines.includes(line))
    if (unmatchedLines.length < liveLines.length) {
      return unmatchedLines.length ? `${left}\n\n${unmatchedLines.join('\n')}` : left
    }
  }
  // Long repeated streamed text must not turn suffix matching into quadratic work.
  const prefix = new Uint32Array(right.length)
  for (let index = 1, matched = 0; index < right.length; index++) {
    while (matched && right[index] !== right[matched]) matched = prefix[matched - 1]!
    if (right[index] === right[matched]) matched++
    prefix[index] = matched
  }
  let overlap = 0
  for (let index = Math.max(0, left.length - right.length); index < left.length; index++) {
    while (overlap && (overlap === right.length || left[index] !== right[overlap])) overlap = prefix[overlap - 1]!
    if (left[index] === right[overlap]) overlap++
  }
  return overlap ? `${left}${right.slice(overlap)}` : `${left}\n\n${right}`
}

function stableKey(part: TranscriptPart): string | undefined {
  const id = toolCallId(part)
  if (id) return `tool:${id}`
  if (part.type === 'text') return undefined
  try {
    return JSON.stringify(part)
  } catch {
    return undefined
  }
}

export function mergeHarnessFailureTranscript(input: {
  liveContent: string
  liveParts: TranscriptPart[]
  settledContent?: string
  settledParts?: TranscriptPart[]
}): { content: string; parts: TranscriptPart[] } {
  const settledParts = (input.settledParts ?? []).filter(part => (
    part && typeof part === 'object' && part.type !== 'reasoning'
      && part.type !== 'data-native-agent-approval' && part.type !== 'data-native-agent-input'
      && part.type !== 'data-native-agent-error'
  ))
  const liveParts = (input.liveParts ?? []).filter(part => (
    part && typeof part === 'object' && part.type !== 'reasoning'
      && part.type !== 'data-native-agent-approval' && part.type !== 'data-native-agent-input'
      && part.type !== 'data-native-agent-error'
  ))
  const content = mergeText(input.settledContent ?? '', input.liveContent)
  if (!settledParts.length) {
    return { content, parts: liveParts.length ? liveParts : content ? [{ type: 'text', text: content }] : [] }
  }
  const mergedParts = [...settledParts]
  const settledCalls = new Set(settledParts.map(toolCallId).filter((id): id is string => Boolean(id)))
  const keys = new Set(settledParts.map(stableKey).filter((key): key is string => Boolean(key)))
  const settledText = settledParts.map(textPartText).filter(Boolean).join('\n\n')
  const appendedText: string[] = []
  for (const part of liveParts) {
    if (part.type === 'text') {
      const text = textPartText(part).trim()
      if (text && !settledText.includes(text) && !appendedText.includes(text)) appendedText.push(text)
      continue
    }
    const callId = toolCallId(part)
    if (callId && settledCalls.has(callId)) continue
    const key = stableKey(part)
    if (key && keys.has(key)) continue
    mergedParts.push(part)
    if (key) keys.add(key)
  }
  const extraText = mergeText(settledText, appendedText.join('\n\n'))
  if (extraText && extraText !== settledText) {
    const suffix = extraText.startsWith(settledText) ? extraText.slice(settledText.length).trim() : extraText
    if (suffix) mergedParts.push({ type: 'text', text: suffix })
  }
  return { content, parts: mergedParts }
}
