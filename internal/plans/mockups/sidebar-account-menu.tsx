import * as React from 'react'
import { Check, ChevronRight, LogOut, Plus } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../../../packages/overlay-ui/src/components/ui/popover'
import { toast } from '../../../packages/overlay-ui/src/components/ui/sonner'

declare const __PROFILE_PHOTO__: string

export function AccountMenu() {
  const [open, setOpen] = React.useState(true)
  const [workspace, setWorkspace] = React.useState('LayerNorm')
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="ghost" size="icon" className="account-avatar" aria-label="Workspace and account"><img src={__PROFILE_PHOTO__} alt="" className="profile-photo" /></Button></PopoverTrigger>
    <PopoverContent side="right" align="end" sideOffset={12} className="account-preview-menu">
      <Button variant="ghost" className="profile-link" onClick={() => { setOpen(false); toast('Account', { description: 'This opens your existing /account page.' }) }}>
        <img src={__PROFILE_PHOTO__} alt="" className="profile-photo" />
        <span><strong>Divyansh Lalwani</strong><small>life.dlalwani@gmail.com</small></span><ChevronRight size={14} />
      </Button>
      <div className="workspace-list"><div className="menu-section-label">Workspaces</div>
        {['LayerNorm', 'Personal'].map(name => <Button key={name} variant="ghost" className="workspace-option" onClick={() => setWorkspace(name)}><span className="workspace-icon">{name[0]}</span><span>{name}</span>{workspace === name && <Check size={14} />}</Button>)}
        <Button variant="ghost" className="workspace-option" onClick={() => toast('Create workspace', { description: 'Workspace creation is unchanged.' })}><Plus size={16} /><span>Create workspace</span></Button>
      </div>
      <Button variant="ghost" className="workspace-option sign-out" onClick={() => toast('Sign out', { description: 'Preview only. Your session is unchanged.' })}><LogOut size={15} /><span>Sign out</span></Button>
    </PopoverContent>
  </Popover>
}
