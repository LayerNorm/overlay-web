import { Avatar, AvatarFallback, AvatarImage } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'

export type PrincipalAvatarIdentity = {
  name: string
  principalType?: string
  photoUrl?: string | null
  avatarColor?: string
  avatarShape?: string
  isDefault?: boolean
}

/** A person's account photo or an agent's creature, with the initial as the fallback. */
export function PrincipalAvatar({ principal, size = 32 }: { principal: PrincipalAvatarIdentity; size?: number }) {
  if (principal.principalType === 'agent') {
    return (
      <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden>
        <AgentCreature
          isDefault={principal.isDefault}
          agent={{ name: principal.name, avatarColor: principal.avatarColor, avatarShape: principal.avatarShape }}
          size={size}
        />
      </span>
    )
  }
  return (
    <Avatar className="shrink-0" style={{ width: size, height: size }} aria-hidden>
      <AvatarImage src={principal.photoUrl ?? undefined} alt="" />
      <AvatarFallback className="font-medium text-(--muted)" style={{ fontSize: Math.max(8, Math.round(size * 0.4)) }}>
        {principal.name.trim().slice(0, 1).toUpperCase() || '?'}
      </AvatarFallback>
    </Avatar>
  )
}
