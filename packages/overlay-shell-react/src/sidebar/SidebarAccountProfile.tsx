'use client'

import { ChevronRight, UserRound } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, Button } from '@overlay/ui/primitives'
import { useShellAdapter } from '../adapter'

export function SidebarAccountAvatar({ name, photoUrl, className = 'size-7' }: {
  name: string
  photoUrl?: string
  className?: string
}) {
  return (
    <Avatar className={`shrink-0 ${className}`}>
      <AvatarImage src={photoUrl} alt="" />
      <AvatarFallback>{name.trim().slice(0, 1).toUpperCase() || <UserRound size={15} />}</AvatarFallback>
    </Avatar>
  )
}

export function SidebarAccountProfile({ name, email, photoUrl, onAccountClick }: {
  name: string
  email?: string
  photoUrl?: string
  onAccountClick: () => void
}) {
  const { Link } = useShellAdapter()
  return (
    <Button variant="ghost" className="h-auto w-full justify-start gap-2.5 px-2 py-2.5 text-left font-normal" asChild>
      <Link href="/account" onClick={onAccountClick} aria-label="Account">
        <SidebarAccountAvatar name={name} photoUrl={photoUrl} className="size-9" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{name}</span>
          {email ? <span className="mt-0.5 block truncate text-[11px] text-(--muted)">{email}</span> : null}
        </span>
        <ChevronRight size={14} className="shrink-0 text-(--muted)" aria-hidden />
      </Link>
    </Button>
  )
}
