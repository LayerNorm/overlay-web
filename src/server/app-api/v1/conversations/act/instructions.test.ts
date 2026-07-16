import assert from 'node:assert/strict'
import test from 'node:test'
import { FREE_TIER_DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { buildActAgentInstructions, type ActInstructionConstants } from './instructions'

const constants: ActInstructionConstants = {
  ACT_KNOWLEDGE_TOOLS_NOTE_NO_WEB: 'NO_WEB_KNOWLEDGE',
  ACT_KNOWLEDGE_WEB_TOOLS_NOTE: 'WEB_KNOWLEDGE',
  ACT_PAID_PLAN_ACT_TOOLS_REALITY: 'PAID_REALITY',
  FREE_TIER_NO_PAID_AGENT_CAPABILITIES: 'FREE_REALITY',
  MATH_FORMAT_INSTRUCTION: 'MATH_RULES',
  MEMORY_SAVE_PROTOCOL: 'MEMORY_RULES',
  TABLE_FORMAT_INSTRUCTION: 'TABLE_RULES',
}

function buildInstructions(overrides: Partial<Parameters<typeof buildActAgentInstructions>[0]> = {}) {
  return buildActAgentInstructions({
    availableToolIds: [
      'interactive_browser_session',
      'parallel_search',
      'perplexity_search',
      'run_daytona_sandbox',
      'save_memory',
    ],
    autoRetrieval: '\nAUTO_RETRIEVAL',
    constants,
    docContextText: 'DOC_CONTEXT',
    effectiveModelId: 'claude-sonnet-4-6',
    exposedMediaTools: [],
    hasPreloadedDocContext: false,
    indexedNote: '\nINDEXED_NOTE',
    isMultiModelFollowUpSlot: false,
    memoryContext: '\nMEMORY_CONTEXT',
    mentionsContext: '\nMENTIONS_CONTEXT',
    paid: true,
    projectInstructions: 'PROJECT_RULES',
    skillsContext: '\nSKILLS_CONTEXT',
    userSystemPromptExtension: 'USER_SYSTEM',
    ...overrides,
  })
}

test('buildActAgentInstructions preserves paid tool and context note composition', () => {
  const instructions = buildInstructions({
    exposedMediaTools: ['generate_image', 'generate_video'],
    mode: 'automate',
  })

  assert.match(instructions, /^You are Overlay’s browser agent\./)
  assert.match(instructions, /Project instructions:\nPROJECT_RULES/)
  assert.match(instructions, /generate_image, generate_video/)
  assert.match(instructions, /You are in Automate mode\./)
  assert.match(instructions, /interactive_browser_session/)
  assert.match(instructions, /run_daytona_sandbox/)
  assert.match(instructions, /Every code artifact you write must be returned in a fenced Markdown code block/)
  assert.match(instructions, /never place source code, HTML, CSS, JavaScript, JSON, SQL/)
  assert.match(instructions, /WEB_KNOWLEDGE/)
  assert.match(instructions, /PAID_REALITY/)
  assert.match(instructions, /MATH_RULES\n\nTABLE_RULES$/)
})

test('buildActAgentInstructions preserves execution, compare-slot, and free-tier branches', () => {
  const automationExecution = buildInstructions({
    automationExecution: true,
  })
  assert.match(automationExecution, /You are executing an existing saved automation\./)
  assert.doesNotMatch(automationExecution, /You are in Automate mode\./)

  const compareSlot = buildInstructions({
    isMultiModelFollowUpSlot: true,
  })
  assert.match(compareSlot, /^You are Overlay’s assistant in a parallel model-comparison run\./)
  assert.match(compareSlot, /Composio and other third-party account action tools are not in your tool set/)

  const freeWithDocContext = buildInstructions({
    availableToolIds: ['save_memory', 'search_knowledge'],
    effectiveModelId: FREE_TIER_DEFAULT_MODEL_ID,
    hasPreloadedDocContext: true,
    paid: false,
  })
  assert.match(freeWithDocContext, /NO_WEB_KNOWLEDGE/)
  assert.match(freeWithDocContext, /FREE_REALITY/)
  assert.match(freeWithDocContext, /attached documents whose full content is provided above/)
  assert.match(freeWithDocContext, /inside ` thinking\.\.\.` tags/)
  assert.match(freeWithDocContext, /close with ` ` BEFORE/)
})

test('buildActAgentInstructions does not advertise tools when none are registered', () => {
  const instructions = buildInstructions({
    availableToolIds: [],
    requestedToolIds: ['memory'],
  })

  assert.match(instructions, /^You are Overlay’s assistant\./)
  assert.match(instructions, /No callable tools are registered for this turn/)
  assert.match(instructions, /No knowledge or memory tools are callable in this turn/)
  assert.doesNotMatch(instructions, /You also have an interactive_browser_session tool/)
  assert.doesNotMatch(instructions, /You also have a run_daytona_sandbox tool/)
  assert.doesNotMatch(instructions, /PAID_REALITY/)
})
