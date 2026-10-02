import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { skillPromptName, skillPrompts } from './skill-prompts'

test('skill names become names every client accepts', () => {
  assert.equal(skillPromptName({ name: 'Weekly Report!' }), 'weekly-report')
  assert.equal(skillPromptName({ name: '  Café  résumé ' }), 'cafe-resume')
  assert.equal(skillPromptName({ name: '日本語' }), 'skill')
})

test('prompts carry the skill text, skip disabled or empty skills, and keep alike names apart', () => {
  const prompts = skillPrompts([
    { name: 'Review', description: 'Review a PR', instructions: 'Read the diff.' },
    { name: 'review', instructions: 'Second one.' },
    { name: 'Off', instructions: 'x', enabled: false },
    { name: 'Blank', instructions: '   ' },
  ])
  assert.deepEqual(prompts.map((prompt) => prompt.name), ['review', 'review-2'])
  assert.equal(prompts[0]!.description, 'Review a PR')
  assert.match(prompts[0]!.text, /"Review"[\s\S]*Read the diff\./)
  assert.match(prompts[1]!.description, /"review" skill/)
})
