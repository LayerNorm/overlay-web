import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { LocalToolCall, LocalToolRequest } from '@layernorm/overlay-agent-bridge-protocol'
import type { LocalToolExecutor } from './local-tools.js'

/**
 * The computer tools of a private thread. Names, inputs and approval rules match
 * the cloud tools (src/server/tools/tools/build.ts and @overlay/tools-core
 * toolRequiresApproval), so tool rows and approval cards look the same; the
 * calls run in this process through the same LocalToolExecutor that serves
 * synced threads on this computer.
 */
export function privateComputerTools(options: {
  executor: LocalToolExecutor
  approvalMode: 'ask' | 'auto'
  abortSignal: AbortSignal
}): ToolSet {
  const ask = options.approvalMode === 'ask'
  const run = async (request: LocalToolRequest, timeoutMs = 120_000) => {
    const now = Date.now()
    const call: LocalToolCall = {
      protocolVersion: 1,
      callId: `private-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      environmentId: 'private',
      workspaceId: 'private',
      issuedAt: now,
      deadlineAt: now + timeoutMs,
      request,
    }
    const outcome = await options.executor.execute(call, AbortSignal.any([options.abortSignal, AbortSignal.timeout(timeoutMs)]))
    return outcome.ok ? outcome.result : { error: outcome.error.code, message: outcome.error.message }
  }

  return {
    computer_exec: tool({
      description:
        'Run a shell command on this computer, in the thread\'s folder unless cwd says otherwise. ' +
        'Use for builds, scripts, tests, git and package installs. Output is truncated; prefer targeted commands over dumps.',
      inputSchema: z.object({
        command: z.string().min(1).max(100_000).describe('Full shell command to run'),
        cwd: z.string().max(4096).optional().describe('Absolute working directory for the command'),
        timeoutMs: z.number().int().min(5_000).max(300_000).optional().describe('Max run time in ms (default 60s, max 5m)'),
      }),
      needsApproval: () => ask,
      execute: async ({ command, cwd, timeoutMs }) => {
        const limit = timeoutMs ?? 60_000
        return await run({ kind: 'exec', command, ...(cwd ? { cwd } : {}), timeoutMs: limit }, limit + 5_000)
      },
    }),
    computer_read_file: tool({
      description: 'Read a text file on this computer (up to 256KB).',
      inputSchema: z.object({ path: z.string().min(1).max(4096).describe('Absolute path of the file to read') }),
      execute: async ({ path }) => await run({ kind: 'read_file', path, maxBytes: 256 * 1024 }),
    }),
    computer_write_file: tool({
      description: 'Write text contents to a file on this computer, creating or overwriting it.',
      inputSchema: z.object({
        path: z.string().min(1).max(4096).describe('Absolute path of the file to write'),
        contents: z.string().describe('Full text contents to write'),
      }),
      execute: async ({ path, contents }) =>
        await run({ kind: 'write_file', path, contentsBase64: Buffer.from(contents, 'utf8').toString('base64') }),
    }),
    computer_list_files: tool({
      description: 'List directory entries on this computer.',
      inputSchema: z.object({ path: z.string().min(1).max(4096).describe('Absolute path of the folder to list') }),
      execute: async ({ path }) => await run({ kind: 'list_files', path }),
    }),
    computer_terminal: tool({
      description:
        'Run long-running commands on this computer, such as servers, watchers or long builds. ' +
        'Start a session, poll its output with read, and cancel it when done. Starting a command may require approval.',
      inputSchema: z.object({
        action: z.enum(['start', 'read', 'cancel', 'list']),
        command: z.string().min(1).max(100_000).optional(),
        cwd: z.string().max(4096).optional(),
        id: z.string().regex(/^t-[0-9a-f]{12}$/).optional(),
        offset: z.number().int().min(0).optional(),
        maxBytes: z.number().int().min(1).max(65_536).optional(),
        signal: z.enum(['INT', 'TERM', 'KILL']).optional(),
      }).strict(),
      needsApproval: ({ action }) => ask && action === 'start',
      execute: async (input) => {
        const { action, ...args } = input
        return await run({ kind: 'driver', command: `terminal_${action}`, args } as LocalToolRequest)
      },
    }),
  }
}
