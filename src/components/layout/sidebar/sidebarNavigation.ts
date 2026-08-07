import type { LucideIcon } from 'lucide-react'
import {
  ArrowUp,
  Chrome,
  FileText,
  FolderOpen,
  Mail,
  MessageSquare,
  Monitor,
  Package,
  Palette,
  PanelsLeftRight,
  Play,
  Plug,
  Puzzle,
  Server,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  User,
  Workflow,
} from 'lucide-react'
import type { OverlayIconName, OverlaySidebarSearchCategory } from '@overlay/app-core'
import type { MentionType } from '@/shared/knowledge/mention-types'

export const ICON_COMPONENTS: Partial<Record<OverlayIconName, LucideIcon>> = {
  'arrow-up': ArrowUp,
  chrome: Chrome,
  'file-text': FileText,
  'folder-open': FolderOpen,
  mail: Mail,
  'message-square': MessageSquare,
  monitor: Monitor,
  package: Package,
  palette: Palette,
  'panels-left-right': PanelsLeftRight,
  play: Play,
  plug: Plug,
  puzzle: Puzzle,
  server: Server,
  settings: Settings,
  'shield-check': ShieldCheck,
  smartphone: Smartphone,
  sparkles: Sparkles,
  user: User,
  workflow: Workflow,
}

export const PROFILE_APP_LINKS = [
  { label: 'Desktop App', icon: Monitor },
  { label: 'Mobile App', icon: Smartphone },
  { label: 'Chrome Extension', icon: Chrome },
] as const

export function toMentionCategory(category: OverlaySidebarSearchCategory | undefined): MentionType | null {
  switch (category) {
    case 'file':
      return 'file'
    case 'connector':
      return 'connector'
    case 'automation':
      return 'automation'
    case 'skill':
      return 'skill'
    case 'mcp':
      return 'mcp'
    case 'chat':
      return 'chat'
    default:
      return null
  }
}
