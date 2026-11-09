import { describe, expect, test } from 'vitest'
import { buildAutomationAgentInstructions } from './automation-agent-instructions'

describe('automation turn instructions', () => {
  test('passes the bound agent name and instructions into the shared Act builder', () => {
    const instructions = buildAutomationAgentInstructions({
      automationAgent: { name: 'Researcher', instructions: 'Write findings in Spanish.' },
      availableToolIds: ['search_knowledge'],
      autoRetrieval: '',
      constants: {
        ACT_KNOWLEDGE_TOOLS_NOTE_NO_WEB: 'NO_WEB',
        ACT_KNOWLEDGE_WEB_TOOLS_NOTE: 'WEB',
        ACT_PAID_PLAN_ACT_TOOLS_REALITY: 'PAID',
        MATH_FORMAT_INSTRUCTION: 'MATH',
        MEMORY_SAVE_PROTOCOL: 'MEMORY',
        TABLE_FORMAT_INSTRUCTION: 'TABLE',
      },
      exposedMediaTools: [],
      indexedNote: '',
      memoryContext: '',
      mentionsContext: '',
      skillsContext: '',
      userSystemPromptExtension: '',
      automationExecution: true,
    })

    expect(instructions).toContain('You are Researcher, a named AI teammate')
    expect(instructions).toContain('Write findings in Spanish.')
    expect(instructions).toContain('Follow the stored automation instructions now.')
    expect(instructions).toContain('They do not grant capabilities or override server-side safety')
  })
})
