import type { ReactNode } from 'react'

/** One standard settings row: icon, title, one line of description and an optional control. */
export function SettingsAppRow({ icon, title, description, children }: {
  icon: ReactNode
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    // A control that doesn't fit beside the text (a select on a phone) wraps onto its own line instead of squeezing it.
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
        <span className="mt-0.5 flex w-4 shrink-0 justify-center text-(--muted)">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-(--foreground)">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-(--muted)">{description}</p>
        </div>
      </div>
      {children ? <div className="ms-auto flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  )
}
