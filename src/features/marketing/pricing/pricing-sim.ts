/**
 * The numbers behind the pricing page's example bill. Nothing here talks to a
 * server: it shows how a deposit, the "when credit runs out" choice and a month
 * of use turn into credit used, on-demand charges and a status line.
 */

/** A deposit is at least this much; top-ups are at least this much too. */
export const MIN_DEPOSIT = 8
/** The largest monthly plan. */
export const MAX_DEPOSIT = 500

export type RunOutMode = 'stop' | 'go'

export type BillSettings = {
  deposit: number
  mode: RunOutMode
  /** Amount added each time credit hits $0 (only with `mode: 'go'`). */
  topUp: number
  /** Most that automatic top-ups may add in a month. */
  monthlyLimit: number
}

export type BillOutcome = {
  /** Credit consumed, out of the deposit. */
  creditUsed: number
  /** Money charged to the card for automatic top-ups. */
  charged: number
  topUps: number
  /** Usage that was actually served (the rest was paused). */
  covered: number
  state: 'within' | 'topped-up' | 'stopped' | 'limit'
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The most a workspace can be charged this month with these settings. */
export function maxCharge(s: BillSettings): number {
  if (s.mode === 'stop') return s.deposit
  return s.deposit + Math.floor(s.monthlyLimit / s.topUp) * s.topUp
}

/** What happens to `usage` dollars of use under these settings. */
export function simulateBill(s: BillSettings, usage: number): BillOutcome {
  const { deposit } = s
  if (usage <= deposit) {
    return { creditUsed: round2(usage), charged: 0, topUps: 0, covered: round2(usage), state: 'within' }
  }
  if (s.mode === 'stop') {
    return { creditUsed: deposit, charged: 0, topUps: 0, covered: deposit, state: 'stopped' }
  }
  const allowed = Math.floor(s.monthlyLimit / s.topUp)
  const needed = Math.ceil((usage - deposit) / s.topUp)
  const topUps = Math.min(needed, allowed)
  const covered = round2(Math.min(usage, deposit + topUps * s.topUp))
  return {
    creditUsed: deposit,
    charged: topUps * s.topUp,
    topUps,
    covered,
    state: needed > allowed ? 'limit' : 'topped-up',
  }
}

/** One resource on the example bill: its share of a month of use and how it is counted. */
export type BillLine = { name: string; share: number; quantity: (scale: number) => string }

const hoursAndMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`

export const BILL_LINES: BillLine[] = [
  { name: 'Models', share: 1.84, quantity: (f) => `${Math.max(1, Math.round(41 * f))} messages` },
  { name: 'Overlay Cloud computers', share: 1.2, quantity: (f) => hoursAndMinutes(Math.round(126 * f)) },
  { name: 'Web search', share: 0.43, quantity: (f) => `${Math.round(214 * f)} searches` },
  { name: 'Browser tasks', share: 0.09, quantity: (f) => `${Math.round(9 * f)} tasks` },
  { name: 'Image generation', share: 0.04, quantity: (f) => `${Math.round(6 * f)} images` },
  { name: 'Storage', share: 0.02, quantity: (f) => `${Math.round(212 * Math.min(f, 4))} MB` },
]

const BASE_TOTAL = BILL_LINES.reduce((sum, line) => sum + line.share, 0)

export type PricedLine = { name: string; quantity: string; cents: number }

/** Split `covered` dollars across the resources; the lines always add up to it exactly. */
export function priceLines(covered: number): PricedLine[] {
  const scale = covered / BASE_TOTAL
  const cents = BILL_LINES.map((line) => Math.round(line.share * scale * 100))
  cents[0] += Math.round(covered * 100) - cents.reduce((a, b) => a + b, 0)
  return BILL_LINES.map((line, i) => ({ name: line.name, quantity: line.quantity(scale), cents: cents[i] }))
}

export function formatUsd(amount: number, cents = false): string {
  return cents || !Number.isInteger(amount) ? `$${amount.toFixed(2)}` : `$${amount}`
}
