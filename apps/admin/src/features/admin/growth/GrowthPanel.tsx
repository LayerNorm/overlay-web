'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, TrendingUp } from 'lucide-react'
import { EmptyState, SegmentedControl } from '@overlay/ui/primitives'

import { adminApi } from '@/shared/admin-api'
import type { AdminGrowthCohort, AdminGrowthSummary } from '@/shared/admin-types'
import { AdminError, AdminScreen, errorMessage } from '../AdminScreen'
import {
  GROWTH_RANGES,
  axisTicks,
  change,
  formatValue,
  growthGroups,
  growthWeeks,
  headline,
  retentionPercent,
  shortDay,
  type GrowthMetric,
  type GrowthRange,
  type GrowthWeek,
} from './growth-view'

const RANGE_OPTIONS = GROWTH_RANGES.map((weeks) => ({ value: String(weeks) as `${GrowthRange}`, label: `${weeks} weeks` }))

export function GrowthPanel() {
  const [summary, setSummary] = useState<AdminGrowthSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<GrowthRange>(12)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    adminApi.admin.getGrowth({ signal: controller.signal })
      .then((growth) => { setSummary(growth); setError(null) })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(loadError, 'Failed to load growth'))
      })
    return () => controller.abort()
  }, [reloadKey])

  const subtitle = summary?.lastCompletedDay
    ? `Week to ${shortDay(summary.lastCompletedDay)}${summary.computedAt ? ` · updated ${formatTime(summary.computedAt)}` : ''}`
    : undefined

  return (
    <AdminScreen
      title="Growth"
      subtitle={subtitle}
      onRefresh={() => setReloadKey((key) => key + 1)}
      actions={(
        <SegmentedControl
          ariaLabel="Weeks shown"
          value={String(range) as `${GrowthRange}`}
          options={RANGE_OPTIONS}
          onChange={(value) => setRange(Number(value) as GrowthRange)}
        />
      )}
    >
      <AdminError message={error} />
      {summary ? <GrowthView summary={summary} range={range} /> : error ? null : <p className="admin-muted py-12 text-sm">Loading…</p>}
    </AdminScreen>
  )
}

export function GrowthView({ summary, range = 12 }: { summary: AdminGrowthSummary; range?: GrowthRange }) {
  if (!summary.lastCompletedDay || summary.days.length === 0) {
    return (
      <EmptyState
        className="py-16"
        icon={<TrendingUp size={22} strokeWidth={1.5} />}
        title="No growth data yet"
        description="The nightly count fills this in after its first run."
      />
    )
  }

  const weeks = growthWeeks(summary.days, range)
  const kpis = headline(weeks)

  return (
    <div data-testid="admin-growth">
      <div className="growth-kpis">
        {kpis.map((metric) => (
          <div key={metric.key} className="admin-card growth-kpi">
            <div className="growth-kpi-label">{metric.label}</div>
            <div className="growth-kpi-value num">{formatValue(metric.values.at(-1) ?? null, metric.format)}</div>
            <div className="growth-kpi-foot">
              <Change values={metric.values} />
              <Spark values={metric.values.slice(-8)} />
            </div>
          </div>
        ))}
      </div>

      <div className="growth-row-2">
        <div className="admin-card growth-chart-card">
          <div className="admin-card-head">
            <h2>Weekly active people</h2>
            <span className="admin-note">Did any work in the 7 days</span>
          </div>
          <WeeklyChart weeks={weeks} metric={kpis[0]} />
        </div>
        <div className="admin-card">
          <div className="admin-card-head">
            <h2>Retention by signup week</h2>
            <span className="admin-note">Active in week 1 / week 4</span>
          </div>
          <Retention cohorts={summary.cohorts} />
        </div>
      </div>

      <div className="growth-groups">
        {growthGroups(weeks).map((group) => (
          <div key={group.title} className="admin-card">
            <div className="admin-card-head">
              <h2>{group.title}</h2>
              <span className="admin-note">This week</span>
            </div>
            {group.metrics.map((metric) => <MetricRow key={metric.key} metric={metric} />)}
          </div>
        ))}
      </div>

      <div className="admin-card growth-workspaces">
        <div className="admin-card-head">
          <h2>Top workspaces by spend</h2>
          <span className="admin-note">Last 30 days</span>
        </div>
        <TopWorkspaces summary={summary} />
      </div>
    </div>
  )
}

function WeeklyChart({ weeks, metric }: { weeks: GrowthWeek[]; metric: GrowthMetric }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const ticks = axisTicks(Math.max(0, ...metric.values.map((value) => value ?? 0)))
  const max = ticks[0]
  // Label every other week counting back from the newest (every fourth at 26 weeks) so labels never collide.
  const every = weeks.length <= 6 ? 1 : weeks.length <= 13 ? 2 : 4
  const showLabel = (index: number) => (weeks.length - 1 - index) % every === 0
  const hoveredValue = hovered === null ? null : metric.values[hovered] ?? null

  return (
    <div className="growth-chart">
      <div className="growth-yaxis num" aria-hidden>
        {ticks.map((tick) => <span key={tick}>{tick.toLocaleString('en-US')}</span>)}
      </div>
      <div className="growth-plot">
        {ticks.map((tick, index) => (
          <div key={tick} className="growth-gridline" style={{ top: `calc(${index / (ticks.length - 1)} * (100% - 22px))` }} />
        ))}
        <div className="growth-bars" role="img" aria-label={`${metric.label}, weekly`}>
          {weeks.map((week, index) => (
            <div
              key={week.endDay}
              className={`growth-bar${index === weeks.length - 1 ? ' last' : ''}`}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            >
              <i style={{ height: `${((metric.values[index] ?? 0) / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="growth-xlabels" aria-hidden>
          {weeks.map((week, index) => <span key={week.endDay}>{showLabel(index) ? shortDay(week.endDay) : ''}</span>)}
        </div>
        {hovered !== null ? (
          <div
            className="growth-tip"
            style={{
              left: `${((hovered + 0.5) / weeks.length) * 100}%`,
              top: `calc((100% - 22px) * ${1 - (hoveredValue ?? 0) / max} - 8px)`,
            }}
          >
            <span>Week to {shortDay(weeks[hovered].endDay)}</span>
            <br />
            <b className="num">{formatValue(hoveredValue, metric.format)}</b> active
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Retention({ cohorts }: { cohorts: AdminGrowthCohort[] }) {
  if (cohorts.length === 0) return <p className="admin-muted text-sm">No signups counted yet.</p>
  return (
    <table className="growth-table">
      <thead>
        <tr>
          <th>Week of</th>
          <th className="r">Signups</th>
          <th className="r" title="Active on days 7–13 after signup">W1</th>
          <th className="r" title="Active on days 28–34 after signup">W4</th>
        </tr>
      </thead>
      <tbody>
        {cohorts.slice(0, 8).map((cohort) => (
          <tr key={cohort.weekStart}>
            <td>{shortDay(cohort.weekStart)}</td>
            <td className="r num">{cohort.users.toLocaleString('en-US')}</td>
            <td className="r"><Heat percent={retentionPercent(cohort, 'w1')} /></td>
            <td className="r"><Heat percent={retentionPercent(cohort, 'w4')} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Retention cell, shaded darker the more of the week stayed. A dash means the window is still open. */
function Heat({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="growth-heat na" title="Window still open">—</span>
  const alpha = Math.min(0.6, 0.08 + (percent / 60) * 0.42)
  return (
    <span className="growth-heat" style={{ background: `rgb(var(--heat) / calc(${alpha.toFixed(3)} * var(--heat-strength)))` }}>
      {percent}%
    </span>
  )
}

function MetricRow({ metric }: { metric: GrowthMetric }) {
  const percent = change(metric.values)
  return (
    <div className="growth-metric">
      <div className="growth-metric-name">
        <div className="growth-metric-label">{metric.label}</div>
        <div className="growth-metric-value num">
          {formatValue(metric.values.at(-1) ?? null, metric.format)}
          {percent === null ? null : <span className={`growth-change ${tone(percent)}`}>{percent > 0 ? '+' : ''}{percent}%</span>}
        </div>
        {metric.detail ? <div className="growth-metric-detail">{metric.detail}</div> : null}
      </div>
      <Spark values={metric.values} />
    </div>
  )
}

function TopWorkspaces({ summary }: { summary: AdminGrowthSummary }) {
  if (summary.topWorkspaces.length === 0) return <p className="admin-muted text-sm">No billed usage in the last 30 days.</p>
  const top = Math.max(1, summary.topWorkspaces[0].cents)
  return (
    <div>
      {summary.topWorkspaces.map((workspace, index) => (
        <div key={workspace.workspaceId} className="growth-ws">
          <span className="growth-ws-rank num">{index + 1}</span>
          <div className="growth-ws-info">
            <div className="growth-ws-name" title={workspace.workspaceId}>
              {workspace.name ?? (workspace.kind === 'personal' ? 'Personal workspace' : 'Unknown workspace')}
            </div>
            <div className="growth-meter"><i style={{ width: `${(workspace.cents / top) * 100}%` }} /></div>
          </div>
          <div className="growth-ws-amount">
            {formatValue(workspace.cents, 'cents')}
            {workspace.sandboxSeconds > 0 ? <span>{formatHours(workspace.sandboxSeconds)} machine time</span> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function Spark({ values }: { values: (number | null)[] }) {
  const max = Math.max(1, ...values.map((value) => value ?? 0))
  return (
    <div className="growth-spark" aria-hidden>
      {values.map((value, index) => <i key={index} style={{ height: `${Math.max(2, ((value ?? 0) / max) * 26)}px` }} />)}
    </div>
  )
}

function Change({ values }: { values: (number | null)[] }) {
  const percent = change(values)
  if (percent === null) return <span className="growth-change flat">No prior week</span>
  if (percent === 0) return <span className="growth-change flat">No change</span>
  const Arrow = percent > 0 ? ArrowUp : ArrowDown
  return (
    <span className={`growth-change ${tone(percent)}`}>
      <Arrow size={13} strokeWidth={1.8} />
      {Math.abs(percent)}%<span className="of">&nbsp;vs prior week</span>
    </span>
  )
}

function tone(percent: number): 'up' | 'down' | 'flat' {
  return percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat'
}

function formatHours(seconds: number): string {
  const hours = seconds / 3600
  return `${hours.toLocaleString('en-US', { maximumFractionDigits: hours < 10 ? 1 : 0 })} h`
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' })
}
