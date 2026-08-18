import { Sparkles } from 'lucide-react'

export function EmptyState(): React.ReactElement<any> {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        color: 'rgba(255,255,255,0.3)'
      }}
    >
      <Sparkles size={24} strokeWidth={1.5} />
      <span
        style={{
          fontSize: 13,
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        Start a conversation
      </span>
    </div>
  )
}
