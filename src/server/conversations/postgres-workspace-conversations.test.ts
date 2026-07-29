import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { inArray } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import { users, workspaces } from '@/server/database/postgres/schema'
import { PostgresWorkspaceRepository } from '@/server/workspaces/PostgresWorkspaceRepository'
import { PostgresActConversationRepository } from './PostgresActConversationRepository'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres conversations preserve payloads while isolating workspace views', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const scope = `phase2_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`
  const personalWorkspaceId = `${scope}_personal`
  const personalPrincipalId = `${scope}_personal_principal`
  const organizationWorkspaceId = `${scope}_organization`
  const organizationPrincipalId = `${scope}_organization_principal`
  const workspaceRepository = new PostgresWorkspaceRepository(db)
  const conversations = new PostgresActConversationRepository(db)

  try {
    await db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
    })
    await workspaceRepository.ensurePersonalWorkspace({
      workspaceId: personalWorkspaceId,
      slug: personalWorkspaceId,
      principalId: personalPrincipalId,
      userId,
      displayName: 'Owner',
      now: 100,
    })
    await workspaceRepository.createOrganization({
      workspaceId: organizationWorkspaceId,
      ownerPrincipalId: organizationPrincipalId,
      actorUserId: userId,
      ownerDisplayName: 'Owner',
      name: 'Organization',
      slug: organizationWorkspaceId,
      now: 200,
    })

    const personalConversationId = await conversations.createConversation({
      workspaceId: personalWorkspaceId,
      createdByPrincipalId: personalPrincipalId,
      conversationType: 'personal',
      clientId: `${scope}_same_client`,
      userId,
      title: 'Personal payload',
      askModelIds: ['model/ask'],
      actModelId: 'model/act',
    })
    const organizationConversationId = await conversations.createConversation({
      workspaceId: organizationWorkspaceId,
      createdByPrincipalId: organizationPrincipalId,
      conversationType: 'personal',
      clientId: `${scope}_same_client`,
      userId,
      title: 'Organization payload',
      askModelIds: ['model/ask'],
      actModelId: 'model/act',
    })

    assert.deepEqual(
      (await conversations.listConversations({
        workspaceId: personalWorkspaceId,
        conversationType: 'personal',
        userId,
      })).map((conversation) => conversation._id),
      [personalConversationId],
    )
    assert.deepEqual(
      (await conversations.listConversations({
        workspaceId: organizationWorkspaceId,
        conversationType: 'personal',
        userId,
      })).map((conversation) => conversation._id),
      [organizationConversationId],
    )
    assert.equal(await conversations.getConversationById({
      conversationId: organizationConversationId,
      workspaceId: personalWorkspaceId,
      userId,
    }), null)

    await conversations.addMessage({
      workspaceId: personalWorkspaceId,
      conversationId: personalConversationId,
      userId,
      turnId: `${scope}_turn`,
      role: 'user',
      mode: 'act',
      content: 'Preserved content',
      contentType: 'text',
      parts: [{ type: 'file', fileName: 'preserved.pdf' }],
    })
    const [message] = await conversations.getConversationMessages({
      workspaceId: personalWorkspaceId,
      conversationId: personalConversationId,
      userId,
    })
    assert.equal(message?.authorKind, 'human')
    assert.equal(message?.authorPrincipalId, personalPrincipalId)
    assert.equal(message?.parts?.[0]?.fileName, 'preserved.pdf')

    const personalEvents = await conversations.listConversationEvents({
      afterSequence: 0,
      limit: 100,
      userId,
      workspaceId: personalWorkspaceId,
    })
    const organizationEvents = await conversations.listConversationEvents({
      afterSequence: 0,
      limit: 100,
      userId,
      workspaceId: organizationWorkspaceId,
    })
    assert.ok(personalEvents.length > 0)
    assert.ok(organizationEvents.length > 0)
    assert.ok(personalEvents.every((event) => event.conversationId === personalConversationId))
    assert.ok(organizationEvents.every((event) => event.conversationId === organizationConversationId))
    assert.equal(
      await conversations.getConversationEventCursor({ userId, workspaceId: personalWorkspaceId }),
      personalEvents.at(-1)?.sequence,
    )

    const shared = await conversations.setShare({
      conversationId: personalConversationId,
      userId,
      visibility: 'public',
    })
    assert.ok(shared)
    assert.ok(shared.token)
    assert.equal((await conversations.getPublicConversationByToken({
      token: shared.token!,
    }))?.title, 'Personal payload')
    assert.equal((await workspaceRepository.getResourceWorkspace({
      resourceType: 'conversation',
      resourceId: personalConversationId,
    }))?.workspaceId, personalWorkspaceId)
  } finally {
    await db.delete(workspaces).where(inArray(workspaces.id, [
      personalWorkspaceId,
      organizationWorkspaceId,
    ]))
    await db.delete(users).where(inArray(users.id, [userId]))
    await pool.end()
  }
})
