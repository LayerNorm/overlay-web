import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import type { KnowledgeBaseRepositories } from '@overlay/app-core'

export async function runKnowledgeBaseRepositoryContract(
  t: TestContext,
  args: {
    repositories: KnowledgeBaseRepositories
    scope: string
    ownerUserId: string
    conversationId: string
    groupId: string
    /** Provide to exercise project attachments; the caller owns creating the project row. */
    projectId?: string
  },
): Promise<void> {
  const baseId = `${args.scope}_base`
  const secondBaseId = `${args.scope}_base_2`
  const sourceId = `${args.scope}_source`
  const sourceVersionId = `${args.scope}_source_v1`

  await t.test('persists personal knowledge-base lifecycle', async () => {
    const created = await args.repositories.bases.create({
      id: baseId,
      ownerUserId: args.ownerUserId,
      title: 'Organic Chemistry Review',
      description: 'Reaction mechanisms and practice material.',
      kind: 'personal',
      createdBy: args.ownerUserId,
    })
    assert.equal(created.id, baseId)
    assert.equal(created.status, 'active')
    assert.equal(created.kind, 'personal')

    const updated = await args.repositories.bases.update({
      id: baseId,
      title: 'Organic Chemistry Test Review',
    })
    assert.equal(updated?.title, 'Organic Chemistry Test Review')
    assert.deepEqual(
      (await args.repositories.bases.listForOwner(args.ownerUserId)).map(({ id }) => id),
      [baseId],
    )
    assert.ok((await args.repositories.bases.listAll()).some(({ id }) => id === baseId))
  })

  await t.test('reuses one canonical source across multiple bases', async () => {
    const source = await args.repositories.sources.create({
      id: sourceId,
      ownerUserId: args.ownerUserId,
      kind: 'file',
      sourceRef: `${args.scope}_file`,
      title: 'Mechanisms.pdf',
      mimeType: 'application/pdf',
      status: 'pending',
      metadata: { pageCount: 12 },
      createdBy: args.ownerUserId,
    })
    assert.equal(source.status, 'pending')

    const ready = await args.repositories.sources.update({
      id: sourceId,
      contentHash: 'sha256:organic-chemistry',
      status: 'ready',
      metadata: { pageCount: 12, indexedChunks: 24 },
    })
    assert.equal(ready?.status, 'ready')

    const firstVersion = await args.repositories.sources.createVersion({
      id: sourceVersionId,
      sourceId,
      version: 1,
      contentHash: 'sha256:organic-chemistry',
      status: 'ready',
      metadata: { indexedChunks: 24 },
    })
    const duplicateVersion = await args.repositories.sources.createVersion({
      id: `${sourceVersionId}_duplicate`,
      sourceId,
      version: 2,
      contentHash: 'sha256:organic-chemistry',
      status: 'ready',
      metadata: { indexedChunks: 24, retried: true },
    })
    assert.equal(duplicateVersion.id, firstVersion.id)
    assert.equal((await args.repositories.sources.listVersions(sourceId)).length, 1)

    await args.repositories.bases.create({
      id: secondBaseId,
      ownerUserId: args.ownerUserId,
      title: 'Shared Curriculum Brain',
      kind: 'organization',
      createdBy: args.ownerUserId,
    })
    await args.repositories.memberships.add({
      knowledgeBaseId: baseId,
      sourceId,
      addedBy: args.ownerUserId,
      enabled: true,
    })
    await args.repositories.memberships.add({
      knowledgeBaseId: secondBaseId,
      sourceId,
      addedBy: args.ownerUserId,
      enabled: true,
    })
    assert.equal((await args.repositories.memberships.listBasesForSource(sourceId)).length, 2)

    assert.equal(await args.repositories.memberships.setEnabled({
      knowledgeBaseId: baseId,
      sourceId,
      enabled: false,
    }), true)
    assert.equal((await args.repositories.memberships.listForBase(baseId))[0]?.enabled, false)
  })

  await t.test('grounds one chat against several knowledge bases', async () => {
    const attached = await args.repositories.conversations.attach({
      knowledgeBaseId: baseId,
      conversationId: args.conversationId,
      createdBy: args.ownerUserId,
    })
    assert.equal(attached.knowledgeBaseId, baseId)

    const second = await args.repositories.conversations.attach({
      knowledgeBaseId: secondBaseId,
      conversationId: args.conversationId,
      createdBy: args.ownerUserId,
    })
    assert.equal(second.knowledgeBaseId, secondBaseId)

    // Attaching a second base must add to the set, not replace the first.
    assert.equal((await args.repositories.conversations.listForBase(baseId)).length, 1)
    assert.equal((await args.repositories.conversations.listForBase(secondBaseId)).length, 1)
    assert.deepEqual(
      (await args.repositories.conversations.listForConversation(args.conversationId))
        .map(({ knowledgeBaseId }) => knowledgeBaseId)
        .sort(),
      [baseId, secondBaseId].sort(),
    )

    // Re-attaching the same pair is idempotent rather than duplicating a row.
    await args.repositories.conversations.attach({
      knowledgeBaseId: baseId,
      conversationId: args.conversationId,
      createdBy: args.ownerUserId,
    })
    assert.equal((await args.repositories.conversations.listForConversation(args.conversationId)).length, 2)

    // Detaching one base leaves the others grounded.
    assert.equal(await args.repositories.conversations.detachOne({
      conversationId: args.conversationId,
      knowledgeBaseId: baseId,
    }), true)
    assert.deepEqual(
      (await args.repositories.conversations.listForConversation(args.conversationId))
        .map(({ knowledgeBaseId }) => knowledgeBaseId),
      [secondBaseId],
    )
    assert.equal(await args.repositories.conversations.detachOne({
      conversationId: args.conversationId,
      knowledgeBaseId: baseId,
    }), false)

    // Restore both so the removal test below still exercises cascade cleanup.
    await args.repositories.conversations.attach({
      knowledgeBaseId: baseId,
      conversationId: args.conversationId,
      createdBy: args.ownerUserId,
    })
  })

  if (args.projectId) {
    const projectId = args.projectId
    await t.test('attaches several knowledge bases to a project', async () => {
      const attached = await args.repositories.projects.attach({
        knowledgeBaseId: baseId,
        projectId,
        attachedBy: args.ownerUserId,
      })
      assert.equal(attached.knowledgeBaseId, baseId)
      assert.equal(attached.projectId, projectId)

      await args.repositories.projects.attach({
        knowledgeBaseId: secondBaseId,
        projectId,
        attachedBy: args.ownerUserId,
      })
      assert.deepEqual(
        (await args.repositories.projects.listForProject(projectId))
          .map(({ knowledgeBaseId }) => knowledgeBaseId)
          .sort(),
        [baseId, secondBaseId].sort(),
      )

      // Idempotent re-attach.
      await args.repositories.projects.attach({
        knowledgeBaseId: baseId,
        projectId,
        attachedBy: args.ownerUserId,
      })
      assert.equal((await args.repositories.projects.listForProject(projectId)).length, 2)

      assert.deepEqual(
        (await args.repositories.projects.listForBase(baseId)).map(({ projectId: id }) => id),
        [projectId],
      )

      assert.equal(await args.repositories.projects.detach({
        knowledgeBaseId: baseId,
        projectId,
      }), true)
      assert.deepEqual(
        (await args.repositories.projects.listForProject(projectId))
          .map(({ knowledgeBaseId }) => knowledgeBaseId),
        [secondBaseId],
      )
      assert.equal(await args.repositories.projects.detach({
        knowledgeBaseId: baseId,
        projectId,
      }), false)

      assert.equal(await args.repositories.projects.detachAll(projectId), true)
      assert.equal((await args.repositories.projects.listForProject(projectId)).length, 0)
      assert.equal(await args.repositories.projects.detachAll(projectId), false)
    })
  }

  await t.test('persists idempotent group defaults and removes them with the base', async () => {
    const created = await args.repositories.groupDefaults.set({
      groupId: args.groupId,
      knowledgeBaseId: secondBaseId,
      createdBy: args.ownerUserId,
    })
    assert.equal(created.groupId, args.groupId)
    assert.equal(created.knowledgeBaseId, secondBaseId)

    const repeated = await args.repositories.groupDefaults.set({
      groupId: args.groupId,
      knowledgeBaseId: secondBaseId,
      createdBy: args.ownerUserId,
    })
    assert.equal(repeated.createdAt, created.createdAt)
    assert.equal((await args.repositories.groupDefaults.listForGroup(args.groupId)).length, 1)
    assert.equal((await args.repositories.groupDefaults.listForGroups([args.groupId])).length, 1)
    assert.equal((await args.repositories.groupDefaults.listForBase(secondBaseId)).length, 1)

    assert.equal(await args.repositories.groupDefaults.remove({
      groupId: args.groupId,
      knowledgeBaseId: secondBaseId,
    }), true)
    assert.equal(await args.repositories.groupDefaults.remove({
      groupId: args.groupId,
      knowledgeBaseId: secondBaseId,
    }), false)

    await args.repositories.groupDefaults.set({
      groupId: args.groupId,
      knowledgeBaseId: secondBaseId,
      createdBy: args.ownerUserId,
    })
  })

  await t.test('archives and removes without deleting the canonical source', async () => {
    assert.equal(await args.repositories.bases.archive(baseId), true)
    assert.equal((await args.repositories.bases.listForOwner(args.ownerUserId)).length, 1)
    assert.equal(
      (await args.repositories.bases.listForOwner(args.ownerUserId, { includeArchived: true })).length,
      2,
    )
    assert.equal(await args.repositories.bases.remove(secondBaseId), true)
    assert.equal((await args.repositories.groupDefaults.listForGroup(args.groupId)).length, 0)
    // Removing one base cascades away only its own attachment rows.
    assert.deepEqual(
      (await args.repositories.conversations.listForConversation(args.conversationId))
        .map(({ knowledgeBaseId }) => knowledgeBaseId),
      [baseId],
    )
    assert.equal((await args.repositories.memberships.listBasesForSource(sourceId)).length, 1)
    assert.equal((await args.repositories.sources.get(sourceId))?.id, sourceId)
    assert.equal(await args.repositories.sources.markDeleted(sourceId), true)
    assert.equal(await args.repositories.sources.get(sourceId), null)
    assert.equal(await args.repositories.bases.remove(baseId), true)
  })
}
