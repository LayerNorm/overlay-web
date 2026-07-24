import React, { useState } from 'react'
import { Terminal, ChevronDown, ChevronUp, CheckCircle, XCircle, Loader2 } from 'lucide-react'

interface TerminalOutputBlockTheme {
  textSecondary: string
  text: string
  border: string
  surfaceBg: string
}

interface TerminalOutputBlockProps {
  theme: TerminalOutputBlockTheme
  tool: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  isLoading: boolean
}

function parseResult(toolResult?: string): Record<string, unknown> | null {
  if (!toolResult) return null
  try {
    return JSON.parse(toolResult) as Record<string, unknown>
  } catch {
    return null
  }
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

export function TerminalOutputBlock({
  theme,
  tool,
  toolInput,
  toolResult,
  isLoading
}: TerminalOutputBlockProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const result = parseResult(toolResult)

  const command =
    typeof toolInput?.command === 'string'
      ? toolInput.command
      : typeof toolInput?.input === 'string'
        ? toolInput.input.replace(/\n$/, '')
        : null

  const output =
    typeof result?.output === 'string'
      ? stripAnsi(result.output)
      : typeof result?.stdout === 'string'
        ? stripAnsi(result.stdout)
        : null

  const exitCode = typeof result?.exitCode === 'number' ? result.exitCode : undefined
  const timedOut = result?.timedOut === true
  const success = result?.success === true
  const hasOutput = output && output.trim().length > 0
  const outputLines = output?.split('\n') || []
  const isLong = outputLines.length > 8
  const visibleOutput = expanded ? output : outputLines.slice(0, 8).join('\n')

  // Determine label
  let label = 'Terminal'
  if (tool === 'terminal_run' && command) {
    label = command.length > 60 ? command.slice(0, 59) + '…' : command
  } else if (tool === 'terminal_session_write' && command) {
    label = command.length > 60 ? command.slice(0, 59) + '…' : command
  } else if (tool === 'terminal_session_read') {
    label = 'Terminal output'
  } else if (tool === 'terminal_session_start') {
    label = 'Started terminal session'
  } else if (tool === 'terminal_session_kill') {
    label = 'Killed terminal session'
  } else if (tool === 'terminal_list_sessions') {
    label = 'Terminal sessions'
  }

  return (
    <div
      style={{
        borderRadius: 6,
        border: `1px solid ${theme.border}`,
        overflow: 'hidden',
        marginTop: 2,
        marginBottom: 2
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          background: theme.surfaceBg,
          borderBottom: hasOutput ? `1px solid ${theme.border}` : 'none',
          cursor: hasOutput ? 'pointer' : 'default'
        }}
        onClick={() => hasOutput && setExpanded((e) => !e)}
      >
        {isLoading ? (
          <Loader2
            size={12}
            color={theme.textSecondary}
            style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}
          />
        ) : timedOut ? (
          <XCircle size={12} color="#f59e0b" style={{ flexShrink: 0 }} />
        ) : exitCode !== undefined && exitCode !== 0 ? (
          <XCircle size={12} color="#ef4444" style={{ flexShrink: 0 }} />
        ) : success ? (
          <CheckCircle size={12} color={theme.textSecondary} style={{ flexShrink: 0 }} />
        ) : (
          <Terminal size={12} color={theme.textSecondary} style={{ flexShrink: 0 }} />
        )}
        <span
          style={{
            fontSize: 11,
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            color: theme.textSecondary,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {label}
        </span>
        {exitCode !== undefined && exitCode !== 0 && (
          <span
            style={{
              fontSize: 10,
              color: '#ef4444',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
            }}
          >
            exit {exitCode}
          </span>
        )}
        {timedOut && (
          <span
            style={{
              fontSize: 10,
              color: '#f59e0b',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
            }}
          >
            timed out
          </span>
        )}
        {hasOutput &&
          (expanded ? (
            <ChevronUp size={12} color={theme.textSecondary} style={{ flexShrink: 0 }} />
          ) : (
            <ChevronDown size={12} color={theme.textSecondary} style={{ flexShrink: 0 }} />
          ))}
      </div>

      {/* Output body */}
      {hasOutput && (
        <div
          style={{
            padding: '6px 8px',
            background: '#0d0d0d',
            maxHeight: expanded ? 400 : 'none',
            overflowY: expanded ? 'auto' : 'hidden'
          }}
        >
          <pre
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.4,
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              color: '#d4d4d4',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {visibleOutput}
          </pre>
          {isLong && !expanded && (
            <div
              style={{
                fontSize: 10,
                color: theme.textSecondary,
                marginTop: 4,
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(true)
              }}
            >
              +{outputLines.length - 8} more lines
            </div>
          )}
        </div>
      )}
    </div>
  )
}
