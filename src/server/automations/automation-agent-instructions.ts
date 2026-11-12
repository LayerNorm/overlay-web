import { buildActAgentInstructions } from '@/server/app-api/v1/conversations/act/instructions'

type ActInstructionInput = Parameters<typeof buildActAgentInstructions>[0]

export function buildAutomationAgentInstructions(
  input: Omit<ActInstructionInput, 'agentPersona'> & {
    automationAgent?: { name: string; instructions: string } | null
  },
): string {
  const { automationAgent, ...instructionInput } = input
  return buildActAgentInstructions({
    ...instructionInput,
    agentPersona: automationAgent
      ? { name: automationAgent.name, instructions: automationAgent.instructions }
      : undefined,
  })
}
