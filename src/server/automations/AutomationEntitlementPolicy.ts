import 'server-only'

export const MAX_ENABLED_AUTOMATIONS = 25

export class AutomationEntitlementError extends Error {
  constructor(readonly publicMessage: string) {
    super(publicMessage)
    this.name = 'AutomationEntitlementError'
  }
}

export interface AutomationEntitlementPolicy {
  assertCanEnable(args: {
    enabledCount: number
    userId: string
  }): Promise<void>
}

function assertEnabledLimit(enabledCount: number): void {
  if (enabledCount >= MAX_ENABLED_AUTOMATIONS) {
    throw new AutomationEntitlementError(
      `You can enable up to ${MAX_ENABLED_AUTOMATIONS} automations.`,
    )
  }
}

export class UnlimitedAutomationEntitlementPolicy implements AutomationEntitlementPolicy {
  async assertCanEnable(args: { enabledCount: number; userId: string }): Promise<void> {
    assertEnabledLimit(args.enabledCount)
  }
}

export class PaidPlanAutomationEntitlementPolicy implements AutomationEntitlementPolicy {
  constructor(private readonly getPlanKind: (userId: string) => Promise<'free' | 'paid'>) {}

  async assertCanEnable(args: { enabledCount: number; userId: string }): Promise<void> {
    if (await this.getPlanKind(args.userId) !== 'paid') {
      throw new AutomationEntitlementError('Enabled automations require a paid plan.')
    }
    assertEnabledLimit(args.enabledCount)
  }
}

export class ConfiguredAutomationEntitlementPolicy implements AutomationEntitlementPolicy {
  private readonly unlimited = new UnlimitedAutomationEntitlementPolicy()
  private readonly paid: PaidPlanAutomationEntitlementPolicy

  constructor(private readonly deps: {
    billingDisabled(): boolean
    getPlanKind(userId: string): Promise<'free' | 'paid'>
  }) {
    this.paid = new PaidPlanAutomationEntitlementPolicy(deps.getPlanKind)
  }

  async assertCanEnable(args: { enabledCount: number; userId: string }): Promise<void> {
    const policy = this.deps.billingDisabled() ? this.unlimited : this.paid
    await policy.assertCanEnable(args)
  }
}
