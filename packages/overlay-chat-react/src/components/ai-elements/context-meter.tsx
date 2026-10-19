function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

export function contextMeterLabel(usedTokens: number, contextWindow: number): string {
  const percent = Math.round(Math.min(1, Math.max(0, usedTokens / contextWindow)) * 100)
  return `${percent}% of context used (${formatTokens(usedTokens)} of ${formatTokens(contextWindow)} tokens)`
}

/** Small ring showing how much of the model's context window the conversation uses. */
export function ContextMeter({
  usedTokens,
  contextWindow,
  className,
}: {
  usedTokens: number
  contextWindow: number
  className?: string
}) {
  if (!(contextWindow > 0) || !(usedTokens >= 0)) return null
  const ratio = Math.min(1, usedTokens / contextWindow)
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const label = contextMeterLabel(usedTokens, contextWindow)
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-slot="context-meter"
      data-high={ratio >= 0.8 || undefined}
      className={`flex size-9 shrink-0 items-center justify-center ${ratio >= 0.8 ? 'text-(--foreground)' : 'text-(--muted)'} ${className ?? ''}`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
        <circle
          cx="9"
          cy="9"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform="rotate(-90 9 9)"
        />
      </svg>
    </span>
  )
}

/** Tokens the next turn starts from: the latest finished reply's usage. */
export function latestContextUsage(
  messages: ReadonlyArray<{ role?: string; metadata?: unknown }>,
): { usedTokens: number; contextWindow: number } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant') continue
    const metadata = message.metadata as
      | { usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; contextWindow?: number }
      | undefined
    const usage = metadata?.usage
    const contextWindow = metadata?.contextWindow
    if (!usage || !contextWindow) continue
    const usedTokens = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    return usedTokens > 0 ? { usedTokens, contextWindow } : null
  }
  return null
}
