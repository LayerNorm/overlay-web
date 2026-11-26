// Shared with private threads in the Agent Host; see packages/overlay-agent-bridge-protocol/src/agent-context.ts.
export {
  BASE_SYSTEM_TOOL_OVERHEAD_TOKENS,
  CONTEXT_TARGET_RATIO,
  CONTEXT_TRIGGER_RATIO,
  FALLBACK_CONTEXT_WINDOW,
  MAX_SUMMARY_OUTPUT_TOKENS,
  MIN_SUMMARY_OUTPUT_TOKENS,
  PRESERVED_RECENT_MESSAGES,
  buildSummaryPrompt,
  compactHarnessPrompt,
  estimateContextTokens,
  type CompactableMessage,
  type HarnessPromptCompaction,
  type SummaryMessage,
} from '@layernorm/overlay-agent-bridge-protocol'
