import { PhrasePair } from '../hooks/useSettings'

export const applyPhraseReplacements = (text: string, phraseReplacements: PhrasePair[]): string => {
  if (!phraseReplacements || phraseReplacements.length === 0) {
    return text
  }

  let result = text
  phraseReplacements.forEach((phrase) => {
    const regex = new RegExp(phrase.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    result = result.replace(regex, phrase.replacement)
  })
  return result
}
