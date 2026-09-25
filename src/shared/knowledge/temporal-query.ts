/**
 * Deterministic temporal-range extraction for retrieval queries — the
 * supermemory-style "dual search": when a question names a time window,
 * chunks whose effective time falls inside it get their own ranked list into
 * the fusion, surfacing dated evidence a vector/lexical blend misses.
 *
 * Conservative by design: only confident expressions produce a range, and the
 * range is a *boost*, never a filter — non-temporal facets of the question
 * still retrieve normally. All math is UTC on the `asOfMs` anchor so bench
 * runs (questionDate) and prod (now) agree on boundaries.
 */

export type TemporalRange = {
  fromMs: number
  toMs: number
  /** Human-readable window for debugging/bench rows. */
  label: string
}

const DAY_MS = 86_400_000

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
}
const MONTH_RE = Object.keys(MONTHS).join('|')

function utcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS
}

function utcMonthStart(year: number, month: number): number {
  return Date.UTC(year, month, 1)
}

function range(fromMs: number, toMs: number, label: string): TemporalRange {
  return { fromMs, toMs, label }
}

function dayRange(ms: number, label: string): TemporalRange {
  const start = utcDay(ms)
  return range(start, start + DAY_MS, label)
}

function monthRange(year: number, month: number, label: string): TemporalRange {
  return range(utcMonthStart(year, month), utcMonthStart(year, month + 1), label)
}

/**
 * Extract a single time window from a natural-language query, or null when
 * the question carries no confident date expression. `asOfMs` is the anchor
 * for relative expressions (the date the question was asked).
 */
export function parseTemporalRange(query: string, asOfMs: number): TemporalRange | null {
  const q = query.toLowerCase()
  const asOf = new Date(asOfMs)
  const y = asOf.getUTCFullYear()

  // ISO date: 2024-03-15
  const iso = /\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/.exec(q)
  if (iso) {
    const [, yy, mm, dd] = iso
    const start = Date.UTC(Number(yy), Number(mm) - 1, Number(dd))
    return range(start, start + DAY_MS, iso[0])
  }

  // Month day[, year]: "march 5, 2024" / "march 5 2024" / "march 5th"
  const monthDay = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(20\\d\\d))?\\b`).exec(q)
  if (monthDay) {
    const month = MONTHS[monthDay[1]!.replace('.', '')]!
    let year = monthDay[3] ? Number(monthDay[3]) : y
    // A month with no year that lands in the future of the anchor refers to
    // the previous occurrence ("what did we do march 5" asked in january).
    if (!monthDay[3] && Date.UTC(year, month, Number(monthDay[2])) > asOfMs) year -= 1
    const start = Date.UTC(year, month, Number(monthDay[2]))
    return range(start, start + DAY_MS, monthDay[0])
  }

  // Day month [, year]: "5 march 2024" / "5th of march"
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_RE})\\.?(?:\\s*,?\\s*(20\\d\\d))?\\b`).exec(q)
  if (dayMonth) {
    const month = MONTHS[dayMonth[2]!.replace('.', '')]!
    let year = dayMonth[3] ? Number(dayMonth[3]) : y
    if (!dayMonth[3] && Date.UTC(year, month, Number(dayMonth[1])) > asOfMs) year -= 1
    const start = Date.UTC(year, month, Number(dayMonth[1]))
    return range(start, start + DAY_MS, dayMonth[0])
  }

  // in/during <month> [year] → whole month
  const inMonth = new RegExp(`\\b(?:in|during)\\s+(${MONTH_RE})\\.?(?:\\s+(20\\d\\d))?\\b`).exec(q)
  if (inMonth) {
    const month = MONTHS[inMonth[1]!.replace('.', '')]!
    let year = inMonth[2] ? Number(inMonth[2]) : y
    if (!inMonth[2] && utcMonthStart(year, month) > asOfMs) year -= 1
    return monthRange(year, month, inMonth[0])
  }

  // in/during <year> → whole year
  const inYear = /\b(?:in|during)\s+(20\d\d)\b/.exec(q)
  if (inYear) {
    const year = Number(inYear[1])
    return range(utcMonthStart(year, 0), utcMonthStart(year + 1, 0), inYear[0])
  }

  // yesterday / today / last night / tonight
  if (/\blast night\b/.test(q)) return dayRange(asOfMs - DAY_MS, 'last night')
  if (/\byesterday\b/.test(q)) return dayRange(asOfMs - DAY_MS, 'yesterday')
  if (/\b(this morning|this afternoon|this evening|tonight|today)\b/.test(q)) {
    return dayRange(asOfMs, RegExp.$1)
  }

  // N units ago / a few units ago / a couple of units ago
  const AGO_WORDS: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, few: 3, couple: 2,
  }
  const ago = /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|few|couple(?:\s+of)?)\s+(day|week|month|year)s?\s+ago\b/.exec(q)
  if (ago) {
    const n = /\d+/.test(ago[1]!) ? Number(ago[1]) : AGO_WORDS[ago[1]!.replace(/\s+of$/, '')] ?? 1
    const unit = ago[2]!
    if (unit === 'day') return dayRange(asOfMs - n * DAY_MS, ago[0])
    if (unit === 'week') return range(asOfMs - (n + 1) * 7 * DAY_MS, asOfMs - (n - 1) * 7 * DAY_MS, ago[0])
    if (unit === 'month') return monthRange(y, asOf.getUTCMonth() - n, ago[0])
    return range(utcMonthStart(y - n, 0), utcMonthStart(y - n + 1, 0), ago[0])
  }

  // last/this/past week|month|year|weekend
  const rel = /\b(last|this|past)\s+(week|month|year|weekend)\b/.exec(q)
  if (rel) {
    const [, which, unit] = rel
    if (unit === 'weekend') {
      // Last weekend = the most recent Sat–Sun strictly before today.
      const today = utcDay(asOfMs)
      const dow = asOf.getUTCDay()
      const lastSunday = today - ((dow === 0 ? 7 : dow) * DAY_MS)
      return which === 'this' && dow === 6
        ? dayRange(asOfMs, 'this weekend')
        : range(lastSunday - DAY_MS, lastSunday + DAY_MS, `${which} weekend`)
    }
    const today = utcDay(asOfMs)
    if (unit === 'week') {
      const weekStart = today - asOf.getUTCDay() * DAY_MS
      return which === 'this'
        ? range(weekStart, today + DAY_MS, rel[0])
        : range(weekStart - 7 * DAY_MS, weekStart, rel[0])
    }
    if (unit === 'month') {
      const m = asOf.getUTCMonth()
      return which === 'this'
        ? range(utcMonthStart(y, m), today + DAY_MS, rel[0])
        : range(utcMonthStart(y, m - 1), utcMonthStart(y, m), rel[0])
    }
    return which === 'this'
      ? range(utcMonthStart(y, 0), today + DAY_MS, rel[0])
      : range(utcMonthStart(y - 1, 0), utcMonthStart(y, 0), rel[0])
  }

  // Weekday names — "on tuesday", "tuesday night", "last tuesday" → the most
  // recent occurrence of that weekday ("next tuesday" stays unresolved: the
  // future holds no evidence).
  const weekday = /\b(?:(last|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(q)
  if (weekday) {
    const DAYS: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    }
    const target = DAYS[weekday[2]!]!
    const dow = asOf.getUTCDay()
    // "this tuesday" asked on Tuesday is today; a bare "on tuesday" or "last
    // tuesday" refers to the most recent past occurrence.
    const back = weekday[1] === 'this'
      ? (dow - target + 7) % 7
      : ((dow - target + 6) % 7) + 1
    return dayRange(asOfMs - back * DAY_MS, weekday[0])
  }

  // recent / lately / the other day → trailing 7 days
  if (/\b(recent(ly)?|lately|the other day)\b/.test(q)) {
    return range(asOfMs - 7 * DAY_MS, asOfMs + DAY_MS, 'recent')
  }

  return null
}
