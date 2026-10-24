type ToolStep = {
  toolCalls: ReadonlyArray<{ toolName: string; invalid?: boolean }>
}

/** Recovery stays inside the normal metered step budget and never remaps authority. */
export function prepareAgentToolRecoveryStep(
  steps: readonly ToolStep[],
  exposedToolIds: readonly string[],
  systemPrompt: string,
): { system: string } | undefined {
  const invalidCalls = steps.at(-1)?.toolCalls.filter((call) => call.invalid)
  if (!invalidCalls?.length) return undefined
  return {
    system: [
      systemPrompt,
      'The previous step contained invalid tool calls. Those calls did not execute.',
      `Choose from these exact available tool names: ${JSON.stringify(exposedToolIds)} and follow the selected tool's input schema. Do not repeat an invalid call unchanged.`,
      'If no available tool can do the requested action, explain that limitation. Never claim execution or invent tool output.',
    ].join('\n'),
  }
}
