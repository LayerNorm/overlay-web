'use client'

import { useId, useRef, useState } from 'react'
import {
  Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
  Input, Label, ListboxSelect,
} from '@overlay/ui/primitives'
import {
  MAX_HARNESS_RESOURCE_SPEND_MICROS,
  type HarnessResourceGrant,
  type HarnessResourceGrantReceipt,
  type HarnessResourceRequest,
} from '@overlay/agent-runtime/harness-resource'

const durations = [
  { value: '3600000', label: '1 hour' },
  { value: '86400000', label: '24 hours' },
  { value: '604800000', label: '7 days' },
]
const usd = (micros: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(micros / 1_000_000)

export function parseResourceLimit(value: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const micros = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * 10_000
  return micros <= MAX_HARNESS_RESOURCE_SPEND_MICROS ? micros : null
}

type ResourceRequestProps = {
  request: HarnessResourceRequest
  canAuthorize: boolean
  receipt?: HarnessResourceGrantReceipt
  awaitingReceipt?: boolean
  onGrant: (grant: HarnessResourceGrant) => Promise<HarnessResourceGrantReceipt>
}

export function RunResourceRequest(props: ResourceRequestProps) {
  return <ResourceRequestCard key={`${props.request.runId}:${props.request.token}:${props.request.policyRevision}`} {...props} />
}

function useResourceForm(request: HarnessResourceRequest) {
  const minimum = request.usedCostMicros + request.reservedCostMicros + request.requiredCostMicros
  const suggested = Math.min(MAX_HARNESS_RESOURCE_SPEND_MICROS, Math.ceil(Math.max(request.currentMaxCostMicros + 1_000_000, minimum) / 10_000) * 10_000)
  const [limit, setLimit] = useState(() => (suggested / 1_000_000).toFixed(2))
  const [duration, setDuration] = useState('86400000')
  const total = parseResourceLimit(limit)
  const valid = total !== null && total > request.currentMaxCostMicros && total >= minimum
  const spend = request.reason === 'model_spend'
  return { minimum, limit, setLimit, duration, setDuration, total, valid, spend }
}

function ResourceRequestCard({ request, canAuthorize, receipt, awaitingReceipt, onGrant }: ResourceRequestProps) {
  const id = useId()
  const [dismissed, setDismissed] = useState(false)
  const form = useResourceForm(request)
  const { spend, valid, total, duration } = form
  const { submitting, error, authorization, authorize } = useResourceAuthorization({ request, canAuthorize, receipt, onGrant })
  const proposed = !dismissed && !authorization

  const submit = () => {
    if (spend && !valid) return
    const grant: HarnessResourceGrant = spend
      ? { kind: 'model_spend', newMaxCostMicros: total! }
      : { kind: 'time', durationMs: Number(duration) }
    void authorize(grant)
  }

  return <div className="mb-2">
    <Card className="gap-3 py-4" aria-labelledby={`${id}-title`} aria-busy={submitting}>
      {proposed ? <>
        <CardHeader className="gap-1 px-4">
          <CardTitle id={`${id}-title`} className="text-sm font-medium">{spend ? 'Model spending limit reached' : 'Time authorization ended'}</CardTitle>
          <CardDescription className="text-xs">{spend ? 'Progress saved. Increase the limit to resume this task.' : 'Progress saved. Authorize more time to resume this task.'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-4">
          <p className="text-xs text-(--muted) tabular-nums">{usd(request.usedCostMicros)} used · {usd(request.reservedCostMicros)} reserved · {usd(request.currentMaxCostMicros)} limit</p>
          {canAuthorize ? <ResourceAuthorizationFields id={id} request={request} form={form} disabled={submitting} />
            : <p className="text-xs text-(--muted)" role="status">Waiting for the authorized owner to review these limits.</p>}
          {error && <p role="alert" className="text-xs">{error}</p>}
        </CardContent>
        {canAuthorize && <CardFooter className="flex-wrap gap-1.5 px-4">
          <Button variant="secondary" size="sm" disabled={submitting || (spend && !valid)} onClick={() => void submit()}>
            {submitting ? 'Authorizing...' : spend ? 'Raise limit & resume' : 'Extend time & resume'}
          </Button>
          <Button variant="ghost" size="sm" disabled={submitting} onClick={() => setDismissed(true)}>Keep paused</Button>
        </CardFooter>}
      </> : <>
        <CardHeader className="gap-1 px-4" aria-live="polite">
          <CardTitle id={`${id}-title`} className="text-sm font-medium">{authorization ? 'Additional authorization saved' : 'Task paused'}</CardTitle>
          <CardDescription className="text-xs">{authorization
            ? awaitingReceipt ? 'Waiting for outstanding model usage to be reconciled. The task remains paused.' : 'Waiting for the same task to resume.'
            : 'Progress saved. No additional work is authorized.'}</CardDescription>
        </CardHeader>
        {!authorization && <CardFooter className="px-4">
          <Button variant="secondary" size="sm" onClick={() => setDismissed(false)}>Review limits</Button>
        </CardFooter>}
      </>}
    </Card>
    <p className="mt-3 text-xs text-(--muted)">{spend
      ? 'A spending approval is not a purchase or a guarantee of completion. Computer charges and user-owned provider accounts are separate.'
      : 'Only an explicitly time-bounded authorization needs this approval. Routine execution-lease renewal does not increase spending limits.'}</p>
  </div>
}

function ResourceAuthorizationFields({ id, request, form, disabled }: {
  id: string
  request: HarnessResourceRequest
  form: ReturnType<typeof useResourceForm>
  disabled: boolean
}) {
  const { spend, valid, total, limit, setLimit, duration, setDuration, minimum } = form
  return <div className="space-y-2">
    {spend ? <>
      <Label htmlFor={`${id}-limit`} className="text-xs">New total model limit (USD)</Label>
      <Input id={`${id}-limit`} className="w-32 tabular-nums" inputMode="decimal" value={limit}
        onChange={event => setLimit(event.target.value)} disabled={disabled}
        aria-describedby={`${id}-detail${valid ? '' : ` ${id}-validation`}`} aria-invalid={!valid} />
    </> : <>
      <Label htmlFor={`${id}-duration`} className="text-xs">Additional authorized time</Label>
      <ListboxSelect id={`${id}-duration`} value={duration} onChange={setDuration} options={durations}
        buttonClassName="w-48 text-xs" disabled={disabled} aria-describedby={`${id}-detail`} />
    </>}
    <p id={`${id}-detail`} className="text-xs text-(--muted)">{spend
      ? valid ? `Up to ${usd(total! - request.currentMaxCostMicros)} more for Overlay-funded model usage. Other limits stay unchanged.`
        : `The current ${usd(request.currentMaxCostMicros)} total limit stays in place until you approve.`
      : `The ${usd(request.currentMaxCostMicros)} model spending limit and all other resource limits stay unchanged.`}</p>
    {spend && !valid && <ResourceLimitValidation id={`${id}-validation`} minimum={minimum} current={request.currentMaxCostMicros} />}
  </div>
}

function ResourceLimitValidation({ id, minimum, current }: { id: string; minimum: number; current: number }) {
  const impossible = minimum > MAX_HARNESS_RESOURCE_SPEND_MICROS || current >= MAX_HARNESS_RESOURCE_SPEND_MICROS
  return <p id={id} role="alert" className="border-l-2 border-(--muted) pl-2 text-xs">
    {impossible ? 'This task cannot be resumed within the maximum model spending limit.'
      : `Enter a total above ${usd(current)}, at least ${usd(Math.ceil(minimum / 10_000) * 10_000)}, and no more than ${usd(MAX_HARNESS_RESOURCE_SPEND_MICROS)}, in cents.`}
  </p>
}

function matchesResourceReceipt(request: HarnessResourceRequest, grant: HarnessResourceGrant, result: HarnessResourceGrantReceipt) {
  if (result.token !== request.token || result.runId !== request.runId || result.workflowRunId !== request.workflowRunId
    || result.policyRevisionBefore !== request.policyRevision || result.grant.kind !== grant.kind) return false
  return grant.kind === 'model_spend'
    ? result.maxCostMicros === grant.newMaxCostMicros
    : result.grant.kind === 'time' && result.grant.durationMs === grant.durationMs
}

function useResourceAuthorization({ request, canAuthorize, receipt, onGrant }: ResourceRequestProps) {
  const pending = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<HarnessResourceGrantReceipt | undefined>()
  const authorization = receipt ?? accepted
  const authorize = async (grant: HarnessResourceGrant) => {
    if (!canAuthorize || pending.current || authorization) return
    pending.current = true
    setSubmitting(true)
    setError(null)
    try {
      const result = await onGrant(grant)
      if (!matchesResourceReceipt(request, grant, result)) {
        throw new Error('This request has changed. Refresh the task before authorizing more work.')
      }
      setAccepted(result)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not confirm authorization. Review the task before trying again.')
    } finally {
      pending.current = false
      setSubmitting(false)
    }
  }
  return { submitting, error, authorization, authorize }
}
