import assert from 'node:assert/strict'
import test from 'node:test'
import EditAgentPage from './[agentId]/page'

test('agent editor route decodes the native create redirect id', async () => {
  const agentId = 'native-agent:workspace:owner:request-id'
  const page = await EditAgentPage({ params: Promise.resolve({ agentId: encodeURIComponent(agentId) }) })

  assert.equal(page.props.children.props.mode, 'edit')
  assert.equal(page.props.children.props.agentId, agentId)
})

test('agent editor route preserves unencoded native and legacy ids', async () => {
  for (const agentId of ['native-agent:workspace:owner:request-id', 'legacy-agent-id']) {
    const page = await EditAgentPage({ params: Promise.resolve({ agentId }) })
    assert.equal(page.props.children.props.agentId, agentId)
  }
})

test('agent editor route rejects empty and malformed encoded ids', async () => {
  for (const agentId of ['', 'native-agent%3Aworkspace%']) {
    await assert.rejects(
      EditAgentPage({ params: Promise.resolve({ agentId }) }),
      /NEXT_HTTP_ERROR_FALLBACK;404/,
    )
  }
})
