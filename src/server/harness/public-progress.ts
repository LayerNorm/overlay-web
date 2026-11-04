export const HARNESS_PUBLIC_PROGRESS_INSTRUCTION = 'This call is only a public progress update, not execution or the final answer. Instructions elsewhere to create or update plans, call tools, or finish the task apply only to later work calls. In one or two brief sentences, explain the next action before work begins, or summarize observed tool results and the next action after a tool batch. If a tool failed, explain the practical impact and your next approach. Use only facts in the conversation and persisted observations. Do not invent results, simulate tool calls, write tool-call XML or JSON, or answer the task. Do not expose private reasoning, internal identifiers, raw arguments, credentials, or implementation bookkeeping. Do not claim that work is complete. Do not call tools in this update. The task controller will resume work after this message.'

export const HARNESS_PUBLIC_PROGRESS_MAX_OUTPUT_TOKENS = 256

export const HARNESS_SILENT_TOOL_BATCHES = 3
