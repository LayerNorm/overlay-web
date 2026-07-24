import { MessageSquare, SlidersHorizontal } from 'lucide-react'
import type { AutomationDetailTab } from '@overlay/app-core'

export const AUTOMATION_DETAIL_TABS = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'edit', label: 'Edit', icon: SlidersHorizontal },
] satisfies Array<{ id: AutomationDetailTab; label: string; icon: typeof MessageSquare }>
