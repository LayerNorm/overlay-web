import { expect, test } from 'vitest'
import { stripHarnessBookkeeping } from './public-text'

const repairParagraphs = [
  'The plan needs to be adjusted to mark `handle_artifact` as answerOnly since no tool action is needed when no artifact is returned. Updating the plan:',
  'Fixing the plan format - `status` should not be included in the set operation:',
  'Plan reset. Now updating the milestones with the correct answerOnly configuration:',
  'I need to mark the `locate_pdf` milestone complete first, since the file was found in the persisted evidence.',
  'Updating milestone `read_page2_text` before continuing.',
  'I will mark the milestone complete using the persisted evidence.',
]

test('repair prose is removed without hiding ordinary plan, status, or fenced-code discussion', () => {
  const text = [
    'I reviewed the requested document.',
    ...repairParagraphs,
    'My plan is to compare the two saved results.',
    'The status remains pending until the review is complete.',
    'I will mark the release milestone complete after integration tests pass.',
    'I will update the completed milestones on your roadmap.',
    `\`\`\`text\n${repairParagraphs[0]}\n\`\`\``,
    'The answer is complete.',
  ].join('\n\n')
  const visible = stripHarnessBookkeeping(text, new Set(['harness_set_plan', 'harness_update_step']))
  expect(visible).toContain('I reviewed the requested document.')
  expect(visible).toContain('My plan is to compare the two saved results.')
  expect(visible).toContain('The status remains pending')
  expect(visible).toContain('I will mark the release milestone complete after integration tests pass.')
  expect(visible).toContain('I will update the completed milestones on your roadmap.')
  expect(visible).toContain(repairParagraphs[0])
  expect(visible.split(repairParagraphs[0])).toHaveLength(2)
  expect(visible).toContain('The answer is complete.')
  for (const paragraph of repairParagraphs.slice(1)) expect(visible).not.toContain(paragraph)
})
