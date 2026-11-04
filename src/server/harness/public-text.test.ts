import { expect, test } from 'vitest'
import { stripHarnessBookkeeping } from './public-text'

const repairParagraphs = [
  'The plan needs to be adjusted to mark `handle_artifact` as answerOnly since no tool action is needed when no artifact is returned. Updating the plan:',
  'Fixing the plan format - `status` should not be included in the set operation:',
  'Plan reset. Now updating the milestones with the correct answerOnly configuration:',
]

test('repair prose is removed without hiding ordinary plan, status, or fenced-code discussion', () => {
  const text = [
    'I reviewed the requested document.',
    ...repairParagraphs,
    'My plan is to compare the two saved results.',
    'The status remains pending until the review is complete.',
    `\`\`\`text\n${repairParagraphs[0]}\n\`\`\``,
    'The answer is complete.',
  ].join('\n\n')
  const visible = stripHarnessBookkeeping(text, new Set(['harness_set_plan', 'harness_update_step']))
  expect(visible).toContain('I reviewed the requested document.')
  expect(visible).toContain('My plan is to compare the two saved results.')
  expect(visible).toContain('The status remains pending')
  expect(visible).toContain(repairParagraphs[0])
  expect(visible.split(repairParagraphs[0])).toHaveLength(2)
  expect(visible).toContain('The answer is complete.')
  for (const paragraph of repairParagraphs.slice(1)) expect(visible).not.toContain(paragraph)
})
