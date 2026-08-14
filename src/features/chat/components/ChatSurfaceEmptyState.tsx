import type { LucideIcon } from 'lucide-react'

export function ChatSurfaceEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <div className="flex h-full min-h-72 w-full items-center justify-center px-6 pb-16 text-center">
      <div className="max-w-sm">
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon size={19} strokeWidth={1.7} />
        </span>
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
