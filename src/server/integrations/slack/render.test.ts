import assert from 'node:assert/strict'
import test from 'node:test'
import { renderSlackReply } from './render'

const threadUrl = 'https://overlay.works/app/agents/agent_1/threads/thread_1'
const render = (markdown: string, maxChars?: number) => renderSlackReply(markdown, { threadUrl, maxChars })
const only = (markdown: string) => {
  const messages = render(markdown)
  assert.equal(messages.length, 1)
  return messages[0]!.markdown
}

test('empty or whitespace-only replies post nothing', () => {
  assert.deepEqual(render(''), [])
  assert.deepEqual(render('  \n\n\t '), [])
})

test('standard GitHub-flavored markdown passes through intact', () => {
  const reply = [
    '## Q3 launch status',
    '',
    'Here is where **every** workstream stands, _as of today_ (~~Friday~~ Monday):',
    '',
    '| Workstream | Owner | Status |',
    '| --- | :-: | --- |',
    '| Billing | Priya | Done |',
    '| Slack app | Sam | `in review` |',
    '',
    '1. Ship billing',
    '   - migrate plans',
    '   - backfill invoices',
    '2. Launch Slack',
    '',
    '- [x] Write the announcement',
    '- [ ] Record the demo',
    '',
    '> Remember: the freeze starts Thursday.',
    '',
    '```ts',
    'export const launch = { date: "2026-12-01", flag: true }',
    '```',
    '',
    'Docs: [launch plan](https://example.com/plan).',
  ].join('\n')
  assert.equal(only(reply), [
    '## Q3 launch status',
    '',
    'Here is where **every** workstream stands, _as of today_ (~~Friday~~ Monday):',
    '',
    '| Workstream | Owner | Status |',
    '| - | :-: | - |',
    '| Billing | Priya | Done |',
    '| Slack app | Sam | `in review` |',
    '',
    '1. Ship billing',
    '   - migrate plans',
    '   - backfill invoices',
    '2. Launch Slack',
    '',
    '- [x] Write the announcement',
    '- [ ] Record the demo',
    '',
    '> Remember: the freeze starts Thursday.',
    '',
    '```ts',
    'export const launch = { date: "2026-12-01", flag: true }',
    '```',
    '',
    'Docs: [launch plan](https://example.com/plan).',
  ].join('\n'))
})

test('linked citation numbers link inline and become a Sources list at the end', () => {
  const reply = [
    'Revenue grew 18% in Q3 [1], driven by the enterprise tier [2].',
    '',
    '**Sources:** [1](/app/files?file=file_q3 "Q3 board deck.pdf") [2](/app/settings?section=memories&memory=mem_9 "Enterprise pricing memo")',
  ].join('\n')
  assert.equal(only(reply), [
    'Revenue grew 18% in Q3 [\\[1]](https://overlay.works/app/files?file=file_q3), driven by the enterprise tier [\\[2]](https://overlay.works/app/settings?section=memories&memory=mem_9).',
    '',
    '**Sources**',
    '',
    '1. [Q3 board deck.pdf](https://overlay.works/app/files?file=file_q3)',
    '2. [Enterprise pricing memo](https://overlay.works/app/settings?section=memories&memory=mem_9)',
  ].join('\n'))
})

test('a Sources list of titled links keeps its numbering, and unlinked markers stay as text', () => {
  const linked = [
    'Vercel queues retry with backoff [2].',
    '',
    'Sources:',
    '',
    '- [Vercel Queues docs](https://vercel.com/docs/queues)',
    '- [Retry semantics](https://vercel.com/docs/queues/retries)',
  ].join('\n')
  assert.equal(only(linked), [
    'Vercel queues retry with backoff [\\[2]](https://vercel.com/docs/queues/retries).',
    '',
    '**Sources**',
    '',
    '1. [Vercel Queues docs](https://vercel.com/docs/queues)',
    '2. [Retry semantics](https://vercel.com/docs/queues/retries)',
  ].join('\n'))

  assert.equal(only('The memo says yes [1].\n\n**Sources:** [1] [3]'), 'The memo says yes \\[1].\n\n**Sources:** \\[1] \\[3]')
})

test('math becomes code, while prose dollar amounts stay text', () => {
  const reply = [
    'The budget moved from $8,000 to $9,500, so the ratio is $r = \\frac{9500}{8000}$ and $$E = mc^2$$ inline.',
    '',
    '$$',
    '\\sum_{i=1}^{n} x_i = 1',
    '$$',
  ].join('\n')
  assert.equal(only(reply), [
    'The budget moved from $8,000 to $9,500, so the ratio is `r = \\frac{9500}{8000}` and `E = mc^2` inline.',
    '',
    '```latex',
    '\\sum_{i=1}^{n} x_i = 1',
    '```',
  ].join('\n'))
})

test('inline HTML is stripped to its text, and embeds become links', () => {
  const reply = [
    'Please <u>sign</u> the <mark>updated</mark> contract<br>by Friday, see <a href="/app/files?file=file_contract">the draft</a>.',
    '',
    '<p style="text-align:center">Centered <u>heading</u> text</p>',
    '',
    '<iframe src="https://www.youtube-nocookie.com/embed/abc123" title="Walkthrough"></iframe>',
  ].join('\n')
  assert.equal(only(reply), [
    'Please sign the updated contract',
    'by Friday, see [the draft](https://overlay.works/app/files?file=file_contract).',
    '',
    'Centered heading text',
    '',
    '[Walkthrough](https://www.youtube-nocookie.com/embed/abc123)',
  ].join('\n'))
})

test('app-internal links become absolute and images become links', () => {
  const reply = [
    'I saved [the summary](/app/notes?note=note_1) and opened [the room](/w/rooms/room_2).',
    '',
    '![Revenue chart](/api/v1/files/file_chart/content) ![](https://cdn.example.com/x.png)',
    '',
    'Reference style: [roadmap][rm], external [site](https://example.com), anchor [top](#top).',
    '',
    '[rm]: /app/files?file=file_roadmap',
  ].join('\n')
  assert.equal(only(reply), [
    'I saved [the summary](https://overlay.works/app/notes?note=note_1) and opened [the room](https://overlay.works/w/rooms/room_2).',
    '',
    '[Revenue chart](https://overlay.works/api/v1/files/file_chart/content) [Image](https://cdn.example.com/x.png)',
    '',
    'Reference style: [roadmap](https://overlay.works/app/files?file=file_roadmap), external [site](https://example.com), anchor [top](#top).',
  ].join('\n'))
})

test('long replies split on block boundaries under the limit', () => {
  const paragraphs = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}: ${'word '.repeat(40).trim()}`)
  const table = '| Metric | Value |\n| - | - |\n| Users | 1200 |\n| Seats | 300 |'
  const reply = [...paragraphs.slice(0, 6), table, ...paragraphs.slice(6)].join('\n\n')
  const messages = render(reply, 800)
  assert.ok(messages.length > 1 && messages.length <= 4)
  for (const { markdown } of messages) assert.ok(markdown.length <= 800, `${markdown.length} > 800`)
  assert.equal(messages.map((message) => message.markdown).join('\n\n'), reply)
  assert.ok(messages.some((message) => message.markdown.includes(table)))
})

test('a giant code block splits by lines and re-opens the fence', () => {
  const lines = Array.from({ length: 300 }, (_, index) => `  console.log("line ${index}", { value: ${index * 7} })`)
  const messages = render(['```ts', ...lines, '```'].join('\n'), 4_000)
  assert.ok(messages.length > 1 && messages.length <= 4)
  const bodies = messages.map(({ markdown }) => {
    assert.ok(markdown.length <= 4_000)
    assert.ok(markdown.startsWith('```ts\n') && markdown.endsWith('\n```'), markdown.slice(0, 40))
    return markdown.slice('```ts\n'.length, -'\n```'.length)
  })
  assert.deepEqual(bodies.join('\n').split('\n'), lines)
})

test('a giant table splits by rows and repeats the header', () => {
  const header = '| Account | Region | ARR | Renewal |\n| - | - | - | - |'
  const rows = Array.from({ length: 200 }, (_, index) => `| Account ${index} | EMEA | $${index * 1000} | 2027-0${(index % 9) + 1}-01 |`)
  const messages = render([header, ...rows].join('\n'), 3_000)
  assert.ok(messages.length > 1 && messages.length <= 4)
  const seen = messages.flatMap(({ markdown }) => {
    assert.ok(markdown.length <= 3_000)
    assert.ok(markdown.startsWith(header + '\n'))
    return markdown.split('\n').slice(2)
  })
  assert.deepEqual(seen, rows)
})

test('replies needing more than four messages end with a link to the Overlay thread', () => {
  const reply = Array.from({ length: 40 }, (_, index) => `### Section ${index + 1}\n\n${'Detail sentence. '.repeat(30).trim()}`).join('\n\n')
  const messages = render(reply, 1_000)
  assert.equal(messages.length, 4)
  for (const { markdown } of messages.slice(0, 3)) {
    assert.ok(markdown.length <= 1_000)
  }
  assert.ok(messages[0]!.markdown.startsWith('### Section 1\n'))
  assert.equal(messages[3]!.markdown, `_The reply continues in Overlay._ [Read the full reply](${threadUrl})`)
})

test('the default limit keeps every message below Slack\'s 12,000 characters', () => {
  const reply = Array.from({ length: 60 }, (_, index) => `- Item ${index}: ${'lorem ipsum '.repeat(30)}`).join('\n')
  const messages = render(reply)
  assert.ok(messages.length >= 2)
  for (const { markdown } of messages) assert.ok(markdown.length <= 11_000)
  assert.ok(messages[1]!.markdown.startsWith('- Item '))
})

test('an agent cannot ping people, user groups or the whole channel', () => {
  const wj = '⁠'
  const out = only('Heads up <!channel> and <!here|here>, ask <@U123ABC> or <@U9|bob>; @here @everyone @channel @ada, mail a@b.co\n\n<!subteam^S1|@eng>\n\n`@here stays in code`')
  assert.doesNotMatch(out, /<[@!]/)
  for (const name of ['channel', 'here', 'everyone', 'U123ABC', 'bob', 'ada', 'eng']) assert.ok(out.includes('@' + wj + name), name)
  assert.doesNotMatch(out.replace(/`[^`]*`/g, ''), /(^|[^\w\\])@\w/)
  assert.match(out, /a\\?@b\.co/)
  assert.ok(out.includes('`@here stays in code`'))
})
