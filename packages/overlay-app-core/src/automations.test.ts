import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyAutomationRename,
  applyAutomationUpdate,
  automationEditorDraftFromDetail,
  automationGraphFromGraphSource,
  automationGraphFromInstructions,
  automationHref,
  automationStatus,
  buildAutomationSchedule,
  buildAutomationUpdateRequest,
  defaultAutomationGraph,
  defaultAutomationGraphSource,
  extractAutomationInstructionSteps,
  formatAutomationRunError,
  getAutomationDisplayName,
  graphSourceFromAutomationGraph,
  normalizeAutomationDetailTab,
  parseAutomationTime,
  removeAutomationById,
  resolveAutomationGraph,
} from './automations'
import { AUTOMATION_GRAPH_VERSION } from './contracts'

test('automation sidebar helpers preserve labels, routes, and optimistic state', () => {
  const automations = [
    { _id: 'auto_1', title: 'Draft', enabled: true, createdAt: 1, updatedAt: 1, sourceConversationId: 'chat_1' },
    { _id: 'auto_2', name: 'Daily', enabled: false, createdAt: 1, updatedAt: 1, lastError: 'boom' },
  ]

  assert.equal(getAutomationDisplayName(automations[0]!), 'Draft')
  assert.equal(automationHref(automations[0]!), '/app/automations?id=chat_1&automationId=auto_1')
  assert.equal(automationHref(automations[1]!), '/app/automations?automationId=auto_2')
  assert.deepEqual(automationStatus(automations[0]!), { label: 'Enabled', tone: 'enabled' })
  assert.deepEqual(automationStatus(automations[1]!), { label: 'Error', tone: 'error' })
  assert.equal(applyAutomationRename(automations, 'auto_1', 'Renamed')[0]!.name, 'Renamed')
  assert.deepEqual(removeAutomationById(automations, 'auto_1').map((item) => item._id), ['auto_2'])
})

test('automation editor helpers normalize tabs, instructions, graph source, and draft state', () => {
  const automation = {
    _id: 'auto_1',
    name: 'Morning brief',
    instructions: '1. Check the inbox\n2. Summarize urgent mail',
    enabled: true,
    schedule: { kind: 'daily' as const, hourUTC: 14, minuteUTC: 30 },
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
  }

  assert.equal(normalizeAutomationDetailTab('graph'), 'edit')
  assert.deepEqual(extractAutomationInstructionSteps(automation.instructions), [
    'Check the inbox',
    'Summarize urgent mail',
  ])
  assert.match(defaultAutomationGraphSource(automation, 'model_a'), /step1/)

  const draft = automationEditorDraftFromDetail(automation, 'model_a')
  assert.equal(draft.name, 'Morning brief')
  assert.equal(draft.modelId, 'model_a')
  assert.equal(draft.scheduleKind, 'daily')
})

test('automation schedule helpers preserve interval and local time conversion contracts', () => {
  assert.deepEqual(parseAutomationTime('25:99'), { hour: 23, minute: 59 })
  assert.deepEqual(
    buildAutomationSchedule({
      kind: 'interval',
      intervalMinutes: 0,
      time: '09:00',
      dayOfWeek: 1,
      dayOfMonth: 1,
      timeZone: 'UTC',
    }),
    { kind: 'interval', intervalMinutes: 60 },
  )
  assert.deepEqual(
    buildAutomationSchedule({
      kind: 'interval',
      intervalMinutes: 5,
      time: '09:00',
      dayOfWeek: 1,
      dayOfMonth: 1,
      timeZone: 'UTC',
    }),
    { kind: 'interval', intervalMinutes: 15 },
  )
  assert.deepEqual(
    buildAutomationSchedule({
      kind: 'daily',
      intervalMinutes: 60,
      time: '09:15',
      dayOfWeek: 1,
      dayOfMonth: 1,
      timeZone: 'UTC',
      nowMs: Date.UTC(2026, 0, 1, 0, 0),
    }),
    { kind: 'daily', hourUTC: 9, minuteUTC: 15 },
  )
})

test('automation update request keeps endpoint body shape typed', () => {
  const automation = {
    _id: 'auto_1',
    name: 'Old',
    instructions: 'Old instructions',
    schedule: { kind: 'daily' as const, hourUTC: 12, minuteUTC: 0 },
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
  }
  const draft = automationEditorDraftFromDetail(automation, 'model_a')
  const request = buildAutomationUpdateRequest({
    automation,
    draft: {
      ...draft,
      name: 'New',
      instructions: '1. First\n2. Second',
      timezone: 'UTC',
      time: '10:00',
    },
  })

  assert.equal(request.automationId, 'auto_1')
  assert.equal(request.name, 'New')
  assert.equal(request.instructions, '1. First\n2. Second')
  assert.deepEqual(request.schedule, { kind: 'daily', hourUTC: 10, minuteUTC: 0 })
  // graphSource is no longer persisted in the update request — it's derived
  // from the structured graph on the server side.
  assert.equal(request.graphSource, undefined)
  assert.ok(request.graph, 'update request should include structured graph')
  assert.equal(request.graph!.version, AUTOMATION_GRAPH_VERSION)
})

// ---------------------------------------------------------------------------
// AutomationGraph model tests
// ---------------------------------------------------------------------------

test('automationGraphFromInstructions builds a linear chain with an output node', () => {
  const graph = automationGraphFromInstructions({
    instructions: '1. Check the inbox\n2. Summarize urgent mail',
  })
  assert.ok(graph, 'should produce a graph')
  assert.equal(graph!.version, AUTOMATION_GRAPH_VERSION)
  assert.equal(graph!.nodes.length, 4, 'trigger + two prompt nodes + one output node')
  assert.equal(graph!.nodes[0]!.kind, 'trigger')
  assert.equal(graph!.nodes[0]!.id, 'trigger')
  assert.equal(graph!.nodes[1]!.kind, 'prompt')
  assert.equal(graph!.nodes[1]!.id, 'step1')
  assert.equal(graph!.nodes[2]!.kind, 'prompt')
  assert.equal(graph!.nodes[2]!.id, 'step2')
  assert.equal(graph!.nodes[3]!.kind, 'output')
  assert.equal(graph!.nodes[3]!.id, 'output')
  assert.equal(graph!.edges.length, 3)
  assert.deepEqual(graph!.edges[0], { from: 'trigger', to: 'step1' })
  assert.deepEqual(graph!.edges[1], { from: 'step1', to: 'step2' })
  assert.deepEqual(graph!.edges[2], { from: 'step2', to: 'output' })
})

test('automationGraphFromInstructions returns null for empty instructions', () => {
  assert.equal(automationGraphFromInstructions({ instructions: '' }), null)
  assert.equal(automationGraphFromInstructions({ instructions: '   \n  ' }), null)
})

test('graphSourceFromAutomationGraph produces valid Mermaid output', () => {
  const graph = automationGraphFromInstructions({
    instructions: '1. First step\n2. Second step',
  })!
  const source = graphSourceFromAutomationGraph(graph)
  assert.match(source, /^flowchart TD/)
  assert.match(source, /step1\["1\. First step"\]/)
  assert.match(source, /step2\["2\. Second step"\]/)
  assert.match(source, /output\["Write result to automation chat"\]/)
  assert.match(source, /step1 --> step2/)
  assert.match(source, /step2 --> output/)
})

test('graphSourceFromAutomationGraph returns empty string for empty graph', () => {
  assert.equal(graphSourceFromAutomationGraph({ version: 1, nodes: [], edges: [] }), '')
})

test('automationGraphFromGraphSource migrates legacy Mermaid to structured graph', () => {
  const legacySource = [
    'flowchart TD',
    '  trigger["daily trigger"] --> instructions["My automation"]',
    '  instructions --> output["Write result"]',
  ].join('\n')
  const graph = automationGraphFromGraphSource(legacySource)
  assert.ok(graph, 'should migrate legacy graphSource')
  assert.equal(graph!.version, AUTOMATION_GRAPH_VERSION)
  const triggerNode = graph!.nodes.find((n) => n.id === 'trigger')
  assert.ok(triggerNode, 'should have trigger node')
  assert.equal(triggerNode!.kind, 'trigger')
  const outputNode = graph!.nodes.find((n) => n.id === 'output')
  assert.ok(outputNode, 'should have output node')
  assert.equal(outputNode!.kind, 'output')
  const promptNode = graph!.nodes.find((n) => n.id === 'instructions')
  assert.ok(promptNode, 'should have prompt node')
  assert.equal(promptNode!.kind, 'prompt')
  assert.equal(graph!.edges.length, 2)
})

test('automationGraphFromGraphSource returns null for invalid input', () => {
  assert.equal(automationGraphFromGraphSource(''), null)
  assert.equal(automationGraphFromGraphSource('not a graph'), null)
})

test('round-trip: instructions → graph → graphSource → graph is stable', () => {
  const instructions = '1. Check inbox\n2. Summarize mail\n3. Send digest'
  const graph1 = automationGraphFromInstructions({ instructions })!
  const source1 = graphSourceFromAutomationGraph(graph1)
  const graph2 = automationGraphFromGraphSource(source1)!
  const source2 = graphSourceFromAutomationGraph(graph2)

  // graphSource should be identical after round-trip
  assert.equal(source1, source2, 'graphSource should be stable after round-trip')

  // Node IDs and edge structure should match
  assert.deepEqual(
    graph1.nodes.map((n) => n.id),
    graph2.nodes.map((n) => n.id),
  )
  assert.deepEqual(graph1.edges, graph2.edges)
})

test('defaultAutomationGraph builds trigger → prompt → output when no instructions', () => {
  const graph = defaultAutomationGraph({
    name: 'Test automation',
    schedule: { kind: 'daily', hourUTC: 9, minuteUTC: 0 },
    modelId: 'model_a',
  }, 'default')
  assert.equal(graph.version, AUTOMATION_GRAPH_VERSION)
  assert.equal(graph.nodes.length, 3)
  assert.equal(graph.nodes[0]!.kind, 'trigger')
  assert.equal(graph.nodes[0]!.label, 'daily trigger')
  assert.equal(graph.nodes[1]!.kind, 'prompt')
  assert.equal(graph.nodes[2]!.kind, 'output')
  assert.equal(graph.edges.length, 2)
})

test('defaultAutomationGraphSource still produces Mermaid via graph model', () => {
  const source = defaultAutomationGraphSource({
    name: 'Test',
    instructions: '1. Do thing',
    schedule: { kind: 'interval', intervalMinutes: 60 },
    modelId: 'model_a',
  }, 'default')
  assert.match(source, /^flowchart TD/)
  assert.match(source, /step1/)
  assert.match(source, /output/)
})

test('resolveAutomationGraph uses persisted graph first, then graphSource, then instructions', () => {
  const persistedGraph = {
    version: 1,
    nodes: [{ id: 'custom', kind: 'prompt' as const, label: 'Custom', config: {} }],
    edges: [],
  }
  // Prefers persisted graph
  assert.equal(
    resolveAutomationGraph({ graph: persistedGraph, graphSource: 'flowchart TD\n  a["A"]' }),
    persistedGraph,
  )

  // Falls back to graphSource migration
  const fromSource = resolveAutomationGraph({
    graphSource: 'flowchart TD\n  trigger["trigger"] --> output["out"]',
  })
  assert.ok(fromSource.nodes.find((n) => n.id === 'trigger'))

  // Falls back to default graph
  const fromDefault = resolveAutomationGraph({ name: 'Test', schedule: { kind: 'daily' } })
  assert.equal(fromDefault.nodes.length, 3)
  assert.equal(fromDefault.nodes[0]!.kind, 'trigger')
})

test('automationEditorDraftFromDetail includes structured graph', () => {
  const automation = {
    _id: 'auto_1',
    name: 'Test',
    instructions: '1. Step one\n2. Step two',
    schedule: { kind: 'daily' as const, hourUTC: 14, minuteUTC: 0 },
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
  }
  const draft = automationEditorDraftFromDetail(automation, 'model_a')
  assert.ok(draft.graph, 'draft should include structured graph')
  assert.equal(draft.graph!.version, AUTOMATION_GRAPH_VERSION)
  assert.equal(draft.graph!.nodes.length, 4, 'trigger + two prompt nodes + output')
  assert.ok(draft.graphSource, 'draft should still include graphSource for backward compat')
})

// ---------------------------------------------------------------------------
// Step 4: Edit-then-regenerate preservation
// ---------------------------------------------------------------------------

test('buildAutomationUpdateRequest regenerates graph from instructions when not manuallyEdited', () => {
  const automation = {
    _id: 'auto_1',
    name: 'Test',
    instructions: '1. Step one\n2. Step two',
    schedule: { kind: 'daily' as const, hourUTC: 14, minuteUTC: 0 },
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
  }
  const draft = automationEditorDraftFromDetail(automation, 'model_a')
  // Change instructions — graph should be regenerated
  draft.instructions = '1. New step\n2. Another step\n3. Final step'
  const request = buildAutomationUpdateRequest({ automation, draft })
  assert.ok(request.graph)
  assert.equal(request.graph!.nodes.length, 5, 'regenerated graph should have trigger + 3 prompt nodes + output')
  assert.equal(request.graph!.manuallyEdited, undefined)
})

test('buildAutomationUpdateRequest preserves manuallyEdited graph even when instructions change', () => {
  const automation = {
    _id: 'auto_1',
    name: 'Test',
    instructions: '1. Step one\n2. Step two',
    schedule: { kind: 'daily' as const, hourUTC: 14, minuteUTC: 0 },
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
  }
  const draft = automationEditorDraftFromDetail(automation, 'model_a')
  // Simulate manual edit: mark graph as manuallyEdited and add a node
  draft.graph = {
    ...draft.graph!,
    manuallyEdited: true,
    nodes: [
      ...draft.graph!.nodes,
      { id: 'custom_node', kind: 'tool', label: 'Custom Tool', config: { toolId: 'web_search' } },
    ],
    edges: [
      ...draft.graph!.edges,
      { from: 'step_1', to: 'custom_node' },
      { from: 'custom_node', to: 'step_2' },
    ],
  }
  // Change instructions — graph should NOT be regenerated because manuallyEdited
  draft.instructions = '1. Completely different instructions'
  const request = buildAutomationUpdateRequest({ automation, draft })
  assert.ok(request.graph)
  assert.equal(request.graph!.manuallyEdited, true)
  // The custom node should still be there
  assert.ok(request.graph!.nodes.some((n) => n.id === 'custom_node'))
})

test('buildAutomationUpdateRequest uses draft.graph when instructions unchanged', () => {
  const automation = {
    _id: 'auto_1',
    name: 'Test',
    instructions: '1. Step one\n2. Step two',
    schedule: { kind: 'daily' as const, hourUTC: 14, minuteUTC: 0 },
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
  }
  const draft = automationEditorDraftFromDetail(automation, 'model_a')
  // Don't change instructions — should use draft.graph as-is
  const request = buildAutomationUpdateRequest({ automation, draft })
  assert.ok(request.graph)
  assert.deepEqual(request.graph, draft.graph)
})

test('applyAutomationUpdate persists graph field', () => {
  const automation = {
    _id: 'auto_1',
    name: 'Test',
    instructions: '1. Step one',
    schedule: { kind: 'daily' as const, hourUTC: 14, minuteUTC: 0 },
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
  }
  const draft = automationEditorDraftFromDetail(automation, 'model_a')
  draft.graph = {
    ...draft.graph!,
    manuallyEdited: true,
  }
  const request = buildAutomationUpdateRequest({ automation, draft })
  const updated = applyAutomationUpdate(automation, request)
  assert.ok(updated.graph)
  assert.equal(updated.graph!.manuallyEdited, true)
})

test('manuallyEdited graph survives round-trip through editor draft', () => {
  const automation = {
    _id: 'auto_1',
    name: 'Test',
    instructions: '1. Step one',
    schedule: { kind: 'daily' as const, hourUTC: 14, minuteUTC: 0 },
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
    graph: {
      version: AUTOMATION_GRAPH_VERSION,
      nodes: [
        { id: 'trigger', kind: 'trigger', label: 'Trigger', config: {} },
        { id: 'custom', kind: 'tool', label: 'My Tool', config: { toolId: 'x' } },
        { id: 'output', kind: 'output', label: 'Output', config: {} },
      ],
      edges: [
        { from: 'trigger', to: 'custom' },
        { from: 'custom', to: 'output' },
      ],
      manuallyEdited: true,
    },
  }
  const draft = automationEditorDraftFromDetail(automation, 'model_a')
  assert.ok(draft.graph)
  assert.equal(draft.graph!.manuallyEdited, true, 'draft should preserve manuallyEdited flag')
  assert.ok(draft.graph!.nodes.some((n) => n.id === 'custom'), 'custom node should survive')
})

test('formatAutomationRunError extracts JSON errors and explains authorization failures', () => {
  assert.equal(
    formatAutomationRunError('{"error":"Unauthorized"}'),
    'Automation authorization failed before execution. Retry the run; if it fails again, ask an administrator to check the automation service credentials.',
  )
  assert.equal(formatAutomationRunError('{"message":"Provider timed out"}'), 'Provider timed out')
  assert.equal(formatAutomationRunError('Plain failure'), 'Plain failure')
  assert.equal(formatAutomationRunError(null), null)
})
