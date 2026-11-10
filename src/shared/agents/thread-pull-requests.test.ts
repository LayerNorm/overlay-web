import assert from 'node:assert/strict'
import test from 'node:test'
import { reduceThreadPullRequests } from './thread-pull-requests'

function pullRequest(
  number: number,
  owner = 'acme',
  repo = 'widgets',
  state: 'open' | 'closed' = 'open',
  extra: Record<string, unknown> = {},
) {
  return {
    number,
    html_url: `https://github.com/${owner}/${repo}/pull/${number}`,
    title: `Pull request ${number}`,
    state,
    draft: false,
    updated_at: '2026-10-20T12:00:00Z',
    ...extra,
  }
}

function toolPart(
  toolCallId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: unknown,
  state = 'output-available',
) {
  return {
    type: 'tool-invocation',
    toolInvocation: { toolCallId, toolName, state, toolInput, toolOutput },
  }
}

test('extracts lifecycle states and deduplicates repository names case-insensitively', () => {
  const parts = [
    toolPart('create-open', 'GITHUB_CREATE_A_PULL_REQUEST', {}, pullRequest(1, 'LayerNorm', 'overlay-web')),
    toolPart('create-draft', 'GITHUB_CREATE_A_PULL_REQUEST', {}, pullRequest(2, 'acme', 'draft', 'open', { draft: true })),
    toolPart('close', 'GITHUB_CLOSE_A_PULL_REQUEST', { owner: 'acme', repo: 'closed', pull_number: 3 },
      pullRequest(3, 'acme', 'closed', 'closed')),
    toolPart('merge', 'GITHUB_MERGE_A_PULL_REQUEST', { owner: 'acme', repo: 'merged', pull_number: 4 },
      pullRequest(4, 'acme', 'merged', 'closed', { merged: true })),
    toolPart('update-open', 'GITHUB_UPDATE_A_PULL_REQUEST', { owner: 'layernorm', repo: 'OVERLAY-WEB' },
      pullRequest(1, 'layernorm', 'OVERLAY-WEB', 'open', {
        title: 'Updated title',
        updated_at: '2026-10-20T13:00:00Z',
      })),
  ]

  const associations = reduceThreadPullRequests(undefined, [], parts, 100)
  assert.equal(associations?.length, 4)
  assert.deepEqual(
    Object.fromEntries(associations!.map(item => [item.number, item.state])),
    { 1: 'open', 2: 'draft', 3: 'closed', 4: 'merged' },
  )
  assert.equal(associations!.find(item => item.number === 1)?.title, 'Updated title')
})

test('read-only tools never create an association but can refresh an existing pull request', () => {
  const create = toolPart('create', 'GITHUB_CREATE_A_PULL_REQUEST', { owner: 'acme', repo: 'widgets' },
    pullRequest(11))
  const read = toolPart('read', 'call_mcp_tool', {
    toolName: 'GITHUB_GET_A_PULL_REQUEST',
    arguments: { owner: 'acme', repo: 'widgets', pull_number: 11 },
  }, {
    isError: false,
    structuredContent: {
      data: pullRequest(11, 'acme', 'widgets', 'closed', {
        title: 'Closed by collaborator',
        updated_at: '2026-10-20T14:00:00Z',
      }),
    },
  })

  assert.equal(reduceThreadPullRequests(undefined, [], [read], 100), undefined)
  const existing = reduceThreadPullRequests(undefined, [], [create], 100)!
  const refreshed = reduceThreadPullRequests(existing, [create], [create, read], 200)!
  assert.equal(refreshed[0]?.state, 'closed')
  assert.equal(refreshed[0]?.title, 'Closed by collaborator')
  assert.equal(refreshed[0]?.observedAt, 200)
})

test('parses JSON text MCP blocks but does not scrape ordinary text', () => {
  const mcpResult = toolPart('mcp-json', 'call_mcp_tool', {
    toolName: 'GITHUB_CREATE_A_PULL_REQUEST',
    arguments: {},
  }, {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(pullRequest(13, 'acme', 'mcp')) }],
  })
  const association = reduceThreadPullRequests(undefined, [], [mcpResult], 100)?.[0]
  assert.equal(association?.url, 'https://github.com/acme/mcp/pull/13')
})

test('ignores failed calls, prose, noncanonical URLs, and lookalike tool names', () => {
  const parts = [
    toolPart('failed', 'GITHUB_CREATE_A_PULL_REQUEST', {}, pullRequest(1), 'output-error'),
    toolPart('mcp-error', 'call_mcp_tool', {
      toolName: 'GITHUB_CREATE_A_PULL_REQUEST',
      arguments: {},
    }, {
      isError: true,
      structuredContent: pullRequest(2),
    }),
    ...[
      'https://github.com.evil/acme/widgets/pull/3',
      'https://evil.github.com/acme/widgets/pull/3',
      'https://user@github.com/acme/widgets/pull/3',
      'https://github.com/acme/widgets/pull/3/files',
      'https://github.com/acme/widgets/pull/3?tab=files',
    ].map((url, index) => toolPart(`spoof-${index}`, 'GITHUB_CREATE_A_PULL_REQUEST', {}, {
      number: 3,
      html_url: url,
      title: 'Spoofed result',
      state: 'open',
    })),
    toolPart('mismatched-number', 'GITHUB_CREATE_A_PULL_REQUEST', {}, {
      ...pullRequest(8),
      number: 9,
    }),
    toolPart('ordinary-url', 'call_mcp_tool', {
      toolName: 'GITHUB_CREATE_A_PULL_REQUEST',
      arguments: {},
    }, {
      content: [{ type: 'text', text: 'Created https://github.com/acme/widgets/pull/4' }],
    }),
    toolPart('list', 'GITHUB_LIST_PULL_REQUESTS', {}, pullRequest(5)),
    toolPart('lookalike', 'NOT_GITHUB_CREATE_A_PULL_REQUEST', {}, pullRequest(6)),
    toolPart('unknown-state', 'GITHUB_CREATE_A_PULL_REQUEST', {}, {
      ...pullRequest(7),
      state: 'maybe',
    }),
  ]

  assert.equal(reduceThreadPullRequests(undefined, [], parts, 100), undefined)
})

test('uses authoritative merge input when the successful response only says merged', () => {
  const merge = toolPart('merge-minimal', 'GITHUB_MERGE_A_PULL_REQUEST', {
    owner: 'LayerNorm',
    repo: 'overlay-web',
    pull_number: 51,
  }, { merged: true })
  const association = reduceThreadPullRequests(undefined, [], [merge], 100)?.[0]
  assert.deepEqual(association, {
    owner: 'LayerNorm',
    repo: 'overlay-web',
    number: 51,
    title: 'Pull request #51',
    url: 'https://github.com/LayerNorm/overlay-web/pull/51',
    state: 'merged',
    observedAt: 100,
  })

  const create = toolPart('create-before-merge', 'GITHUB_CREATE_A_PULL_REQUEST', {}, pullRequest(51, 'LayerNorm', 'overlay-web'))
  const existing = reduceThreadPullRequests(undefined, [], [create], 50)!
  const withExistingTitle = reduceThreadPullRequests(existing, [create], [create, merge], 100)
  assert.equal(withExistingTitle?.[0]?.title, 'Pull request 51')
})

test('matches each Composio batch result to its tool and ignores only failed entries', () => {
  const batch = toolPart('batch', 'COMPOSIO_MULTI_EXECUTE_TOOL', {
    tools: [
      { tool_slug: 'GITHUB_CREATE_A_PULL_REQUEST', arguments: { owner: 'acme', repo: 'good' } },
      { tool_slug: 'GITHUB_MERGE_A_PULL_REQUEST', arguments: { owner: 'acme', repo: 'denied', pull_number: 8 } },
      { tool_slug: 'GITHUB_LIST_PULL_REQUESTS', arguments: { owner: 'acme', repo: 'listed' } },
    ],
  }, {
    results: [
      {
        tool_slug: 'GITHUB_CREATE_A_PULL_REQUEST',
        successful: true,
        response_data: pullRequest(7, 'acme', 'good'),
      },
      {
        tool_slug: 'GITHUB_MERGE_A_PULL_REQUEST',
        successful: false,
        error: 'Approval denied',
        response_data: { merged: true },
      },
      {
        tool_slug: 'GITHUB_LIST_PULL_REQUESTS',
        successful: true,
        response_data: pullRequest(9, 'acme', 'listed'),
      },
    ],
  })

  const associations = reduceThreadPullRequests(undefined, [], [batch], 100)
  assert.deepEqual(associations?.map(item => item.number), [7])

  const partialBatch = toolPart('partial-batch', 'COMPOSIO_MULTI_EXECUTE_TOOL', {
    tools: [
      { tool_slug: 'GITHUB_MERGE_A_PULL_REQUEST', arguments: { owner: 'acme', repo: 'denied', pull_number: 11 } },
      { tool_slug: 'GITHUB_CREATE_A_PULL_REQUEST', arguments: { owner: 'acme', repo: 'good-after-failure' } },
    ],
  }, {
    success: false,
    results: [{
      tool_slug: 'GITHUB_CREATE_A_PULL_REQUEST',
      successful: true,
      response_data: pullRequest(12, 'acme', 'good-after-failure'),
    }],
  })
  assert.deepEqual(reduceThreadPullRequests(undefined, [], [partialBatch], 100)?.map(item => item.number), [12])

  const workspaceBatch = toolPart('workspace-batch', 'workspace_COMPOSIO_MULTI_EXECUTE_TOOL', {
    tools: [{
      tool_slug: 'GITHUB_MERGE_A_PULL_REQUEST',
      arguments: { owner: 'acme', repo: 'workspace', pull_number: 10 },
    }],
  }, {
    results: [{
      tool_slug: 'GITHUB_MERGE_A_PULL_REQUEST',
      successful: true,
      response_data: { merged: true },
    }],
  })
  assert.equal(reduceThreadPullRequests(undefined, [], [workspaceBatch], 100)?.[0]?.state, 'merged')
})

test('replays do not refresh timestamps and older GitHub snapshots do not regress state', () => {
  const initial = toolPart('same-call', 'GITHUB_CREATE_A_PULL_REQUEST', { owner: 'acme', repo: 'widgets' },
    pullRequest(12, 'acme', 'widgets', 'open', { updated_at: '2026-10-20T12:00:00Z' }))
  const first = reduceThreadPullRequests(undefined, [], [initial], 100)!
  const replayed = reduceThreadPullRequests(first, [initial], [initial], 200)!
  assert.equal(replayed[0]?.observedAt, 100)

  const changed = toolPart('same-call', 'GITHUB_CREATE_A_PULL_REQUEST', { owner: 'acme', repo: 'widgets' },
    pullRequest(12, 'acme', 'widgets', 'closed', { updated_at: '2026-10-20T13:00:00Z' }))
  const updated = reduceThreadPullRequests(first, [initial], [changed], 300)!
  assert.equal(updated[0]?.state, 'closed')
  assert.equal(updated[0]?.observedAt, 300)

  const staleRead = toolPart('stale-read', 'call_mcp_tool', {
    toolName: 'GITHUB_GET_A_PULL_REQUEST',
    arguments: { owner: 'acme', repo: 'widgets', pull_number: 12 },
  }, {
    structuredContent: pullRequest(12, 'acme', 'widgets', 'open', {
      updated_at: '2026-10-20T11:00:00Z',
    }),
  })
  const afterStale = reduceThreadPullRequests(updated, [changed], [changed, staleRead], 400)!
  assert.equal(afterStale[0]?.state, 'closed')
  assert.equal(afterStale[0]?.observedAt, 300)
})
