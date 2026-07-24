import React, { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, RotateCcw, FilePen, Copy, Check } from 'lucide-react'
import type { PanelTheme } from '../../hooks/usePanelTheme'

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

interface DiffLine {
  type: 'removed' | 'added' | 'context'
  content: string
  lineNum: number
}

function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const lines: DiffLine[] = []

  // Find common prefix length (line-by-line)
  let prefixLen = 0
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++
  }

  // Find common suffix length
  let suffixLen = 0
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++
  }

  const CONTEXT = 2

  // Context before
  const ctxStart = Math.max(0, prefixLen - CONTEXT)
  for (let i = ctxStart; i < prefixLen; i++) {
    lines.push({ type: 'context', content: oldLines[i], lineNum: i + 1 })
  }

  // Removed lines
  for (let i = prefixLen; i < oldLines.length - suffixLen; i++) {
    lines.push({ type: 'removed', content: oldLines[i], lineNum: i + 1 })
  }

  // Added lines
  for (let i = prefixLen; i < newLines.length - suffixLen; i++) {
    lines.push({ type: 'added', content: newLines[i], lineNum: i + 1 })
  }

  // Context after
  const ctxEnd = Math.min(oldLines.length, oldLines.length - suffixLen + CONTEXT)
  for (let i = oldLines.length - suffixLen; i < ctxEnd; i++) {
    lines.push({ type: 'context', content: oldLines[i], lineNum: i + 1 })
  }

  return lines
}

function countChanges(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.type === 'added').length,
    removed: lines.filter((l) => l.type === 'removed').length
  }
}

async function performUndo(
  filePath: string,
  newStr: string,
  oldStr: string,
  cwd?: string
): Promise<boolean> {
  try {
    // Encode strings as base64 to safely pass through shell
    const nsB64 = btoa(unescape(encodeURIComponent(newStr)))
    const osB64 = btoa(unescape(encodeURIComponent(oldStr)))
    const fpB64 = btoa(unescape(encodeURIComponent(filePath)))
    const cmd =
      `node -e "` +
      `const fs=require('fs'),path=require('path');` +
      `const fp=Buffer.from('${fpB64}','base64').toString('utf8');` +
      `const ns=Buffer.from('${nsB64}','base64').toString('utf8');` +
      `const os=Buffer.from('${osB64}','base64').toString('utf8');` +
      `let c=fs.readFileSync(fp,'utf8');` +
      `c=c.replace(ns,os);` +
      `fs.writeFileSync(fp,c,'utf8');` +
      `"`
    const result = await window.bridge.terminal.run(cmd, cwd ?? undefined)
    return result.success && (result.exitCode ?? 0) === 0
  } catch {
    return false
  }
}

export interface FileDiffBlockProps {
  theme: PanelTheme
  toolInput?: Record<string, unknown>
  toolResult?: string
  isLoading: boolean
  workingFolder?: string | null
}

export function FileDiffBlock({
  theme,
  toolInput,
  toolResult,
  isLoading,
  workingFolder
}: FileDiffBlockProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const [undoState, setUndoState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [copied, setCopied] = useState(false)
  const startTimeRef = useRef<number>(Date.now())
  const [elapsedS, setElapsedS] = useState<number | null>(null)

  // Track elapsed time
  useEffect(() => {
    if (isLoading) {
      startTimeRef.current = Date.now()
      setElapsedS(null)
    } else if (elapsedS === null) {
      setElapsedS(Math.round((Date.now() - startTimeRef.current) / 1000))
    }
  }, [isLoading])

  // code_edit_file uses 'path'; fall back to 'file_path' for other tools
  const filePath =
    typeof toolInput?.path === 'string'
      ? toolInput.path
      : typeof toolInput?.file_path === 'string'
        ? toolInput.file_path
        : ''
  const oldStr = typeof toolInput?.old_string === 'string' ? toolInput.old_string : ''
  const newStr = typeof toolInput?.new_string === 'string' ? toolInput.new_string : ''

  const isCreate =
    (typeof toolInput?.create_if_not_exists === 'boolean' && toolInput.create_if_not_exists) ||
    (oldStr === '' && newStr !== '')

  let result: Record<string, unknown> | null = null
  try {
    if (toolResult) result = JSON.parse(toolResult) as Record<string, unknown>
  } catch {
    // ignore
  }
  const success = result?.success !== false

  const diffLines = computeDiff(oldStr, newStr)
  const { added, removed } = countChanges(diffLines)
  const shortPath = filePath.split('/').pop() ?? filePath

  const handleCopy = (): void => {
    const text = diffLines
      .map((l) => (l.type === 'removed' ? `- ${l.content}` : l.type === 'added' ? `+ ${l.content}` : `  ${l.content}`))
      .join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleUndo = async (): Promise<void> => {
    setUndoState('loading')
    const ok = await performUndo(filePath, newStr, oldStr, workingFolder ?? undefined)
    setUndoState(ok ? 'done' : 'error')
    if (ok) setTimeout(() => setUndoState('idle'), 2000)
  }

  const borderColor = success && !isLoading ? theme.border : '#ef4444'

  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        overflow: 'hidden',
        marginTop: 4,
        marginBottom: 2,
        fontFamily: MONO
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 10px',
          background: theme.surfaceBg,
          borderBottom: collapsed ? 'none' : `1px solid ${theme.border}`,
          cursor: 'pointer',
          userSelect: 'none'
        }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <FilePen size={12} color={theme.iconColorMuted} style={{ flexShrink: 0 }} />
        <span
          style={{
            fontSize: 11,
            color: theme.textSecondary,
            fontWeight: 500,
            fontFamily: MONO,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {isLoading ? (isCreate ? 'Creating' : 'Editing') : isCreate ? 'Created file' : 'Edited file'}
        </span>

        {/* +N -N counts */}
        {!isLoading && (added > 0 || removed > 0) && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {added > 0 && (
              <span style={{ fontSize: 10, color: '#4ade80', fontWeight: 600 }}>+{added}</span>
            )}
            {removed > 0 && (
              <span style={{ fontSize: 10, color: '#f87171', fontWeight: 600 }}>-{removed}</span>
            )}
          </div>
        )}

        {/* Copy button */}
        {!isLoading && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleCopy()
            }}
            title="Copy diff"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '1px 2px',
              borderRadius: 3,
              color: theme.iconColorMuted
            }}
          >
            {copied ? <Check size={11} color="#4ade80" /> : <Copy size={11} />}
          </button>
        )}

        {collapsed ? (
          <ChevronDown size={12} color={theme.iconColorMuted} />
        ) : (
          <ChevronUp size={12} color={theme.iconColorMuted} />
        )}
      </div>

      {/* Diff body */}
      {!collapsed && (
        <div style={{ background: '#0e0e0e', overflow: 'hidden' }}>
          {/* Filename row */}
          <div
            style={{
              padding: '5px 10px',
              borderBottom: `1px solid rgba(255,255,255,0.07)`,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>
              {shortPath}
            </span>
            {added > 0 && (
              <span style={{ fontSize: 10, color: '#4ade80', fontWeight: 600 }}>+{added}</span>
            )}
            {removed > 0 && (
              <span style={{ fontSize: 10, color: '#f87171', fontWeight: 600 }}>-{removed}</span>
            )}
          </div>

          {/* Diff lines */}
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {isLoading ? (
              <div
                style={{
                  padding: '10px 14px',
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.4)',
                  fontFamily: MONO,
                  fontStyle: 'italic'
                }}
              >
                Applying edit…
              </div>
            ) : diffLines.length === 0 ? (
              <div
                style={{
                  padding: '10px 14px',
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.4)',
                  fontFamily: MONO
                }}
              >
                No changes
              </div>
            ) : (
              diffLines.map((line, i) => {
                const bg =
                  line.type === 'removed'
                    ? 'rgba(239,68,68,0.18)'
                    : line.type === 'added'
                      ? 'rgba(74,222,128,0.15)'
                      : 'transparent'
                const borderLeft =
                  line.type === 'removed'
                    ? '3px solid rgba(239,68,68,0.7)'
                    : line.type === 'added'
                      ? '3px solid rgba(74,222,128,0.7)'
                      : '3px solid transparent'
                const textColor =
                  line.type === 'removed'
                    ? '#fca5a5'
                    : line.type === 'added'
                      ? '#86efac'
                      : 'rgba(255,255,255,0.65)'

                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      background: bg,
                      borderLeft,
                      minHeight: 20
                    }}
                  >
                    {/* Line number */}
                    <div
                      style={{
                        width: 36,
                        padding: '1px 8px',
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.25)',
                        textAlign: 'right',
                        flexShrink: 0,
                        userSelect: 'none',
                        borderRight: '1px solid rgba(255,255,255,0.07)'
                      }}
                    >
                      {line.lineNum}
                    </div>
                    {/* Prefix (+/-/ ) */}
                    <div
                      style={{
                        width: 16,
                        padding: '1px 0 1px 6px',
                        fontSize: 11,
                        color:
                          line.type === 'removed'
                            ? '#f87171'
                            : line.type === 'added'
                              ? '#4ade80'
                              : 'transparent',
                        flexShrink: 0
                      }}
                    >
                      {line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' '}
                    </div>
                    {/* Content */}
                    <pre
                      style={{
                        margin: 0,
                        padding: '1px 8px 1px 4px',
                        fontSize: 11,
                        lineHeight: 1.5,
                        fontFamily: MONO,
                        color: textColor,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        flex: 1
                      }}
                    >
                      {line.content}
                    </pre>
                  </div>
                )
              })
            )}
          </div>

          {/* "Worked for Xs" timing bar */}
          {!isLoading && elapsedS !== null && (
            <div
              style={{
                padding: '5px 10px',
                borderTop: '1px solid rgba(255,255,255,0.07)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: 'rgba(255,255,255,0.07)'
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.3)',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  whiteSpace: 'nowrap'
                }}
              >
                Worked for {elapsedS}s
              </span>
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: 'rgba(255,255,255,0.07)'
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Summary footer — shown when done */}
      {!isLoading && success && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            borderTop: collapsed ? 'none' : `1px solid ${theme.border}`,
            background: theme.surfaceBg
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: theme.textMuted,
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            {shortPath}
            {added > 0 && (
              <span style={{ color: '#4ade80', marginLeft: 6 }}>+{added}</span>
            )}
            {removed > 0 && (
              <span style={{ color: '#f87171', marginLeft: 4 }}>-{removed}</span>
            )}
          </span>

          {!isCreate && oldStr && newStr && (
            <button
              onClick={handleUndo}
              disabled={undoState === 'loading' || undoState === 'done'}
              title="Undo this edit"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                borderRadius: 5,
                border: `1px solid ${theme.border}`,
                background: 'transparent',
                color:
                  undoState === 'done'
                    ? '#4ade80'
                    : undoState === 'error'
                      ? '#f87171'
                      : theme.textMuted,
                fontSize: 11,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                cursor: undoState === 'loading' ? 'wait' : 'pointer',
                transition: 'all 0.15s'
              }}
            >
              <RotateCcw size={10} />
              {undoState === 'done' ? 'Undone' : undoState === 'error' ? 'Failed' : 'Undo'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
