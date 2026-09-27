import type { BillingProvider, UsageArgs } from './types'

export class UsageMeter {
  constructor(private readonly provider: Pick<BillingProvider, 'recordUsage'>) {}

  async recordUsage(args: UsageArgs): Promise<void> {
    if (!Number.isFinite(args.cost) || args.cost < 0) {
      throw new Error('Usage cost must be a non-negative finite number')
    }
    await this.provider.recordUsage({
      ...args,
      timestamp: args.timestamp ?? Date.now(),
    })
  }

  async recordUsageBatch(events: readonly UsageArgs[]): Promise<void> {
    await Promise.all(events.map((event) => this.recordUsage(event)))
  }
}
