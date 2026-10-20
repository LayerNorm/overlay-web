import { v } from 'convex/values'
import { query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

export const listKnownProviderReferencesByServer = query({
  args: {
    serverSecret: v.string(),
    provider: v.union(v.literal('box'), v.literal('e2b')),
    references: v.array(v.string()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (args.references.length > 200) throw new Error('provider_inventory_reference_limit_exceeded')

    const references = [...new Set(args.references)]
    const known: string[] = []
    for (const reference of references) {
      const [lease, provision, computer] = await Promise.all([
        ctx.db.query('agentSandboxLeases')
          .withIndex('by_provider_providerReference', (q) => q.eq('provider', args.provider).eq('providerReference', reference))
          .filter((q) => q.or(
            q.eq(q.field('status'), 'reserved'),
            q.eq(q.field('status'), 'provisioning'),
            q.eq(q.field('status'), 'running'),
            q.eq(q.field('status'), 'paused'),
            q.eq(q.field('status'), 'stopping'),
            q.eq(q.field('status'), 'cleanup_failed'),
          ))
          .first(),
        ctx.db.query('cloudAgentProvisions')
          .withIndex('by_provider_providerReference', (q) => q.eq('provider', args.provider).eq('providerReference', reference))
          .first(),
        ctx.db.query('computers')
          .withIndex('by_provider_providerRef', (q) => q.eq('provider', args.provider).eq('providerRef', reference))
          .first(),
      ])
      if (lease || provision || computer) known.push(reference)
    }
    return known
  },
})
