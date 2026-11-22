import { Terminal } from '@xterm/headless'

/** Named keys for computer_terminal `keys`, sent as the bytes a real terminal would send. */
export const TERMINAL_KEYS = {
  Enter: '\r',
  Tab: '\t',
  Escape: '\x1b',
  Backspace: '\x7f',
  Delete: '\x1b[3~',
  Up: '\x1b[A',
  Down: '\x1b[B',
  Right: '\x1b[C',
  Left: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
  Space: ' ',
  'Ctrl-C': '\x03',
  'Ctrl-D': '\x04',
  'Ctrl-Z': '\x1a',
  'Ctrl-L': '\x0c',
  'Ctrl-A': '\x01',
  'Ctrl-E': '\x05',
  'Ctrl-U': '\x15',
  'Ctrl-W': '\x17',
  'Ctrl-R': '\x12',
  'Ctrl-X': '\x18',
  'Ctrl-O': '\x0f',
  'Ctrl-]': '\x1d',
} as const

export type TerminalKey = keyof typeof TERMINAL_KEYS
export const TERMINAL_KEY_NAMES = Object.keys(TERMINAL_KEYS) as [TerminalKey, ...TerminalKey[]]

export function terminalInputBytes(input: { data?: string; keys?: TerminalKey[] }): string {
  return `${input.data ?? ''}${(input.keys ?? []).map(key => TERMINAL_KEYS[key]).join('')}`
}

/** Bytes of recent pty output replayed to rebuild the screen. Enough for full-screen apps that redraw often. */
export const TERMINAL_SCREEN_REPLAY_BYTES = 256 * 1024

/**
 * Replays the tail of a pty's output through a headless xterm and returns what is on screen now, so progress bars,
 * spinners and full-screen programs (vim, less, top) cost one screen of context instead of every redraw.
 */
export async function renderTerminalScreen(output: string, cols: number, rows: number): Promise<{ screen: string; cursor: { line: number; column: number } }> {
  const terminal = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true })
  try {
    await new Promise<void>(resolve => terminal.write(output, resolve))
    const buffer = terminal.buffer.active
    const lines: string[] = []
    for (let row = 0; row < rows; row++) lines.push((buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '').trimEnd())
    while (lines.length && lines.at(-1) === '') lines.pop()
    return { screen: lines.join('\n'), cursor: { line: buffer.cursorY + 1, column: buffer.cursorX + 1 } }
  } finally {
    terminal.dispose()
  }
}
