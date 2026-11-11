import assert from 'node:assert/strict'
import test from 'node:test'
import { buildActAgentInstructions, type ActInstructionConstants } from './instructions'

const constants: ActInstructionConstants = {
  ACT_KNOWLEDGE_TOOLS_NOTE_NO_WEB: 'NO_WEB_KNOWLEDGE',
  ACT_KNOWLEDGE_WEB_TOOLS_NOTE: 'WEB_KNOWLEDGE',
  ACT_PAID_PLAN_ACT_TOOLS_REALITY: 'PAID_REALITY',
  MATH_FORMAT_INSTRUCTION: 'MATH_RULES',
  MEMORY_SAVE_PROTOCOL: 'MEMORY_RULES',
  TABLE_FORMAT_INSTRUCTION: 'TABLE_RULES',
}

function buildInstructions(overrides: Partial<Parameters<typeof buildActAgentInstructions>[0]> = {}) {
  return buildActAgentInstructions({
    availableToolIds: [
      'deep_search',
      'computer_browser',
      'save_memory',
      'web_fetch',
      'web_search',
      'present_generated_ui',
    ],
    autoRetrieval: '\nAUTO_RETRIEVAL',
    constants,
    docContextText: 'DOC_CONTEXT',
    exposedMediaTools: [],
    indexedNote: '\nINDEXED_NOTE',
    memoryContext: '\nMEMORY_CONTEXT',
    mentionsContext: '\nMENTIONS_CONTEXT',
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
  // Projects were removed (9a6141f5b); no project block is composed.
  assert.doesNotMatch(instructions, /Project instructions/)
  assert.match(instructions, /generate_image, generate_video/)
  assert.match(instructions, /You are in Automate mode\./)
  assert.match(instructions, /computer_browser/)
  assert.match(instructions, /Every code artifact you write must be returned in a fenced Markdown code block/)
  assert.match(instructions, /never place source code, HTML, CSS, JavaScript, JSON, SQL/)
  assert.match(instructions, /WEB_KNOWLEDGE/)
  assert.match(instructions, /PAID_REALITY/)
  assert.match(instructions, /MATH_RULES\n\nTABLE_RULES$/)
})

test('generated UI guidance follows the tools admitted for the turn', () => {
  const structuredOnly = buildInstructions({ availableToolIds: ['render_ui'] })
  assert.match(structuredOnly, /use render_ui/)
  assert.doesNotMatch(structuredOnly, /No generated-UI tool is available/)
  assert.doesNotMatch(structuredOnly, /present_generated_ui/)
  assert.match(structuredOnly, /Every code artifact you write must be returned in a fenced Markdown code block with an appropriate language tag/)

  const draftCardsOnly = buildInstructions({ availableToolIds: ['present_generated_ui'] })
  assert.match(draftCardsOnly, /present_generated_ui/)
  assert.doesNotMatch(draftCardsOnly, /render_ui/)
})

test('buildActAgentInstructions preserves execution and document-context guidance', () => {
  const automationExecution = buildInstructions({
    automationExecution: true,
  })
  assert.match(automationExecution, /You are executing an existing saved automation\./)
  assert.doesNotMatch(automationExecution, /You are in Automate mode\./)

  const withDocContext = buildInstructions({
    availableToolIds: ['save_memory', 'search_knowledge'],
  })
  assert.match(withDocContext, /NO_WEB_KNOWLEDGE/)
  assert.match(withDocContext, /DOC_CONTEXT/)
  assert.doesNotMatch(withDocContext, /Free-runtime access/)
})

test('buildActAgentInstructions does not advertise tools when none are registered', () => {
  const instructions = buildInstructions({
    availableToolIds: [],
    requestedToolIds: ['memory'],
  })

  assert.match(instructions, /^You are Overlay’s assistant\./)
  assert.match(instructions, /No callable tools are registered for this turn/)
  assert.match(instructions, /No knowledge or memory tools are callable in this turn/)
  assert.doesNotMatch(instructions, /You also have an computer_browser tool/)
  assert.doesNotMatch(instructions, /present_generated_ui|render_ui/)
  assert.doesNotMatch(instructions, /PAID_REALITY/)
})

test('computer browser guidance uses the connected Computer in personal chat', () => {
  const instructions = buildInstructions({
    availableToolIds: ['computer_browser'],
    requestedToolIds: ['browser'],
  })

  assert.match(instructions, /connected Computer/)
  assert.match(instructions, /connect a Computer to personal chat/)
  assert.doesNotMatch(instructions, /Work mode/)
})

test('Computer capability guidance follows the exposed tool set', () => {
  const connected = buildInstructions({ availableToolIds: ['computer_exec', 'computer_browser'] })
  assert.match(connected, /call computer_exec with a command argument/)
  assert.doesNotMatch(connected, /You do not have OS-level control|No Computer tools are available/)
  const disconnected = buildInstructions({ availableToolIds: ['search_knowledge'] })
  assert.match(disconnected, /No Computer tools are available/)
  assert.doesNotMatch(disconnected, /call computer_exec with a command argument/)
})

test('automation persona is included without replacing execution restrictions', () => {
  const instructions = buildInstructions({
    automationExecution: true,
    agentPersona: { name: 'Researcher', instructions: 'Write findings in Spanish.' },
  })
  assert.match(instructions, /You are Researcher, a named AI teammate/)
  assert.match(instructions, /Write findings in Spanish/)
  assert.match(instructions, /They do not grant capabilities or override server-side safety/)
  assert.match(instructions, /Do not design, draft, create, update, pause, delete/)
})

test('a Notebook chat names its note and edits it directly with the note tools', () => {
  const instructions = buildInstructions({ notebookNote: { id: 'note_1', title: 'Orchard' } })
  assert.match(instructions, /beside the note "Orchard" \(note id=note_1\)/)
  assert.match(instructions, /edit_note, replace_note_section or append_to_note/)
  assert.match(instructions, /When in doubt, answer without editing/)
  assert.match(instructions, /Say a change was made only after an edit tool returned success in this turn/)
  assert.doesNotMatch(buildInstructions(), /Notebook editor/)
})
