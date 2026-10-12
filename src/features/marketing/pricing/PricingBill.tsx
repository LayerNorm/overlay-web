'use client'

import { useState } from 'react'
import { MAX_DEPOSIT, MIN_DEPOSIT, formatUsd, maxCharge, priceLines, simulateBill, type BillOutcome, type RunOutMode } from './pricing-sim'
import { NumberField } from './NumberField'
import s from './pricing.module.css'

const DEPOSITS = [8, 20, 50, 100]

function statusText(out: BillOutcome, deposit: number, topUp: number, limit: number): string {
  switch (out.state) {
    case 'within':
      return out.creditUsed === 0 ? 'Nothing used yet' : `Within credit. ${formatUsd(deposit - out.creditUsed, true)} left`
    case 'stopped':
      return 'Credit used up. Paid resources are paused. Nothing is charged.'
    case 'topped-up':
      return `Credit used up. ${out.topUps} automatic top-up${out.topUps > 1 ? 's' : ''} of ${formatUsd(topUp)} added`
    case 'limit':
      return `Monthly limit of ${formatUsd(limit)} reached. Paid resources are paused.`
  }
}

function Deposit({ deposit, onChange, full }: { deposit: number; onChange: (n: number) => void; full: boolean }) {
  const custom = !DEPOSITS.includes(deposit)
  return (
    <section id="credit">
      <div className={s.lab}>
        <h2>Choose your monthly credit</h2>
        <p>Pick $8 or any amount up to $500. Each month your workspace gets the same amount of credit.</p>
      </div>
      <div>
        <div className={s.chips}>
          {DEPOSITS.map((n) => (
            <button key={n} type="button" className={deposit === n ? `${s.chip} ${s.on}` : s.chip} onClick={() => onChange(n)}>
              {formatUsd(n)}
            </button>
          ))}
          <span className={custom ? s.customOn : undefined}>
            <NumberField value={deposit} min={MIN_DEPOSIT} max={MAX_DEPOSIT} onChange={onChange} label="Custom monthly amount" />
          </span>
        </div>
        <div className={s.eq}>
          <div className={s.box}><small>You pay each month</small><b>{formatUsd(deposit)}</b></div>
          <span className={s.arrow} aria-hidden="true">→</span>
          <div className={s.box}><small>Your workspace gets</small><b>{formatUsd(deposit)} of credit</b></div>
        </div>
        {full ? (
          <p className={s.note}>Usage draws from this credit first. Anything past it is <b>on-demand</b>, and only if you allow it below. Unused credit does not roll over.</p>
        ) : (
          <p className={s.note}>Usage draws from this credit. At $0, paid resources pause until next month or until you add credit. <b>Unused credit does not roll over.</b></p>
        )}
      </div>
    </section>
  )
}

type RunOutProps = {
  mode: RunOutMode
  topUp: number
  limit: number
  max: number
  onMode: (m: RunOutMode) => void
  onTopUp: (n: number) => void
  onLimit: (n: number) => void
}

function RunOut({ mode, topUp, limit, max, onMode, onTopUp, onLimit }: RunOutProps) {
  const option = (value: RunOutMode, title: string, text: string, extra?: React.ReactNode) => (
    <div
      className={mode === value ? `${s.opt} ${s.on}` : s.opt}
      role="radio"
      aria-checked={mode === value}
      tabIndex={0}
      onClick={() => onMode(value)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onMode(value)
        }
      }}
    >
      <span className={s.r} />
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
        {extra}
      </div>
    </div>
  )
  return (
    <section>
      <div className={s.lab}>
        <h2>When credit runs out</h2>
        <p>Your call. Hard stop, or keep going with automatic top-ups.</p>
      </div>
      <div>
        <div className={s.opts} role="radiogroup" aria-label="When credit runs out">
          {option('stop', 'Hard stop', 'Paid resources pause at $0. Free ones keep working. Nothing else is charged.')}
          {option(
            'go',
            'Keep going',
            'Add credit automatically when it hits $0, up to a limit you set.',
            <div className={s.row}>
              Add <NumberField small value={topUp} min={MIN_DEPOSIT} max={MAX_DEPOSIT} onChange={onTopUp} label="Top-up amount" /> each time, up to{' '}
              <NumberField small value={limit} min={0} onChange={onLimit} label="Monthly limit" /> a month
            </div>,
          )}
        </div>
        <div className={s.capLine}>
          <span>{mode === 'stop' ? 'The most this workspace can ever be charged' : 'The most this workspace can be charged in a month'}</span>
          <b>{formatUsd(max)}</b>
        </div>
      </div>
    </section>
  )
}

function UsagePanel({ deposit, out, usage, sliderMax, status, onUsage }: {
  deposit: number
  out: BillOutcome
  usage: number
  sliderMax: number
  status: string
  onUsage: (n: number) => void
}) {
  const pct = deposit ? out.creditUsed / deposit : 0
  const statusClass = out.state === 'topped-up' ? s.warn : out.state === 'stopped' || out.state === 'limit' ? s.stop : ''
  return (
    <div className={s.panel}>
      <div className={s.ph}><strong>Usage</strong><span className={s.tag}>Example workspace</span></div>
      <div className={s.bal}>
        <div className={s.top}>
          <div>Credit<b>{formatUsd(out.creditUsed, true)} / {formatUsd(deposit, true)}</b></div>
          <div className={s.rt}>On-demand charges<b>{formatUsd(out.charged, true)}</b></div>
        </div>
        <div className={pct > 0.85 && pct < 1 ? `${s.bar} ${s.low}` : s.bar}><i style={{ width: `${(pct * 100).toFixed(1)}%` }} /></div>
        <div className={`${s.status} ${statusClass}`}><i /><span>{status}</span></div>
      </div>
      <div className={s.lines}>
        {priceLines(out.covered).map((line) => (
          <div className={s.ln} key={line.name}>
            <span>{line.name}<small>{line.quantity}</small></span>
            <span />
            <span className={s.v}>{formatUsd(line.cents / 100, true)}</span>
          </div>
        ))}
      </div>
      <div className={s.sim}>
        <div className={s.t}><span>Simulate a month of use</span><b>{formatUsd(usage, true)}</b></div>
        <input type="range" min={0} max={sliderMax} step={0.5} value={usage} onChange={(e) => onUsage(Number(e.target.value))} aria-label="Simulated usage" />
      </div>
    </div>
  )
}

/**
 * The monthly amount, what happens at $0 (`onDemand`), and the example bill that reacts to both (`itemized`, which
 * waits for the per-resource usage ledger to ship).
 */
export function PricingBill({ onDemand = false, itemized = false }: { onDemand?: boolean; itemized?: boolean }) {
  const [deposit, setDeposit] = useState(20)
  const [mode, setMode] = useState<RunOutMode>('stop')
  const [topUp, setTopUp] = useState(8)
  const [limit, setLimit] = useState(40)
  const [rawUsage, setRawUsage] = useState(9)

  const settings = { deposit, mode, topUp, monthlyLimit: limit }
  const sliderMax = Math.max(20, deposit * 3)
  const usage = Math.min(rawUsage, sliderMax)
  const out = simulateBill(settings, usage)

  return (
    <>
      <Deposit deposit={deposit} onChange={setDeposit} full={onDemand} />
      {onDemand ? <RunOut mode={mode} topUp={topUp} limit={limit} max={maxCharge(settings)} onMode={setMode} onTopUp={setTopUp} onLimit={setLimit} /> : null}
      {itemized ? (
        <>
      <section id="bill">
        <div className={s.lab}>
          <h2>See where every cent goes</h2>
          <p>Each resource is added up on its own line. Move the slider to see the settings above in action.</p>
        </div>
        <div>
          <UsagePanel
            deposit={deposit}
            out={out}
            usage={usage}
            sliderMax={sliderMax}
            status={statusText(out, deposit, topUp, limit)}
            onUsage={setRawUsage}
          />
          <p className={s.fine}>Illustrative numbers. Every line shows its quantity.</p>
        </div>
      </section>
        </>
      ) : null}
    </>
  )
}
