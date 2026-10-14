import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkItem } from '@overlay/app-core/work'
import { WorkProperties } from './WorkBriefSections'
Object.assign(globalThis, { React })
test('an unavailable reviewer or archived objective stays selected so it can be explicitly cleared', () => {
  const item: WorkItem = {
    _id: 'task',
    _creationTime: 1,
    workspaceId: 'ws',
    userId: 'alice',
    scope: 'personal',
    title: 'Ship',
    description: '',
    status: 'todo',
    priority: 2,
    blocked: false,
    rank: 'i',
    createdAt: 1,
    updatedAt: 1,
  }
  const html = renderToStaticMarkup(
    React.createElement(WorkProperties, {
      item,
      draft: {
        reviewerUserId: 'inactive-reviewer',
        parentId: 'archived-objective',
      },
      people: [],
      items: [],
      change: () => {},
    }),
  )
  assert.match(html, />Unavailable reviewer</)
  assert.match(html, />Archived or unavailable objective</)
})
