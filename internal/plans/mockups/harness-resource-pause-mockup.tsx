import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ChevronRight } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Input } from '../../../packages/overlay-ui/src/components/ui/input'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Label } from '../../../packages/overlay-ui/src/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../../packages/overlay-ui/src/components/ui/card'
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbSeparator, BreadcrumbPage } from '../../../packages/overlay-ui/src/components/ui/breadcrumb'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../packages/overlay-ui/src/components/ui/select'

const usd = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
const reasons = [['spend', 'Model spending limit'], ['time', 'Explicit time limit']]
const results = [['success', 'Authorized'], ['revoked', 'Access revoked'], ['changed', 'Request changed']]
const durations = [['1', '1 hour'], ['24', '24 hours'], ['168', '7 days']]

function Choice({ id, label, value, onChange, options }: {
  id: string; label: string; value: string; onChange: (value: string) => void; options: string[][]
}) {
  return <div className="flex flex-col gap-2">
    <Label htmlFor={id} className="text-xs text-(--muted)">{label}</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-48 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent>
    </Select>
  </div>
}

function Preview() {
  const [theme, setTheme] = React.useState('dark')
  const [scenario, setScenario] = React.useState('spend')
  const [result, setResult] = React.useState('success')
  const [state, setState] = React.useState('proposal')
  const [limit, setLimit] = React.useState('2.00')
  const [duration, setDuration] = React.useState('24')
  const [draft, setDraft] = React.useState('')
  const spend = scenario === 'spend'
  const total = Number(limit)
  const valid = /^\d+(\.\d{1,2})?$/.test(limit) && total > 1 && total <= 100
  React.useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const reset = () => { setState('proposal'); setLimit('2.00'); setDuration('24') }
  const detail = spend
    ? valid ? `Up to ${usd(total - 1)} more for Overlay-funded model usage. Other limits stay unchanged.` : 'The current $1.00 total limit stays in place until you approve.'
    : 'The $1.00 model spending limit and all other resource limits stay unchanged.'

  return <main className="mx-auto max-w-5xl p-4 sm:p-8">
    <header className="mb-6 flex items-start justify-between gap-4">
      <div><h1 className="text-lg font-semibold tracking-tight">Task pause and resume</h1><p className="mt-1 text-xs text-(--muted)">Interactive mockup. Example amounts, no billing actions.</p></div>
      <Button variant="outline" size="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</Button>
    </header>
    <div className="mb-4 flex flex-wrap items-end gap-4">
      <Choice id="scenario" label="Pause reason" value={scenario} onChange={value => { setScenario(value); setState('proposal') }} options={reasons} />
      <Choice id="result" label="Resume result" value={result} onChange={value => { setResult(value); setState('proposal') }} options={results} />
      <Button variant="ghost" size="sm" className="sm:ml-auto" onClick={reset}>Reset preview</Button>
    </div>
    <section className="overflow-hidden rounded-xl border border-(--border) bg-(--background)" aria-label="Example task conversation">
      <header className="flex h-14 items-center border-b border-(--border) px-4 sm:px-6">
        <Breadcrumb><BreadcrumbList className="text-xs"><BreadcrumbItem>Personal</BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>Product launch film</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <p className="mb-7 ml-auto w-fit max-w-[90%] rounded-2xl bg-(--surface-subtle) px-4 py-2.5 text-sm">Create the launch film from the approved script and save it to Files.</p>
        <div className="mb-6"><p className="mb-3 flex items-center gap-2 text-xs text-(--muted)"><ChevronRight className="size-3.5" />Built scenes and checked frames</p><p className="text-sm">The scenes are ready. Rendering and final checks are still pending.</p></div>
        <Card className="gap-3 py-4" aria-labelledby="pause-title">
          {state === 'proposal' ? <>
            <CardHeader className="gap-1 px-4">
              <CardTitle id="pause-title" className="text-sm font-medium">{spend ? 'Model spending limit reached' : 'Time authorization ended'}</CardTitle>
              <CardDescription className="text-xs">{spend ? 'Progress saved. Increase the limit to resume this task.' : 'Progress saved. Authorize more time to resume this task.'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-4">
              <p className="text-xs text-(--muted) tabular-nums">{spend ? '$0.94 used · $0.06 reserved · $1.00 limit' : 'Authorized for 24 hours · $0.72 of $1.00 used'}</p>
              <div className="space-y-2">
                {spend ? <><Label htmlFor="limit" className="text-xs">New total model limit (USD)</Label><Input id="limit" className="w-32 tabular-nums" inputMode="decimal" value={limit} onChange={event => setLimit(event.target.value)} aria-describedby="grant-detail validation" aria-invalid={!valid} /></>
                  : <Choice id="duration" label="Additional authorized time" value={duration} onChange={setDuration} options={durations} />}
                <p id="grant-detail" className="text-xs text-(--muted)">{detail}</p>
                {spend && !valid && <p id="validation" role="alert" className="border-l-2 border-(--muted) pl-2 text-xs">Enter a total above $1.00 and no more than $100.00, in cents.</p>}
              </div>
            </CardContent>
            <CardFooter className="flex-wrap gap-1.5 px-4">
              <Button variant="secondary" size="sm" disabled={spend && !valid} onClick={() => setState(result === 'success' ? 'resumed' : 'denied')}>{spend ? 'Raise limit & resume' : 'Extend time & resume'}</Button>
              <Button variant="ghost" size="sm" onClick={() => setState('paused')}>Keep paused</Button>
            </CardFooter>
          </> : <>
            <CardHeader className="gap-1 px-4" aria-live="polite">
              <CardTitle id="pause-title" className="text-sm font-medium">{state === 'paused' ? 'Task paused' : state === 'resumed' ? 'Resuming the same task' : 'Task remains paused'}</CardTitle>
              <CardDescription className="text-xs">{state === 'paused' ? 'Progress saved. No additional work is authorized.'
                : state === 'resumed' ? spend ? `Total model limit: ${usd(total)}. Other limits are unchanged.` : `Authorized for ${durations.find(([value]) => value === duration)?.[1]} more. The $1.00 model spending limit is unchanged.`
                : result === 'revoked' ? 'You no longer have permission to authorize this task. No limits changed.' : 'This request has changed. Review the latest limits before approving. No limits changed.'}</CardDescription>
            </CardHeader>
            {state !== 'resumed' && <CardFooter className="px-4"><Button variant="secondary" size="sm" onClick={() => setState('proposal')}>{state === 'paused' ? 'Review limits' : 'Review request'}</Button></CardFooter>}
          </>}
        </Card>
        <div className="mt-6 rounded-xl border border-(--border) p-3">
          <Textarea aria-label="Example unsent message" placeholder="Add a message..." className="min-h-16 border-0 bg-transparent shadow-none" value={draft} onChange={event => setDraft(event.target.value)} />
          <div className="mt-2 flex justify-between px-3 text-xs text-(--muted)"><span>Unsent draft</span><span>Preview only</span></div>
        </div>
      </div>
    </section>
    <p className="mt-3 text-xs text-(--muted)">{spend ? 'A spending approval is not a purchase or a guarantee of completion. Computer charges and user-owned provider accounts are separate.' : 'Only an explicitly time-bounded authorization needs this approval. Routine execution-lease renewal does not ask again or increase spending limits.'}</p>
  </main>
}

createRoot(document.getElementById('root')!).render(<Preview />)
