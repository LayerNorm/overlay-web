import { defineQueries, notifyFixtures } from '../../fixtures/convex'

export type Schedule = { cadence: 'daily' | 'weekdays' | 'weekly' | 'hourly'; time: string; timezone: string }
export type Message = { role: 'user' | 'assistant' | 'note'; text: string; label?: string }
export type Automation = Schedule & { _id: string; name: string; instructions: string; agentId: string; scope: 'personal' | 'workspace'; enabled: boolean; messages: Message[] }
export const defaultSchedule: Schedule = { cadence: 'daily', time: '09:00', timezone: 'America/Los_Angeles' }
const key = 'overlay:mockup:scheduled-threads:v1'
const morning = 'Review my calendar and open tasks. Give me a short morning brief with my three priorities and any scheduling conflicts.'
const release = 'Review the open pull requests and summarize what is ready to ship, what is blocked, and who needs to act. Do not merge anything.'
const seed: Automation[] = [
  { ...defaultSchedule, _id: 'mock_morning', name: 'Morning brief', instructions: morning, agentId: '', scope: 'personal', enabled: true, messages: [
    { role: 'note', text: 'Schedule created · Every day at 9:00 AM' },
    { role: 'user', text: morning, label: 'Scheduled · Today, 9:00 AM' },
    { role: 'assistant', text: '**Your three priorities today**\n\n1. Review the launch checklist before your 10:00 AM team sync.\n2. Send feedback on the onboarding draft.\n3. Clear the two open customer follow-ups.\n\nYour design review overlaps with your focus block at 2:00 PM. Move the focus block to 3:00 PM to keep both.' },
    { role: 'user', text: 'Which one should I start with?', label: 'You · 9:04 AM' },
    { role: 'assistant', text: 'Start with the launch checklist. It is the only item that blocks your team before the morning sync.' },
  ] },
  { ...defaultSchedule, _id: 'mock_research', name: 'Weekly competitor update', instructions: 'Summarize notable product changes from our competitors. Include sources and explain what matters for Northwind.', agentId: 'agent_scout', scope: 'personal', cadence: 'weekly', enabled: false, messages: [{ role: 'note', text: 'Schedule paused. Your thread and its context stay here.' }] },
  { ...defaultSchedule, _id: 'mock_release', name: 'Daily release check', instructions: release, agentId: 'agent_atlas', scope: 'workspace', cadence: 'weekdays', enabled: true, messages: [
    { role: 'note', text: 'Schedule created · Weekdays at 9:00 AM' },
    { role: 'user', text: release, label: 'Scheduled · Today, 9:00 AM' },
    { role: 'assistant', text: '**Ready to ship**\n\nThe onboarding copy update has passed its checks.\n\n**Blocked**\n\nThe billing change needs Sam’s review. The mobile update still needs a device check.\n\nNo pull requests were merged.' },
  ] },
]
export let automations = seed
export function scheduleLabel(schedule: Schedule) {
  if (schedule.cadence === 'hourly') return 'Every hour'
  const [hour, minute] = schedule.time.split(':').map(Number)
  const time = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
  return `${{ daily: 'Every day', weekdays: 'Weekdays', weekly: 'Mondays' }[schedule.cadence]} · ${time}`
}
export function saveAutomation(value: Automation) {
  automations = automations.some(row => row._id === value._id) ? automations.map(row => row._id === value._id ? value : row) : [...automations, value]
  try { localStorage.setItem(key, JSON.stringify(automations)) } catch { /* The prototype also works without storage. */ }
  notifyFixtures()
}
export function installAutomationFixtures() {
  if (!globalThis.location.hash) globalThis.location.hash = '/w/northwind/personal/automations'
  try { const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); if (Array.isArray(saved) && saved.length && saved.every(row => row._id && Array.isArray(row.messages))) automations = saved } catch { /* Start with sample threads. */ }
  const row = (item: Automation) => ({ ...item, userId: 'user_mercedes', workspaceId: 'ws_northwind', description: item.instructions, agentId: item.agentId || undefined, conversationId: item._id, schedule: { kind: 'daily', hourUTC: 17, minuteUTC: 0 }, createdAt: Date.now() - 86400000, updatedAt: Date.now() })
  defineQueries({
    'automations/browse:list': ({ view }: { view?: string }) => automations.filter(item => !view || item.scope === view).map(row),
    'automations/browse:get': ({ automationId }: { automationId: string }) => { const found = automations.find(item => item._id === automationId); return found ? row(found) : null },
  })
}
