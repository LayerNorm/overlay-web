import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Server, BookOpen, Code2, Search, PenLine, Plus, ChevronRight, Trash2, Moon, Sun, CircleCheck, CircleAlert, Plug } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../../packages/overlay-ui/src/components/ui/card'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Badge } from '../../../packages/overlay-ui/src/components/ui/badge'
import { Switch } from '../../../packages/overlay-ui/src/components/ui/switch'
import { Input } from '../../../packages/overlay-ui/src/components/ui/input'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Label } from '../../../packages/overlay-ui/src/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../../packages/overlay-ui/src/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '../../../packages/overlay-ui/src/components/ui/alert-dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../packages/overlay-ui/src/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../../packages/overlay-ui/src/components/ui/tabs'

type Extension = {
  id: string; kind: 'mcp' | 'skill'; name: string; description: string; active: boolean
  state?: 'Connected' | 'Not connected' | 'Connection error'; url?: string; transport?: string; auth?: string; instructions?: string
}
const initial: Extension[] = [
  { id: 'monid', kind: 'mcp', name: 'Monid', description: 'Connect agents to your Monid workspace.', active: true, state: 'Not connected', url: 'https://mcp.monid.ai/v1', transport: 'HTTP', auth: 'OAuth' },
  { id: 'linear', kind: 'mcp', name: 'Linear', description: 'Issues, projects, and team updates.', active: true, state: 'Connected', url: 'https://mcp.linear.app/mcp', transport: 'HTTP', auth: 'OAuth' },
  { id: 'research', kind: 'mcp', name: 'Research', description: 'Search the web and collect references.', active: true, state: 'Connection error', url: 'https://research.example.com/mcp', transport: 'SSE', auth: 'Bearer token' },
  { id: 'writing', kind: 'skill', name: 'Writing', description: 'Clear, concise writing in your voice.', active: true, instructions: 'Write clearly and get to the point.\n\nUse short sentences and concrete examples. Match the tone of the conversation. Remove filler and unnecessary jargon.' },
  { id: 'review', kind: 'skill', name: 'Code review', description: 'Review changes for correctness and clarity.', active: true, instructions: 'Review the diff for correctness, security, and maintainability.\n\nPrioritize actionable findings. Explain the impact of each issue and suggest the smallest useful fix.' },
  { id: 'research-skill', kind: 'skill', name: 'Research', description: 'Find reliable sources and cite what matters.', active: false, instructions: 'Prefer primary sources. Distinguish evidence from assumptions. Include citations for key claims.' },
]
function ExtensionIcon({ item }: { item: Extension }) {
  const Icon = item.kind === 'mcp' ? Server : item.id === 'review' ? Code2 : item.id === 'research-skill' ? Search : PenLine
  return <div className="extension-icon"><Icon size={20} strokeWidth={1.6} /></div>
}
function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="field"><Label htmlFor={id}>{label}</Label>{children}</div>
}
function Choice({ id, value, values, onChange }: { id: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent>{values.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
}
function App() {
  const [items, setItems] = useState(initial)
  const [dark, setDark] = useState(false)
  const [draft, setDraft] = useState<Extension | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tab, setTab] = useState('mcp')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [dialogTab, setDialogTab] = useState('setup')
  const [timeout, setTimeout] = useState('30')
  const [credential, setCredential] = useState('')
  const [headerName, setHeaderName] = useState('Authorization')
  function open(item: Extension) { setDraft({ ...item }); setDialogTab('setup'); setCredential(''); setNotice('') }
  function update(patch: Partial<Extension>) { setDraft(current => current ? { ...current, ...patch } : current) }
  function save(event: React.FormEvent) {
    event.preventDefault()
    if (!draft) return
    setItems(current => current.some(item => item.id === draft.id) ? current.map(item => item.id === draft.id ? draft : item) : [...current, draft])
    setNotice(`${draft.name} saved in this preview.`); setDraft(null)
  }
  const list = items.filter(item => item.kind === tab && `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()))
  return <>
    <div className="preview-bar"><span>Design preview <span className="preview-divider">/</span> Cards & dialogs</span><Button variant="ghost" size="icon-sm" aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => { document.documentElement.classList.toggle('dark'); setDark(!dark) }}>{dark ? <Sun size={16} /> : <Moon size={16} />}</Button></div>
    <main>
      <header className="page-heading"><div><h1>Extensions</h1><p>Tools and instructions for your agents.</p></div><Button variant="primary" onClick={() => open({ id: `new-${Date.now()}`, name: '', description: '', active: true, kind: tab as 'mcp' | 'skill', url: '', transport: 'HTTP', auth: 'OAuth', state: 'Not connected', instructions: '' })}><Plus size={16} />{tab === 'mcp' ? 'Add server' : 'Add skill'}</Button></header>
      <Tabs value={tab} onValueChange={value => { setTab(value); setQuery('') }}>
        <div className="toolbar"><TabsList aria-label="Extension type"><TabsTrigger value="mcp"><Server size={15} />MCP servers</TabsTrigger><TabsTrigger value="skill"><BookOpen size={15} />Skills</TabsTrigger></TabsList><div className="search"><Search size={15} /><Input aria-label="Search extensions" placeholder={tab === 'mcp' ? 'Search servers...' : 'Search skills...'} value={query} onChange={e => setQuery(e.target.value)} /></div></div>
        <TabsContent value={tab} className="cards-grid">
          {list.map(item => <Card key={item.id} className="extension-card">
            <CardHeader><div className="card-top"><ExtensionIcon item={item} /><Badge variant="muted" className={item.state === 'Connection error' ? 'status-badge error' : 'status-badge'}>{item.kind === 'skill' ? <><span className={`status-dot ${item.active ? 'active' : ''}`} />{item.active ? 'Active' : 'Inactive'}</> : <><span className={`status-dot ${item.state === 'Connected' ? 'connected' : ''}`} />{item.state}</>}</Badge></div><CardTitle className="text-base mt-4">{item.name}</CardTitle><CardDescription className="leading-6 mt-1">{item.description}</CardDescription></CardHeader>
            <CardContent className="card-meta">{item.kind === 'mcp' ? <><span>{item.transport}</span><span className="meta-dot">·</span><span>{item.auth}</span></> : <><BookOpen size={14} /><span>Agent instructions</span></>}</CardContent>
            <CardFooter className="card-footer"><span className="footer-detail">{item.kind === 'mcp' ? new URL(item.url || 'https://example.com').hostname : 'Custom skill'}</span><Button variant="ghost" size="sm" onClick={() => open(item)}>Manage<ChevronRight size={14} /></Button></CardFooter>
          </Card>)}
          {!list.length && <div className="empty">No {tab === 'mcp' ? 'servers' : 'skills'} found.</div>}
        </TabsContent>
      </Tabs>
      <p className="preview-note" role="status">{notice || 'Interactive preview. Changes stay in this browser tab; no services are contacted.'}</p>
    </main>
    <Dialog open={!!draft} onOpenChange={open => { if (!open) setDraft(null) }}>
      <DialogContent className="editor-dialog">
        {draft && <form onSubmit={save} className="editor-form">
          <DialogHeader className="editor-header"><div className="dialog-heading"><ExtensionIcon item={draft} /><div><DialogTitle className="text-lg">{draft.name || (draft.kind === 'mcp' ? 'New server' : 'New skill')}</DialogTitle><DialogDescription className="text-sm mt-1">{draft.kind === 'mcp' ? 'Manage connection and tool access.' : 'Instructions your agents can use.'}</DialogDescription></div></div></DialogHeader>
          <div className="editor-body">
            {draft.kind === 'mcp' ? <Tabs value={dialogTab} onValueChange={setDialogTab}>
              <TabsList className="self-start mb-4"><TabsTrigger value="setup">Configuration</TabsTrigger><TabsTrigger value="tools">Tools</TabsTrigger></TabsList>
              <TabsContent value="setup" className="fields">
                <Field label="Name" id="name"><Input id="name" required value={draft.name} onChange={e => update({ name: e.target.value })} placeholder="My MCP server" /></Field>
                <Field label="Description" id="description"><Input id="description" value={draft.description} onChange={e => update({ description: e.target.value })} placeholder="What can this server do?" /></Field>
                <Field label="Server URL" id="url"><Input id="url" required type="url" value={draft.url} onChange={e => update({ url: e.target.value })} placeholder="https://mcp.example.com" /></Field>
                <div className="field-pair"><Field label="Transport" id="transport"><Choice id="transport" value={draft.transport || 'HTTP'} values={['HTTP', 'SSE']} onChange={transport => update({ transport })} /></Field><Field label="Authentication" id="auth"><Choice id="auth" value={draft.auth || 'OAuth'} values={['None', 'OAuth', 'Bearer token', 'Custom header']} onChange={auth => update({ auth })} /></Field></div>
                {draft.auth === 'Custom header' && <Field label="Header name" id="header"><Input id="header" value={headerName} onChange={e => setHeaderName(e.target.value)} /></Field>}
                {(draft.auth === 'Bearer token' || draft.auth === 'Custom header') && <Field label={draft.auth === 'Bearer token' ? 'Token' : 'Header value'} id="credential"><Input id="credential" type="password" placeholder="Preview only. Do not enter real credentials." value={credential} onChange={e => setCredential(e.target.value)} /></Field>}
                <div className="connection-row"><div>{draft.state === 'Connected' ? <CircleCheck size={18} /> : draft.state === 'Connection error' ? <CircleAlert size={18} className="error" /> : <Plug size={18} />}<div><strong>{draft.state}</strong><p>{draft.state === 'Connected' ? 'Ready to use with your agents.' : draft.state === 'Connection error' ? 'Check your server URL and credentials.' : 'Sign in to authorize this server.'}</p></div></div><Button size="sm" variant="outline" onClick={() => { setNotice('Preview only: no external connection was made.'); update({ state: 'Connected' }) }}>{draft.state === 'Connected' ? 'Test' : draft.state === 'Connection error' ? 'Retry' : 'Connect'}</Button></div>
                <Field label="Timeout (seconds)" id="timeout"><Input id="timeout" className="w-24" type="number" min="1" max="300" value={timeout} onChange={e => setTimeout(e.target.value)} /></Field>
              </TabsContent>
              <TabsContent value="tools"><div className="tools-empty"><Plug size={24} /><h3>{draft.state === 'Connected' ? 'Tool access' : 'Connect to view tools'}</h3><p>{draft.state === 'Connected' ? 'Available tools and their permissions appear here after discovery.' : 'Authorize this server before choosing which tools your agents can use.'}</p><span>Tool discovery is not run in this preview.</span></div></TabsContent>
            </Tabs> : <div className="fields">
              <Field label="Name" id="skill-name"><Input id="skill-name" required value={draft.name} onChange={e => update({ name: e.target.value })} placeholder="My skill" /></Field>
              <Field label="Description" id="skill-description"><Input id="skill-description" value={draft.description} onChange={e => update({ description: e.target.value })} /></Field>
              <Field label="Instructions" id="instructions"><Textarea id="instructions" className="instructions" value={draft.instructions} onChange={e => update({ instructions: e.target.value })} placeholder="Describe how your agent should approach this work." /><p className="field-help">Markdown is supported.</p></Field>
            </div>}
            <div className="active-row"><div><Label htmlFor="active">Active</Label><p>{draft.kind === 'mcp' ? 'Make this server available to your agents.' : 'Make this skill available to your agents.'}</p></div><Switch id="active" checked={draft.active} onCheckedChange={active => update({ active })} /></div>
          </div>
          <DialogFooter className="editor-footer"><Button variant="ghost" className="delete-button" disabled={!items.some(item => item.id === draft.id)} onClick={() => setConfirmDelete(true)}><Trash2 size={15} />Delete</Button><div className="footer-actions"><Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" type="submit">Save changes</Button></div></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}><AlertDialogContent className="delete-dialog"><AlertDialogHeader><AlertDialogTitle className="text-lg">Delete {draft?.name || 'this extension'}?</AlertDialogTitle><AlertDialogDescription className="text-sm leading-6 mt-2">{draft?.kind === 'mcp' ? 'This server and its tools will no longer be available to your agents.' : 'This skill will no longer be available to your agents.'} This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline">Cancel</Button></AlertDialogCancel><AlertDialogAction asChild><Button variant="danger" onClick={() => { setItems(items.filter(item => item.id !== draft?.id)); setNotice(`${draft?.name} removed from this preview.`); setDraft(null) }}>Delete {draft?.kind === 'mcp' ? 'server' : 'skill'}</Button></AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
