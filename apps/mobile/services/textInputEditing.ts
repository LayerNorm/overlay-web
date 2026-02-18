export interface TextSelectionRange {
  start: number
  end: number
}

interface TextEditResult {
  nextText: string
  nextSelection: TextSelectionRange
}

function clampSelection(text: string, selection: TextSelectionRange): TextSelectionRange {
  const max = text.length
  const start = Math.max(0, Math.min(selection.start, max))
  const end = Math.max(0, Math.min(selection.end, max))
  return start <= end ? { start, end } : { start: end, end: start }
}

export function insertTextAtSelection(
  text: string,
  selection: TextSelectionRange,
  insertedText: string
): TextEditResult {
  const safeSelection = clampSelection(text, selection)
  const before = text.slice(0, safeSelection.start)
  const after = text.slice(safeSelection.end)
  const nextText = `${before}${insertedText}${after}`
  const cursor = before.length + insertedText.length
  return {
    nextText,
    nextSelection: { start: cursor, end: cursor }
  }
}

export function deleteBackwardAtSelection(
  text: string,
  selection: TextSelectionRange
): TextEditResult {
  const safeSelection = clampSelection(text, selection)
  if (safeSelection.start !== safeSelection.end) {
    const before = text.slice(0, safeSelection.start)
    const after = text.slice(safeSelection.end)
    return {
      nextText: `${before}${after}`,
      nextSelection: { start: safeSelection.start, end: safeSelection.start }
    }
  }

  if (safeSelection.start === 0) {
    return {
      nextText: text,
      nextSelection: safeSelection
    }
  }

  const deleteIndex = safeSelection.start - 1
  const nextText = text.slice(0, deleteIndex) + text.slice(safeSelection.start)
  return {
    nextText,
    nextSelection: { start: deleteIndex, end: deleteIndex }
  }
}

export function formatTranscriptForInsertion(transcript: string, followingText: string): string | null {
  const trimmed = transcript.trim()
  if (!trimmed) {
    return null
  }

  const endsWithPunctuation = /[.,!?;:'"()\]]$/.test(trimmed)
  if (endsWithPunctuation) {
    return trimmed
  }

  if (/^\s/.test(followingText)) {
    return trimmed
  }

  return `${trimmed} `
}
