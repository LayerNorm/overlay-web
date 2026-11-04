import { stripTextualToolCalls } from './textual-tool-calls'

const repairAction = /\b(?:updat(?:e|ing)|revis(?:e|ing)|fix(?:ing)?|correct(?:ing)?|reset(?:ting)?|mark(?:ing)?|omit(?:ting)?|remov(?:e|ing)|adjust(?:ing)?)\b/i
const internalPlan = /\b(?:harness_(?:set_plan|revise_step|update_step)|answerOnly|evidenceTools|evidenceRefs)\b|\b(?:plan format|set operation|evidence IDs)\b/i

export function stripHarnessBookkeeping(text: string, toolNames: ReadonlySet<string>): string {
  const clean = stripTextualToolCalls(text, toolNames)
  let fenced = false
  return clean.split(/\n\s*\n/).filter(paragraph => {
    const fences = paragraph.match(/^\s*```/gm)?.length ?? 0
    const code = fenced || fences > 0
    if (fences % 2) fenced = !fenced
    if (code) return true
    return !((repairAction.test(paragraph) && internalPlan.test(paragraph))
      || /^\s*(?:Plan reset\.|Using the correct evidence IDs\b)/i.test(paragraph))
  }).join('\n\n').trim()
}
