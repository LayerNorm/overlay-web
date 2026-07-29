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
import { PostgresConversationCollaborationRepository } from './PostgresConversationCollaborationRepository'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres direct messages are participant-scoped and realtime-ready', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const scope = `phase3_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_owner`
  const memberUserId = `${scope}_member`
  const personalWorkspaceId = `${scope}_personal`
  const personalPrincipalId = `${scope}_personal_principal`
  const workspaceId = `${scope}_workspace`
  const ownerPrincipalId = `${scope}_owner_principal`
  const memberPrincipalId = `${scope}_member_principal`
  const workspacesRepository = new PostgresWorkspaceRepository(db)
  const conversations = new PostgresActConversationRepository(db)
  const collaboration = new PostgresConversationCollaborationRepository(db)

  try {
    await db.insert(users).values([
      { id: ownerUserId, email: `${ownerUserId}@example.com`, emailVerified: true },
      { id: memberUserId, email: `${memberUserId}@example.com`, emailVerified: true },
    ])
    await workspacesRepository.ensurePersonalWorkspace({
      workspaceId: personalWorkspaceId,
      slug: personalWorkspaceId,
      principalId: personalPrincipalId,
      userId: ownerUserId,
      displayName: 'Owner',
      now: Date.now(),
    })
    await workspacesRepository.createOrganization({
      workspaceId,
      ownerPrincipalId,
      actorUserId: ownerUserId,
      ownerDisplayName: 'Owner',
      name: 'Acme',
      slug: workspaceId,
      now: Date.now(),
    })
    const invitation = await workspacesRepository.createInvitationReplacingPending({
      id: `${scope}_invite`,
      workspaceId,
      email: `${memberUserId}@example.com`,
      role: 'member',
      invitedByPrincipalId: ownerPrincipalId,
      expiresAt: Date.now() + 60_000,
      now: Date.now(),
    })
    assert.equal((await workspacesRepository.acceptInvitation({
      invitationId: invitation.id,
      principalId: memberPrincipalId,
      userId: memberUserId,
      email: invitation.email,
      displayName: 'Member',
      now: Date.now(),
    })).status, 'accepted')

    const sourceConversationId = await conversations.createConversation({
      workspaceId,
      createdByPrincipalId: ownerPrincipalId,
      conversationType: 'personal',
      userId: ownerUserId,
      title: 'Private source',
      askModelIds: ['openrouter/free'],
      actModelId: 'openrouter/free',
    })
    await conversations.addMessage({
      workspaceId,
      conversationId: sourceConversationId,
      userId: ownerUserId,
      authorPrincipalId: ownerPrincipalId,
      turnId: `${scope}_source_turn`,
      role: 'user',
      mode: 'act',
      content: 'Source context',
      contentType: 'text',
    })

    const created = await collaboration.createDirectMessage({
      actorUserId: ownerUserId,
      workspaceId,
      principalIds: [memberPrincipalId],
      sourceConversationId,
    })
    assert.equal(created.created, true)
    assert.equal(created.participants.length, 2)
    assert.equal((await collaboration.createDirectMessage({
      actorUserId: ownerUserId,
      workspaceId,
      principalIds: [memberPrincipalId],
    })).conversationId, created.conversationId)
    assert.equal(await collaboration.canAccessConversation({
      actorUserId: memberUserId,
      workspaceId,
      conversationId: created.conversationId as never,
    }), true)
    assert.equal((await conversations.getConversationMessages({
      workspaceId,
      conversationId: created.conversationId as never,
      userId: memberUserId,
    }))[0]?.content, 'Source context')

    const clientNonce = `${scope}_nonce`
    const messageId = await conversations.addMessage({
      workspaceId,
      conversationId: created.conversationId as never,
      userId: memberUserId,
      authorPrincipalId: memberPrincipalId,
      clientNonce,
      turnId: `${scope}_member_turn`,
      role: 'user',
      mode: 'act',
      content: 'Hello owner',
      contentType: 'text',
    })
    assert.ok(messageId)
    assert.equal(await conversations.addMessage({
      workspaceId,
      conversationId: created.conversationId as never,
      userId: memberUserId,
      authorPrincipalId: memberPrincipalId,
      clientNonce,
      turnId: `${scope}_member_turn_retry`,
      role: 'user',
      mode: 'act',
      content: 'Duplicate should not persist',
      contentType: 'text',
    }), messageId)
    await collaboration.recordMessageActivity({
      actorUserId: memberUserId,
      workspaceId,
      conversationId: created.conversationId,
      messageId: messageId!,
      body: 'Hello owner',
      mentionedPrincipalIds: [ownerPrincipalId],
    })
    const notifications = await collaboration.listNotifications({
      actorUserId: ownerUserId,
      workspaceId,
      unreadOnly: true,
    })
    assert.equal(notifications.some((notification) => (
      notification.messageId === messageId && notification.type === 'mention'
    )), true)

    await collaboration.upsertPresence({
      actorUserId: memberUserId,
      workspaceId,
      conversationId: created.conversationId,
      status: 'online',
      typing: true,
    })
    assert.equal((await collaboration.listPresence({
      actorUserId: ownerUserId,
      workspaceId,
      conversationId: created.conversationId,
    })).find((row) => row.principalId === memberPrincipalId)?.typing, true)

    assert.equal(await collaboration.editMessage({
      actorUserId: ownerUserId,
      workspaceId,
      conversationId: created.conversationId,
      messageId: messageId!,
      content: 'Not mine',
    }), false)
    assert.equal(await collaboration.editMessage({
      actorUserId: memberUserId,
      workspaceId,
      conversationId: created.conversationId,
      messageId: messageId!,
      content: 'Edited',
    }), true)
    assert.equal(await collaboration.deleteMessage({
      actorUserId: memberUserId,
      workspaceId,
      conversationId: created.conversationId,
      messageId: messageId!,
    }), true)
    const tombstone = (await conversations.getConversationMessages({
      workspaceId,
      conversationId: created.conversationId as never,
      userId: ownerUserId,
    })).find((message) => message._id === messageId)
    assert.equal(tombstone?.content, '')
    assert.ok(tombstone?.deletedAt)

    assert.equal(await collaboration.removeParticipant({
      actorUserId: ownerUserId,
      workspaceId,
      conversationId: created.conversationId,
      principalId: memberPrincipalId,
    }), true)
    assert.equal(await collaboration.canAccessConversation({
      actorUserId: memberUserId,
      workspaceId,
      conversationId: created.conversationId,
    }), false)
  } finally {
    await db.delete(workspaces).where(inArray(workspaces.id, [personalWorkspaceId, workspaceId]))
    await db.delete(users).where(inArray(users.id, [ownerUserId, memberUserId]))
    await pool.end()
  }
})
