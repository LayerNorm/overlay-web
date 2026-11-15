import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { markdownToTeamsHtml, teamsHtmlToMarkdown, teamsMessageToEvents, teamsReactionToEmoji, type TeamsChatMessage } from './convert'

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8')) as TeamsChatMessage

test('a recorded channel post becomes an upsert keyed by its message id', () => {
  const { events, authors } = teamsMessageToEvents(fixture('channel-message.json'))
  assert.deepEqual(events, [{
    kind: 'message.upsert',
    externalMessageId: '1614618259349',
    externalUserId: '8ea0e38b-efb3-4757-924a-5f94061cf8c2',
    text: '(image)',
    createdAt: Date.parse('2021-03-01T17:04:19.349Z'),
  }])
  assert.deepEqual(authors, [{ externalUserId: '8ea0e38b-efb3-4757-924a-5f94061cf8c2', displayName: 'Robin Kline' }])
})

test('a recorded reply is keyed root/reply and points at its root', () => {
  const [event] = teamsMessageToEvents(fixture('channel-reply.json')).events
  assert.deepEqual(event, {
    kind: 'message.upsert',
    externalMessageId: '1612509044972/1613671348387',
    externalThreadId: '1612509044972',
    externalUserId: '8ea0e38b-efb3-4757-924a-5f94061cf8c2',
    text: 'Test',
    createdAt: Date.parse('2021-02-18T18:02:28.387Z'),
  })
})

test('emoji, custom emoji and reactions from a recorded message map to Overlay emoji', () => {
  const { events, authors } = teamsMessageToEvents(fixture('message-with-reactions.json'))
  assert.equal(events[0]?.kind === 'message.upsert' && events[0].text, 'I am looking 👀:microsoft\\_teams:')
  assert.deepEqual(events.slice(1), [
    { kind: 'reaction.add', externalMessageId: '1706763669648', externalUserId: '670374fa-3b0e-4a3b-9d33-0e1bc5ff1956', emoji: '💯' },
    { kind: 'reaction.add', externalMessageId: '1706763669648', externalUserId: '28c10244-4bad-4fda-993c-f332faef94f0', emoji: ':microsoft_teams:' },
  ])
  assert.deepEqual(authors.map(author => author.externalUserId), ['670374fa-3b0e-4a3b-9d33-0e1bc5ff1956', '28c10244-4bad-4fda-993c-f332faef94f0'])
})

test('mentions in a recorded message become @name', () => {
  const [event] = teamsMessageToEvents(fixture('mention-everyone.json')).events
  assert.equal(event?.kind === 'message.upsert' && event.text, 'Hi @Everyone')
})

test('deleted, system and authorless messages', () => {
  const base = fixture('channel-message.json')
  assert.deepEqual(teamsMessageToEvents({ ...base, deletedDateTime: '2021-03-02T00:00:00Z' }).events, [{ kind: 'message.delete', externalMessageId: '1614618259349' }])
  assert.deepEqual(teamsMessageToEvents({ ...base, messageType: 'systemEventMessage' }).events, [])
  assert.deepEqual(teamsMessageToEvents({ ...base, from: null }).events, [])
})

test('subjects lead the message and edits carry their time', () => {
  const [event] = teamsMessageToEvents({
    ...fixture('channel-message.json'),
    subject: 'Launch plan',
    lastEditedDateTime: '2021-03-01T18:00:00Z',
    body: { contentType: 'html', content: '<p>Ship <b>Friday</b>, see <a href="https://example.com/doc">doc</a></p><ol><li>one</li></ol>' },
  }).events
  assert.equal(event?.kind === 'message.upsert' && event.text, '**Launch plan**\n\nShip **Friday**, see [doc](https://example.com/doc)\n\n1. one')
  assert.equal(event?.kind === 'message.upsert' && event.editedAt, Date.parse('2021-03-01T18:00:00Z'))
})

test('legacy and named reactions', () => {
  assert.equal(teamsReactionToEmoji('like'), '👍')
  assert.equal(teamsReactionToEmoji('heart'), '❤️')
  assert.equal(teamsReactionToEmoji('custom', 'party_parrot'), ':party_parrot:')
  assert.equal(teamsReactionToEmoji('🎉'), '🎉')
  assert.equal(teamsReactionToEmoji('somethingnew'), ':somethingnew:')
})

test('html conversion drops attachment placeholders and plain text bodies pass through', () => {
  assert.equal(teamsHtmlToMarkdown('<p>See this</p><attachment id="1"></attachment>'), 'See this')
  const [event] = teamsMessageToEvents({ ...fixture('channel-message.json'), body: { contentType: 'text', content: ' plain ' } }).events
  assert.equal(event?.kind === 'message.upsert' && event.text, 'plain')
})

test('outbound markdown becomes Teams HTML without raw HTML', () => {
  assert.equal(markdownToTeamsHtml('Hi **there** [doc](https://a.example) <script>x()</script>'), '<p>Hi <strong>there</strong> <a href="https://a.example">doc</a> x()</p>')
})
