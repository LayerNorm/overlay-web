import { tool, type ToolSet } from 'ai'
import { z } from 'zod/v3'
import {
  browserActionText,
  computerBrowserFields,
  computerBrowserUrlSchema,
  computerBrowserVariants,
  computerInputDriverCommand,
  computerInputFields,
  computerInputVariants,
  computerTerminalFields,
  computerTerminalVariants,
  computerToolInputSchema,
  computerToolRequiresApproval,
  type ComputerBrowserAction,
  type ComputerInputAction,
  type LocalToolCall,
  type LocalToolRequest,
} from '@layernorm/overlay-agent-bridge-protocol'
import type { LocalToolExecutor } from './local-tools.js'

/**
 * The computer tools of a private thread. Names, inputs, approval rules and browser result text come from the bridge
 * protocol (`computer-tools.ts`), which the cloud tools use too, so tool rows and approval cards look the same; the
 * calls run in this process through the same LocalToolExecutor that serves synced threads on this computer.
 *
 * Screen control (screenshots and input) is macOS only, like the host's driver; the browser needs Chrome, Chromium,
 * Brave or Edge on macOS or Linux.
 */
export function privateComputerTools(options: {
  executor: LocalToolExecutor
  approvalMode: 'ask' | 'auto'
  abortSignal: AbortSignal
  platform?: NodeJS.Platform
}): ToolSet {
  const platform = options.platform ?? process.platform
  const needsApproval = (toolName: string) => (input: unknown) =>
    options.approvalMode === 'ask' && computerToolRequiresApproval(toolName, input)
  const run = async (request: LocalToolRequest, timeoutMs = 120_000): Promise<Record<string, unknown>> => {
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
    return outcome.ok ? outcome.result as Record<string, unknown> : { error: outcome.error.code, message: outcome.error.message }
  }
  const driver = async (command: string, args: Record<string, unknown> = {}) =>
    await run({ kind: 'driver', command, args } as LocalToolRequest)

  const tools: ToolSet = {
    computer_exec: tool({
      description:
        'Run a shell command on this computer, in the thread\'s folder unless cwd says otherwise. ' +
        'Use for builds, scripts, tests, git and package installs. Output is truncated; prefer targeted commands over dumps.',
      inputSchema: z.object({
        command: z.string().min(1).max(100_000).describe('Full shell command to run'),
        cwd: z.string().max(4096).optional().describe('Absolute working directory for the command'),
        timeoutMs: z.number().int().min(5_000).max(300_000).optional().describe('Max run time in ms (default 60s, max 5m)'),
      }),
      needsApproval: needsApproval('computer_exec'),
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
      inputSchema: computerToolInputSchema(computerTerminalFields, computerTerminalVariants),
      needsApproval: needsApproval('computer_terminal'),
      execute: async (input) => {
        const { action, ...args } = input as { action: string } & Record<string, unknown>
        return await driver(`terminal_${action}`, args)
      },
    }),
  }

  if (platform === 'darwin' || platform === 'linux') {
    tools.computer_open_url = tool({
      description:
        'Open a URL in the browser on this computer, where the person can see it. ' +
        'Serve local HTML over HTTP(S); file:// URLs are unsupported.',
      inputSchema: z.object({ url: computerBrowserUrlSchema.describe('The HTTP or HTTPS URL to open') }),
      execute: async ({ url }) => await driver('open_url', { url }),
    })
    tools.computer_browser = tool({
      description:
        'Control a browser on this computer, in its own Overlay profile that keeps its sign-ins. Prefer this tool for websites: ' +
        'take a snapshot, then act using its element refs. Typing, focus and navigation can replace page elements; take a fresh ' +
        'snapshot after page changes and before reusing refs. If stale_browser_ref is returned, no action occurred: take a new ' +
        'snapshot and choose the current target. For a potentially consequential click, call click with confirm: true so the ' +
        'person can approve it.' + (platform === 'darwin' ? ' Use computer_screenshot and computer_input for other apps.' : ''),
      inputSchema: computerToolInputSchema(computerBrowserFields, computerBrowserVariants),
      needsApproval: needsApproval('computer_browser'),
      execute: async (input) => {
        const { action, ...args } = computerBrowserVariants.parse(input) as ComputerBrowserAction
        const ensured = await driver('browser_ensure')
        if (typeof ensured.error === 'string') return ensured
        const result = await driver('browser', { ...args, action })
        if (typeof result.error === 'string') return result
        return { success: true, action, text: browserActionText(action, args, result) }
      },
      toModelOutput: ({ output }) => ({
        type: 'text',
        value: typeof output?.text === 'string' ? output.text
          : typeof output?.message === 'string' ? output.message
            : typeof output?.error === 'string' ? output.error : 'Browser action failed.',
      }),
    })
  }

  if (platform === 'darwin') {
    tools.computer_screenshot = tool({
      description: 'Capture the visible screen on this computer and return it as an image.',
      inputSchema: z.object({}).strict(),
      execute: async () => await driver('screenshot'),
      toModelOutput: ({ output }) => {
        if (typeof output?.imageBase64 !== 'string') {
          return { type: 'text', value: typeof output?.message === 'string' ? output.message : SCREENSHOT_NOT_KEPT }
        }
        return {
          type: 'content',
          value: [
            { type: 'text', text: `Screenshot captured at ${String(output.width)} by ${String(output.height)} pixels.` },
            {
              type: 'file',
              data: { type: 'data', data: output.imageBase64 },
              mediaType: typeof output.mediaType === 'string' ? output.mediaType : 'image/jpeg',
            },
          ],
        }
      },
    })
    tools.computer_input = tool({
      description:
        'Interact with the visible screen using coordinates from the latest computer_screenshot. ' +
        'Take a screenshot before choosing coordinates and after each action to verify the result. ' +
        'Risky coordinate clicks require confirm: true so the person can approve them. ' +
        'click, double_click, right_click and move require x and y; drag requires from and to; ' +
        'type requires text; key requires keys; scroll requires direction and amount with optional x and y; wait requires ms.',
      inputSchema: computerToolInputSchema(computerInputFields, computerInputVariants),
      needsApproval: needsApproval('computer_input'),
      execute: async (input) => {
        const action = computerInputVariants.parse(input) as ComputerInputAction
        const { command, args } = computerInputDriverCommand(action)
        const result = await driver(command, args)
        if (typeof result.error === 'string') return result
        return { success: true, acknowledgement: `${action.action.replace('_', ' ')} completed.` }
      },
    })
  }

  return tools
}

export const SCREENSHOT_NOT_KEPT = 'An earlier screenshot; its image is not kept. Take a new one to see the screen.'
