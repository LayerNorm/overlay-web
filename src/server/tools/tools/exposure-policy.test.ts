import 'server-only'

import test from 'node:test'
import assert from 'node:assert/strict'

test('exposure policy keeps browser tool disabled on extension client unless the user requests browser work in text', async () => {
  const { allowedOverlayToolIdsForTurn } = await import(
    new URL('./exposure-policy.ts', import.meta.url).href,
  )
  const researchTools = allowedOverlayToolIdsForTurn({
    latestUserText: 'Find me academic papers about strength training',
  })
  assert.equal(researchTools.includes('interactive_browser_session'), false)

  const browserTools = allowedOverlayToolIdsForTurn({
    latestUserText: 'Log into the website and take a screenshot of the billing page',
  })
  assert.equal(browserTools.includes('interactive_browser_session'), true)

  const extensionSurface = allowedOverlayToolIdsForTurn({
    latestUserText: 'Fill out the form on this page and submit it',
    clientSurface: 'chrome-extension',
  })
  assert.equal(extensionSurface.includes('interactive_browser_session'), false)
})

test('exposure policy exposes high-risk non-media tools only for explicit matching requests', async () => {
  const { allowedOverlayToolIdsForTurn } = await import(
    new URL('./exposure-policy.ts', import.meta.url).href,
  )
  const defaultTools = allowedOverlayToolIdsForTurn({
    latestUserText: 'Summarize my saved notes about pricing',
  })
  assert.equal(defaultTools.includes('generate_image'), false)
  assert.equal(defaultTools.includes('create_note'), false)

  const noteTools = allowedOverlayToolIdsForTurn({
    latestUserText: 'Create a note with this summary and save it to my notes',
  })
  assert.equal(noteTools.includes('create_note'), true)

  const imageWordsWithoutStructuredIntent = allowedOverlayToolIdsForTurn({
    latestUserText: 'Generate an image poster for the launch event',
  })
  assert.equal(imageWordsWithoutStructuredIntent.includes('generate_image'), false)
})

test('media tools require structured media intent instead of keyword matching', async () => {
  const { allowedOverlayToolIdsForTurn } = await import(
    new URL('./exposure-policy.ts', import.meta.url).href,
  )

  const imageTools = allowedOverlayToolIdsForTurn({
    latestUserText: 'Any text is allowed here because media authorization is structured.',
    mediaToolIntent: 'image',
  })
  assert.equal(imageTools.includes('generate_image'), true)
  assert.equal(imageTools.includes('generate_video'), false)

  const videoTools = allowedOverlayToolIdsForTurn({
    latestUserText: 'Any text is allowed here because media authorization is structured.',
    mediaToolIntent: 'video',
  })
  assert.equal(videoTools.includes('generate_image'), false)
  for (const toolId of [
    'generate_video',
    'animate_image',
    'generate_video_with_reference',
    'apply_motion_control',
    'edit_video',
  ]) {
    assert.equal(videoTools.includes(toolId), true)
  }
})

test('automation execution hides automation management tools even for automation-shaped prompts', async () => {
  const { allowedOverlayToolIdsForTurn } = await import(
    new URL('./exposure-policy.ts', import.meta.url).href,
  )
  const automationManagementTools = [
    'list_automations',
    'draft_automation_from_chat',
    'create_automation',
    'update_automation',
    'pause_automation',
    'delete_automation',
  ]

  const executionTools = allowedOverlayToolIdsForTurn({
    latestUserText: 'Execute saved automation now: Daily News Digest. Scheduled automation daily.',
    automationExecution: true,
  })
  for (const toolId of automationManagementTools) {
    assert.equal(executionTools.includes(toolId), false)
  }

  const automateModeTools = allowedOverlayToolIdsForTurn({
    latestUserText: 'Help me create a daily automation',
    automationMode: true,
  })
  for (const toolId of automationManagementTools) {
    assert.equal(automateModeTools.includes(toolId), true)
  }
})
