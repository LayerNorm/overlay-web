import type { ReactNode } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'
import { PEOPLE, VIEWER_PRINCIPAL } from '../../fixtures/agents'
import { ROOMS } from '../../fixtures/rooms'
import { PHOTOS } from './photos'

// Proposal 1: the account photo (or the agent's creature) wherever a person appears, with the initial as the fallback.

export function findPerson(principalId: string) {
  return PEOPLE.find((entry) => entry.principalId === principalId)
}

export function PrincipalAvatar({ principalId, name, size = 32 }: { principalId: string; name?: string; size?: number }) {
  const person = findPerson(principalId)
  const label = name ?? person?.displayName ?? '?'
  if (person?.type === 'agent') {
    return (
      <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden>
        <AgentCreature isDefault={person.isDefault} agent={{ name: label, avatarColor: person.avatarColor, avatarShape: person.avatarShape }} size={size} />
      </span>
    )
  }
  return (
    <Avatar className="shrink-0" style={{ width: size, height: size }}>
      <AvatarImage src={PHOTOS[principalId]} alt="" />
      <AvatarFallback className="font-medium text-(--muted)" style={{ fontSize: Math.max(8, Math.round(size * 0.4)) }}>
        {label.trim().slice(0, 1).toUpperCase() || '?'}
      </AvatarFallback>
    </Avatar>
  )
}

/** A direct message row: the other person's avatar, or two overlapping avatars for a group. */
export function DirectMessageAvatar({ chatId, fallback }: { chatId: string; fallback: ReactNode }) {
  const others = ROOMS.find((room) => room.id === chatId)?.participants.filter((id) => id !== VIEWER_PRINCIPAL) ?? []
  if (others.length === 0) return fallback
  if (others.length === 1) {
    return <span className="-mx-0.5 flex size-5 shrink-0 items-center justify-center"><PrincipalAvatar principalId={others[0]!} size={20} /></span>
  }
  return (
    <span className="relative -mx-0.5 block size-5 shrink-0">
      <span className="absolute left-0 top-0"><PrincipalAvatar principalId={others[0]!} size={13} /></span>
      <span className="absolute bottom-0 right-0 rounded-full ring-[1.5px] ring-(--background)"><PrincipalAvatar principalId={others[1]!} size={13} /></span>
    </span>
  )
}

export function mentionAvatar(mention: { type: string; id: string; name: string }): ReactNode {
  return findPerson(mention.id)?.type === 'human' ? <PrincipalAvatar principalId={mention.id} name={mention.name} size={14} /> : undefined
}
