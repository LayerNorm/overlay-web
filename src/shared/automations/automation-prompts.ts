/**
 * Canonical prompt builders for automation execution turns. Shared by the
 * durable automation workflows (schedule loop, one-shot run) and the turn
 * runner so every execution path sees the same user message and automation
 * system prompt.
 */

export type AutomationPromptInput = {
  automationId?: string
  name: string
  description?: string
  instructions: string
  scheduledFor?: number
}

export function buildAutomationUserMessage(input: AutomationPromptInput): string {
  const scheduledAt = new Date(input.scheduledFor ?? Date.now()).toISOString()
  return [
    `Execute saved automation now: ${input.name}`,
    input.description ? `Description: ${input.description}` : '',
    `Scheduled for: ${scheduledAt}`,
    input.automationId ? `Automation ID: ${input.automationId}` : '',
    '',
    'Current saved instructions to execute:',
    input.instructions,
  ].filter(Boolean).join('\n')
}

export function buildAutomationSystemPrompt(input: AutomationPromptInput): string {
  return [
    'You are running a scheduled automation for the user.',
    'Execute the stored automation instructions without asking clarifying questions.',
    'Do not create, draft, update, pause, delete, or propose a new automation. This run is already attached to an existing saved automation.',
    'If required auth, context, or tool access is missing, stop and write a concise failure summary.',
    'Only use tools that are clearly authorized by the stored automation and connected for this user.',
    'End with a concise summary of what was completed and what still needs attention.',
    '',
    `Automation name: ${input.name}`,
    input.description ? `Automation description: ${input.description}` : '',
  ].filter(Boolean).join('\n')
}
