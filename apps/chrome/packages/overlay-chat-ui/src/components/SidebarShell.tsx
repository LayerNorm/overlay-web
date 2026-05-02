import type { ReactNode } from 'react'

interface SidebarShellProps {
  sidebar: ReactNode
  header: ReactNode
  content: ReactNode
  footer: ReactNode
}

export function SidebarShell({ sidebar, header, content, footer }: SidebarShellProps) {
  return (
    <div className="flex h-full overflow-hidden bg-[#fafafa] text-[#0a0a0a]">
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-[#e5e5e5] bg-[#f5f5f5]">
        {sidebar}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-[#e5e5e5] bg-white">{header}</header>
        {content}
        {footer}
      </main>
    </div>
  )
}
