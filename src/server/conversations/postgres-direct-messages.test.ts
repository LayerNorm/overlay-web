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

    const general = (await collaboration.listChannels({ actorUserId: memberUserId, workspaceId }))
      .find((channel) => channel.slug === 'general')
    assert.ok(general, 'organization creation must atomically create #general')
    assert.equal(general.visibility, 'public')

    const channel = await collaboration.createChannel({
      actorUserId: ownerUserId,
      workspaceId,
      name: 'Product Launch',
      topic: 'Launch decisions',
      visibility: 'public',
    })
    assert.equal(channel.slug, 'product-launch')
    assert.equal(channel.participantCount, 2)
    const rootMessageId = await conversations.addMessage({
      workspaceId,
      conversationId: channel.conversationId as never,
      userId: ownerUserId,
      authorPrincipalId: ownerPrincipalId,
      turnId: `${scope}_channel_root`,
      role: 'user',
      mode: 'act',
      content: 'Launch checklist',
      contentType: 'text',
    })
    const replyMessageId = await conversations.addMessage({
      workspaceId,
      conversationId: channel.conversationId as never,
      userId: memberUserId,
      authorPrincipalId: memberPrincipalId,
      turnId: `${scope}_thread_reply`,
      role: 'user',
      mode: 'act',
      content: 'Checklist reply',
      contentType: 'text',
      threadRootMessageId: rootMessageId!,
    })
    assert.equal((await conversations.getConversationMessages({
      workspaceId,
      conversationId: channel.conversationId as never,
      userId: memberUserId,
    })).find((message) => message._id === replyMessageId)?.threadRootMessageId, rootMessageId)
    assert.equal((await collaboration.setReaction({
      actorUserId: memberUserId,
      workspaceId,
      conversationId: channel.conversationId,
      messageId: rootMessageId!,
      emoji: 'thumbs_up',
      enabled: true,
    }))[0]?.count, 1)
    assert.equal(await collaboration.setPinned({
      actorUserId: ownerUserId,
      workspaceId,
      conversationId: channel.conversationId,
      messageId: rootMessageId!,
      pinned: true,
    }), true)
    assert.equal((await collaboration.listPins({
      actorUserId: memberUserId,
      workspaceId,
      conversationId: channel.conversationId,
    }))[0]?.messageId, rootMessageId)
    assert.equal(await collaboration.setSaved({
      actorUserId: memberUserId,
      workspaceId,
      conversationId: channel.conversationId,
      messageId: rootMessageId!,
      saved: true,
    }), true)
    assert.equal((await collaboration.listSavedMessages({ actorUserId: memberUserId, workspaceId }))[0]?.messageId, rootMessageId)
    assert.equal((await collaboration.searchWorkspaceChats({
      actorUserId: memberUserId,
      workspaceId,
      query: 'checklist',
    })).some((result) => result.conversationId === channel.conversationId), true)

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
    assert.deepEqual((await conversations.getConversationMessages({
      workspaceId,
      conversationId: created.conversationId as never,
      userId: memberUserId,
    })).filter((message) => message.content === 'Source context'), [])

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
    const markedRead = await collaboration.updateParticipantState({
      actorUserId: memberUserId,
      workspaceId,
      conversationId: created.conversationId,
      markRead: true,
    })
    assert.ok((markedRead.lastReadSequence ?? 0) > 0)
    const cappedRead = await collaboration.updateParticipantState({
      actorUserId: memberUserId,
      workspaceId,
      conversationId: created.conversationId,
      readSequence: Number.MAX_SAFE_INTEGER,
    })
    assert.equal(cappedRead.lastReadSequence, markedRead.lastReadSequence)
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
      sessionId: 'tab-a',
    })
    await collaboration.upsertPresence({
      actorUserId: memberUserId,
      workspaceId,
      conversationId: created.conversationId,
      status: 'offline',
      sessionId: 'tab-b',
    })
    assert.equal((await collaboration.listPresence({
      actorUserId: ownerUserId,
      workspaceId,
      conversationId: created.conversationId,
    })).find((row) => row.principalId === memberPrincipalId)?.typing, true)
    assert.equal((await collaboration.listPresence({
      actorUserId: ownerUserId,
      workspaceId,
      conversationId: created.conversationId,
    })).find((row) => row.principalId === memberPrincipalId)?.status, 'online')

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
    await assert.rejects(
      conversations.updateConversation({
        workspaceId,
        conversationId: created.conversationId as never,
        userId: memberUserId,
        title: 'Should remain private',
      }),
      /WORKSPACE_ACCESS_DENIED/,
    )
  } finally {
    await db.delete(workspaces).where(inArray(workspaces.id, [personalWorkspaceId, workspaceId]))
    await db.delete(users).where(inArray(users.id, [ownerUserId, memberUserId]))
    await pool.end()
  }
})
