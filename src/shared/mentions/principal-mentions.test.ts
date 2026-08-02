import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyMentionSelection,
  readMentionQuery,
  resolveMentionedPrincipalIds,
  suggestMentionPrincipals,
  type MentionablePrincipal,
} from './principal-mentions'

const PRINCIPALS: MentionablePrincipal[] = [
  { principalId: 'p_sam', displayName: 'Sam', principalType: 'human', lastActiveAt: 10 },
  { principalId: 'p_samantha', displayName: 'Samantha', principalType: 'human', lastActiveAt: 50 },
  { principalId: 'p_scout', displayName: 'Scout', principalType: 'agent', lastActiveAt: 30 },
  { principalId: 'p_research', displayName: 'Research', principalType: 'agent' },
  { principalId: 'p_research_bot', displayName: 'Research Bot', principalType: 'agent' },
]

test('a short name is not mentioned by a longer name that contains it', () => {
  assert.deepEqual(resolveMentionedPrincipalIds('hi @Samantha', PRINCIPALS), ['p_samantha'])
  assert.deepEqual(resolveMentionedPrincipalIds('hi @Sam', PRINCIPALS), ['p_sam'])
})

test('the longest matching display name wins', () => {
  assert.deepEqual(
    resolveMentionedPrincipalIds('@Research Bot please summarize', PRINCIPALS),
    ['p_research_bot'],
  )
  assert.deepEqual(resolveMentionedPrincipalIds('@Research please summarize', PRINCIPALS), ['p_research'])
})

test('several distinct principals can be mentioned once each', () => {
  const ids = resolveMentionedPrincipalIds('@Sam and @Scout, see @Samantha', PRINCIPALS)
  assert.deepEqual([...ids].sort(), ['p_sam', 'p_samantha', 'p_scout'])
})

test('an email address or mid-word @ does not mention anybody', () => {
  assert.deepEqual(resolveMentionedPrincipalIds('write to sam@scout.example', PRINCIPALS), [])
  assert.deepEqual(resolveMentionedPrincipalIds('no mentions here', PRINCIPALS), [])
})

test('mentions are case-insensitive and survive trailing punctuation', () => {
  assert.deepEqual(resolveMentionedPrincipalIds('@scout!', PRINCIPALS), ['p_scout'])
  assert.deepEqual(resolveMentionedPrincipalIds('cc @SAM.', PRINCIPALS), ['p_sam'])
})

test('suggestions favor prefix matches, then recent activity', () => {
  const suggestions = suggestMentionPrincipals({ principals: PRINCIPALS, query: 'sa' })
  assert.deepEqual(suggestions.map((principal) => principal.principalId), ['p_samantha', 'p_sam'])
  const recent = suggestMentionPrincipals({ principals: PRINCIPALS, query: '' })
  assert.deepEqual(recent.slice(0, 3).map((principal) => principal.principalId), [
    'p_samantha',
    'p_scout',
    'p_sam',
  ])
})

test('the author is excluded from their own mention suggestions', () => {
  const suggestions = suggestMentionPrincipals({
    principals: PRINCIPALS,
    query: '',
    excludePrincipalId: 'p_samantha',
  })
  assert.equal(suggestions.some((principal) => principal.principalId === 'p_samantha'), false)
})

test('the active mention token is read only when it starts a word', () => {
  assert.deepEqual(readMentionQuery('hello @sc', 9), { query: 'sc', start: 6 })
  assert.equal(readMentionQuery('mail me at sam@example', 22), null)
  assert.equal(readMentionQuery('@a @b', 5)?.query, 'b')
  assert.equal(readMentionQuery('no token', 8), null)
})

test('selecting a suggestion replaces the token and leaves the caret after it', () => {
  const result = applyMentionSelection({
    text: 'ping @sc',
    caret: 8,
    principal: PRINCIPALS[2]!,
  })
  assert.equal(result.text, 'ping @Scout ')
  assert.equal(result.caret, result.text.length)
  assert.deepEqual(resolveMentionedPrincipalIds(result.text, PRINCIPALS), ['p_scout'])
})
