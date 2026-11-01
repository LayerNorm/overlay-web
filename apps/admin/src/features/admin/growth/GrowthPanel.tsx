'use client'

import { useEffect, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { EmptyState } from '@overlay/ui/primitives'

import { adminApi } from '@/shared/admin-api'
import type { AdminGrowthSummary } from '@/shared/admin-types'
import {
  change,
  formatValue,
  growthGroups,
  growthWeeks,
  headline,
  retentionRate,
  shortDay,
  type GrowthMetric,
} from './growth-view'

export function GrowthPanel({ reloadKey }: { reloadKey: number }) {
  const [summary, setSummary] = useState<AdminGrowthSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    adminApi.admin.getGrowth({ signal: controller.signal })
      .then((growth) => { setSummary(growth); setError(null) })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Failed to load growth')
      })
    return () => controller.abort()
  }, [reloadKey])

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!summary) return <p className="py-12 text-sm text-(--muted)">Loading…</p>
  return <GrowthView summary={summary} />
}

export function GrowthView({ summary }: { summary: AdminGrowthSummary }) {
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

  const weeks = growthWeeks(summary.days)
  const groups = growthGroups(weeks)

  return (
    <div data-testid="admin-growth" className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Growth</h2>
        <p className="text-xs text-(--muted)">
          Last 7 days to {shortDay(summary.lastCompletedDay)} (UTC)
          {summary.computedAt ? ` · updated ${formatTime(summary.computedAt)}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-(--border) bg-(--border) md:grid-cols-4">
        {headline(weeks).map((metric) => (
          <div key={metric.key} className="bg-(--background) p-4">
            <p className="text-xs text-(--muted)">{metric.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatValue(metric.values.at(-1) ?? null, metric.format)}</p>
            <Change values={metric.values} />
          </div>
        ))}
      </div>

      {groups.map((group) => (
        <section key={group.title}>
          <h3 className="text-xs font-medium uppercase tracking-wide text-(--muted)">{group.title}</h3>
          <div className="mt-3 grid grid-cols-1 gap-x-10 border-t border-(--border) sm:grid-cols-2">
            {group.metrics.map((metric) => <MetricRow key={metric.key} metric={metric} weekEnds={weeks.map((week) => week.endDay)} />)}
          </div>
        </section>
      ))}

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-(--muted)">Retention by signup week</h3>
        {summary.cohorts.length === 0 ? (
          <p className="mt-3 text-sm text-(--muted)">No signups counted yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-(--border) text-left text-xs text-(--muted)">
                <th className="py-2 font-normal">Week of</th>
                <th className="py-2 text-right font-normal">Signups</th>
                <th className="py-2 text-right font-normal" title="Active on days 7–13 after signup">W1</th>
                <th className="py-2 text-right font-normal" title="Active on days 28–34 after signup">W4</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--border)">
              {summary.cohorts.map((cohort) => (
                <tr key={cohort.weekStart} className="tabular-nums">
                  <td className="py-2">{shortDay(cohort.weekStart)}</td>
                  <td className="py-2 text-right">{cohort.users.toLocaleString('en-US')}</td>
                  <td className="py-2 text-right">{retentionRate(cohort, 'w1')}</td>
                  <td className="py-2 text-right">{retentionRate(cohort, 'w4')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-(--muted)">A dash means the window hasn&apos;t closed for everyone in that week yet.</p>
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-(--muted)">Top workspaces by spend, last 30 days</h3>
        {summary.topWorkspaces.length === 0 ? (
          <p className="mt-3 text-sm text-(--muted)">No billed usage in the last 30 days.</p>
        ) : (
          <div className="mt-3 divide-y divide-(--border) border-y border-(--border)">
            {summary.topWorkspaces.map((workspace) => (
              <div key={workspace.workspaceId} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{workspace.name ?? (workspace.kind === 'personal' ? 'Personal workspace' : 'Unknown workspace')}</p>
                  <p className="truncate text-xs text-(--muted)">{workspace.workspaceId}</p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <p>{formatValue(workspace.cents, 'cents')}</p>
                  {workspace.sandboxSeconds > 0 ? (
                    <p className="text-xs text-(--muted)">{formatHours(workspace.sandboxSeconds)} machine time</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function MetricRow({ metric, weekEnds }: { metric: GrowthMetric; weekEnds: string[] }) {
  return (
    <div className="flex items-center gap-4 border-b border-(--border) py-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-(--muted)">{metric.label}</p>
        <p className="mt-0.5 flex items-baseline gap-2">
          <span className="text-lg font-semibold tabular-nums">{formatValue(metric.values.at(-1) ?? null, metric.format)}</span>
          <Change values={metric.values} inline />
        </p>
        {metric.detail ? <p className="text-xs text-(--muted)">{metric.detail}</p> : null}
      </div>
      <WeeklyBars metric={metric} weekEnds={weekEnds} />
    </div>
  )
}

/** One bar per week, newest on the right and darkest. */
function WeeklyBars({ metric, weekEnds }: { metric: GrowthMetric; weekEnds: string[] }) {
  const max = Math.max(1, ...metric.values.map((value) => value ?? 0))
  const width = 8
  const gap = 3
  const height = 32
  return (
    <svg
      role="img"
      aria-label={`${metric.label}, weekly`}
      width={metric.values.length * (width + gap) - gap}
      height={height}
      className="shrink-0 text-(--foreground)"
    >
      {metric.values.map((value, index) => {
        const barHeight = value ? Math.max(2, (value / max) * height) : 1
        return (
          <rect
            key={weekEnds[index]}
            x={index * (width + gap)}
            y={height - barHeight}
            width={width}
            height={barHeight}
            rx={1.5}
            fill="currentColor"
            opacity={index === metric.values.length - 1 ? 0.7 : 0.18}
          >
            <title>{`Week to ${shortDay(weekEnds[index])}: ${formatValue(value, metric.format)}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

function Change({ values, inline = false }: { values: (number | null)[]; inline?: boolean }) {
  const percent = change(values)
  const text = percent === null ? 'no prior week' : `${percent > 0 ? '+' : ''}${percent}% vs prior week`
  const tone = percent === null || percent === 0
    ? 'text-(--muted)'
    : percent > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
  if (inline) return percent === null ? null : <span className={`text-xs ${tone}`}>{percent > 0 ? '+' : ''}{percent}%</span>
  return <p className={`mt-1 text-xs ${tone}`}>{text}</p>
}

function formatHours(seconds: number): string {
  const hours = seconds / 3600
  return `${hours.toLocaleString('en-US', { maximumFractionDigits: hours < 10 ? 1 : 0 })} h`
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
